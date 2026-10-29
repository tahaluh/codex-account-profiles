import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { evaluateSwitch, PendingSwitch, SwitchResult, LauncherState, SwitchProgress } from "./switchState";
import { promises as fs, readFileSync, readdirSync } from "node:fs";
import { AccountProfile, AccountStore } from "./accountStore";
import { readIdentity, readRateLimits, remainingPercent, RateLimits } from "./codexClient";
import { writeFileAtomic, writeJsonAtomic } from "./fsUtils";
import { readSharedQuotaCache, writeSharedQuotaCache } from "./quotaCache";
import { loadCodexProxyEnvironment } from "./proxyEnv";
import { refreshAccountTokensIfNeeded } from "./authTokens";
import { confirmedLimitBoundary } from "./quotaPolicy";
import { isPathInsideRoots } from "./profilePaths";
import { AccountBackupFile, parseAccountBackup } from "./accountBackup";
import { formatLimits } from "./quotaPresentation";
import { AccountsView } from "./accountsView";
import { LimitCache, TokenRefreshState } from "./extensionState";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./backupCrypto";
import { recordQuotaObservation, readResetHistory, nextResetAt } from "./resetTracker";
import { AccountSortOrder } from "./resetPresentation";
import { readPendingRedemption, redeemAccountReset } from "./resetRedemption";

let activeId: string | undefined;
let accountsView: AccountsView | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let refreshCursor = 0;
let automaticSwitchInFlight = false;
const limitRequests = new Map<string, Promise<RateLimits>>();
const LIMIT_CACHE_KEY = "codexAccountProfiles.rateLimitCache";
const PENDING_SWITCH_KEY = "codexAccountProfiles.pendingSwitch";
const PREVIOUS_CLI_SETTING_KEY = "codexAccountProfiles.previousCliExecutable";
const NATIVE_INTEGRATION_PROMPTED_KEY = "codexAccountProfiles.nativeIntegrationPrompted";
const EXTERNAL_AUTH_SIGNATURE_KEY = "codexAccountProfiles.externalAuthSignature";
const TOKEN_REFRESH_STATE_KEY = "codexAccountProfiles.tokenRefreshState";
const TEMPORARY_EXTENSION_STORAGE_ID = "tahaluh.tahaluh-codex-account-profiles";
const LEGACY_CONFIGURATION_SECTION = "codexAccountSwitcher";
const CONFIGURATION_KEYS = [
  "autoSwitch",
  "startupSelectionMode",
  "startupProbePrompt",
  "confirmBeforeSwitch",
  "minimumRemainingPercent",
  "cooldownMinutes",
  "cacheTtlSeconds",
  "refreshIntervalSeconds",
  "showStatusBar",
  "backgroundTokenRefresh",
] as const;

interface PreviousCliSetting {
  hadGlobalValue: boolean;
  value?: string;
}

async function migrateTemporaryExtensionStorage(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  if (store.all().length) return;
  const temporaryStorage = path.join(path.dirname(context.globalStorageUri.fsPath), TEMPORARY_EXTENSION_STORAGE_ID);
  try {
    const registry = JSON.parse(await fs.readFile(path.join(temporaryStorage, "accounts.json"), "utf8")) as { accounts?: AccountProfile[] };
    const accounts = Array.isArray(registry.accounts)
      ? registry.accounts.filter((account) => account && typeof account.id === "string" && typeof account.name === "string" && typeof account.codexHome === "string")
      : [];
    if (!accounts.length) return;
    await store.save(accounts.map((account, index) => ({
      ...account,
      enabled: account.enabled !== false,
      priority: Number.isFinite(account.priority) ? account.priority : index,
    })));
    vscode.window.showInformationMessage(`Recovered ${accounts.length} Codex profile${accounts.length === 1 ? "" : "s"} from version 0.3.11.`);
  } catch {
    // The temporary 0.3.11 identity may never have been installed.
  }
}

function config() {
  return vscode.workspace.getConfiguration("codexAccountProfiles");
}

async function migrateLegacyConfiguration(): Promise<void> {
  const current = config();
  const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIGURATION_SECTION);
  for (const key of CONFIGURATION_KEYS) {
    if (current.inspect<unknown>(key)?.globalValue !== undefined) continue;
    const legacyValue = legacy.inspect<unknown>(key)?.globalValue;
    if (legacyValue !== undefined) {
      await current.update(key, legacyValue, vscode.ConfigurationTarget.Global);
    }
  }
}

function shellQuote(value: string): string {
  return process.platform === "win32" ? `"${value.replace(/"/g, '""')}"` : "'" + value.replace(/'/g, "'\\''") + "'";
}

function codexLoginCommand(extensionPath: string): string {
  const launcher = path.join(extensionPath, "bin", "codex-account-profiles");
  return [process.execPath, launcher, "login"].map(shellQuote).join(" ");
}

function codexLoginEnvironment(codexHome: string): Record<string, string> {
  return { CODEX_HOME: codexHome, ELECTRON_RUN_AS_NODE: "1" };
}

async function enableNativeIntegration(context: vscode.ExtensionContext, nativeCli: string): Promise<void> {
  const chatgpt = vscode.workspace.getConfiguration("chatgpt");
  if (chatgpt.get<string>("cliExecutable") === nativeCli) return;
  if (!context.globalState.get<PreviousCliSetting>(PREVIOUS_CLI_SETTING_KEY)) {
    const inspected = chatgpt.inspect<string>("cliExecutable");
    await context.globalState.update(PREVIOUS_CLI_SETTING_KEY, {
      hadGlobalValue: inspected?.globalValue !== undefined,
      value: inspected?.globalValue,
    } satisfies PreviousCliSetting);
  }
  await chatgpt.update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global);
}

async function disableNativeIntegration(context: vscode.ExtensionContext, nativeCli: string): Promise<void> {
  const chatgpt = vscode.workspace.getConfiguration("chatgpt");
  const previous = context.globalState.get<PreviousCliSetting>(PREVIOUS_CLI_SETTING_KEY);
  const inspected = chatgpt.inspect<string>("cliExecutable");
  if (inspected?.globalValue === nativeCli) {
    await chatgpt.update(
      "cliExecutable",
      previous?.hadGlobalValue ? previous.value : undefined,
      vscode.ConfigurationTarget.Global,
    );
  }
  await context.globalState.update(PREVIOUS_CLI_SETTING_KEY, undefined);
}

function nativeLauncherPath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "bin", "codex-account-profiles");
}

async function installNativeLauncher(context: vscode.ExtensionContext): Promise<string> {
  const source = path.join(context.extensionPath, "bin");
  const destination = path.join(context.globalStorageUri.fsPath, "bin");
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  const launcher = nativeLauncherPath(context);
  if (process.platform !== "win32") await fs.chmod(launcher, 0o755);
  return launcher;
}

function isObsoleteVersionedLauncher(context: vscode.ExtensionContext, configuredCli: string | undefined): boolean {
  if (!configuredCli || path.basename(configuredCli) !== "codex-account-profiles") return false;
  const extensionDirectory = path.basename(path.dirname(path.dirname(configuredCli)));
  return extensionDirectory.startsWith(`${context.extension.id}-`);
}

function isAuthenticationError(error: unknown): boolean {
  return /\b(auth|authentication|authenticated|unauthenticated|authorization|authorized|credential|credentials|login|logged.?out|sign.?in|token|expired|unauthorized|forbidden|401|403)\b/i.test(String(error));
}

let discoveredRuntime: string | undefined;
function runtimeDirectory(context: vscode.ExtensionContext): string {
  const { runtimeDataDir } = require(path.join(context.extensionPath, "bin", "data-dir.js"));
  const expected = runtimeDataDir(context.globalStorageUri.fsPath);
  const belongsToWindow = (directory: string) => {
    try {
      const launcher = JSON.parse(readFileSync(path.join(directory, "launcher.json"), "utf8"));
      return launcher.hostPid === process.pid && Date.now() - launcher.updatedAt < 10000;
    } catch { return false; }
  };
  if (discoveredRuntime && belongsToWindow(discoveredRuntime)) return discoveredRuntime;
  if (belongsToWindow(expected)) return expected;
  // Codex may launch before this extension activates and sets its environment.
  // Discover only a live launcher owned by this extension host, never another window.
  const root = context.globalStorageUri.fsPath;
  const candidates = [root];
  try { candidates.push(...readdirSync(path.join(root, "runtime")).map((name) => path.join(root, "runtime", name))); } catch {}
  discoveredRuntime = candidates.find(belongsToWindow);
  return discoveredRuntime || expected;
}

function sharedCodexHome(): string {
  return process.env.CODEX_SHARED_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function getLimits(context: vscode.ExtensionContext, account: AccountProfile, force = false): Promise<RateLimits> {
  const cache = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
  const cached = cache[account.id];
  const ttl = config().get<number>("cacheTtlSeconds", 60) * 1000;
  if (!force && cached?.result && Date.now() - cached.checkedAt < ttl) return cached.result;
  const existing = limitRequests.get(account.id);
  if (existing) return existing;
  const request = (async () => {
    if (!force) {
      const shared = await readSharedQuotaCache(account, ttl);
      if (shared) {
        await recordQuotaObservation(account, shared.result, shared.checkedAt).catch(() => undefined);
        const latest = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
        await context.globalState.update(LIMIT_CACHE_KEY, {
          ...latest,
          [account.id]: { result: shared.result, checkedAt: shared.checkedAt },
        });
        return shared.result;
      }
    }
    try {
      const result = await readRateLimits(account);
      const checkedAt = Date.now();
      await recordQuotaObservation(account, result, checkedAt).catch(() => undefined);
      await writeSharedQuotaCache(account, result);
      const latest = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
      await context.globalState.update(LIMIT_CACHE_KEY, {
        ...latest,
        [account.id]: { result, checkedAt },
      });
      return result;
    } catch (error) {
      const latest = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
      const latestCached = latest[account.id];
      await context.globalState.update(LIMIT_CACHE_KEY, {
        ...latest,
        [account.id]: { ...latestCached, checkedAt: latestCached?.checkedAt ?? 0, error: String(error) },
      });
      if (isAuthenticationError(error)) throw error;
      if (latestCached?.result) return latestCached.result;
      throw error;
    }
  })();
  limitRequests.set(account.id, request);
  try {
    return await request;
  } finally {
    if (limitRequests.get(account.id) === request) limitRequests.delete(account.id);
  }
}

async function clearLimitError(context: vscode.ExtensionContext, accountId: string): Promise<void> {
  const cache = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
  if (!cache[accountId]?.error) return;
  await context.globalState.update(LIMIT_CACHE_KEY, {
    ...cache,
    [accountId]: { ...cache[accountId], error: undefined },
  });
}

async function readRuntimeJson<T>(context: vscode.ExtensionContext, name: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(runtimeDirectory(context), name), "utf8")) as T; } catch { return undefined; }
}

let resolvingSwitch: Promise<{ accountId?: string; pending: boolean; pendingLabel?: string }> | undefined;
async function resolveDisplayedAccountId(context: vscode.ExtensionContext): Promise<{ accountId?: string; pending: boolean; pendingLabel?: string }> {
  if (resolvingSwitch) return resolvingSwitch;
  resolvingSwitch = (async () => {
    const current = await readRuntimeJson<{ accountId?: string; startedAt?: number }>(context, "current-account.json");
    const pending = context.workspaceState.get<PendingSwitch>(PENDING_SWITCH_KEY);
    const runtime = await readRuntimeJson<LauncherState>(context, "launcher.json");
    if (!pending) return { accountId: runtime && Date.now() - (runtime.updatedAt || 0) < 10000 ? current?.accountId ?? activeId : activeId ?? current?.accountId, pending: false };
    const [result, launcher, progress] = await Promise.all([
      readRuntimeJson<SwitchResult>(context, "switch-result.json"),
      readRuntimeJson<LauncherState>(context, "launcher.json"),
      readRuntimeJson<SwitchProgress>(context, "switch-progress.json"),
    ]);
    const state = evaluateSwitch(pending, current, result, launcher, progress);
    if (!state.done) return { accountId: pending.accountId, pending: true, pendingLabel: state.label };
    const latest = context.workspaceState.get<PendingSwitch>(PENDING_SWITCH_KEY);
    if (latest?.requestId !== pending.requestId || latest?.requestedAt !== pending.requestedAt) {
      return { accountId: latest?.accountId ?? current?.accountId, pending: Boolean(latest) };
    }
    await context.workspaceState.update(PENDING_SWITCH_KEY, undefined);
    activeId = state.error ? current?.accountId : pending.accountId;
    await writeJsonAtomic(path.join(runtimeDirectory(context), "selection.json"), { accountId: activeId });
    if (state.error) {
      const queued = await readRuntimeJson<PendingSwitch>(context, "switch-request.json");
      if (queued?.requestId === pending.requestId) await fs.unlink(path.join(runtimeDirectory(context), "switch-request.json")).catch(() => undefined);
      vscode.window.showWarningMessage(state.error);
    }
    return { accountId: activeId, pending: false };
  })();
  try { return await resolvingSwitch; } finally { resolvingSwitch = undefined; }
}

async function readCurrentAccountId(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const current = JSON.parse(await fs.readFile(path.join(runtimeDirectory(context), "current-account.json"), "utf8"));
    return current.accountId;
  } catch {
    return activeId;
  }
}

async function updateStatusBar(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  if (!statusItem) return;
  if (!config().get<boolean>("showStatusBar", true)) {
    statusItem.hide();
    return;
  }
  statusItem.show();
  const accountId = await readCurrentAccountId(context);
  const account = store.all().find((item) => item.id === accountId) ?? store.all().find((item) => item.id === activeId);
  if (!account) {
    statusItem.text = "◆ Codex account";
    statusItem.tooltip = "Select Codex account";
    return;
  }
  const cache = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
  const cached = cache[account.id];
  const tokenState = context.globalState.get<TokenRefreshState>(TOKEN_REFRESH_STATE_KEY, {})[account.id];
  const remaining = cached?.result ? `${remainingPercent(cached.result).toFixed(0)}%` : "quota ?";
  const stale = cached?.checkedAt ? Date.now() - cached.checkedAt > config().get<number>("cacheTtlSeconds", 60) * 1000 : false;
  statusItem.text = `◆ ${account.name} ${remaining}${stale ? "*" : ""}`;
  statusItem.tooltip = [
    `Codex account: ${account.name}`,
    account.email ? `Email: ${account.email}` : undefined,
    account.planType ? `Plan: ${account.planType}` : undefined,
    cached?.result ? `Quota: ${formatLimits(cached.result)}` : "Quota: not checked yet",
    nextResetAt(cached?.result) ? `Next window reset: ${new Date(nextResetAt(cached?.result)! * 1000).toLocaleString()}` : undefined,
    tokenState?.refreshedAt ? `Token refreshed: ${new Date(tokenState.refreshedAt).toLocaleString()}` : undefined,
    tokenState?.error ? `Token refresh error: ${tokenState.error}` : undefined,
    stale ? "Quota cache is stale" : undefined,
  ].filter(Boolean).join("\n");
}

async function reauthenticateAccount(context: vscode.ExtensionContext, store: AccountStore, account: AccountProfile): Promise<void> {
  const terminal = vscode.window.createTerminal({ name: `Codex login (${account.name})`, env: codexLoginEnvironment(account.codexHome) });
  terminal.show(true);
  terminal.sendText(codexLoginCommand(context.extensionPath), true);
  vscode.window.showInformationMessage(`Complete authentication for '${account.name}' in the browser, then close the login terminal.`);
  let completed = false;
  const poll = setInterval(async () => {
    if (completed) return;
    try {
      const identity = await readIdentity(account);
      if (!identity.email) return;
      completed = true;
      clearInterval(poll);
      closeListener.dispose();
      await store.update(account.id, { email: identity.email, planType: identity.planType });
      await clearLimitError(context, account.id);
      await syncLauncherRegistry(context, store);
      await getLimits(context, { ...account, email: identity.email, planType: identity.planType }, true).catch(() => undefined);
      await updateStatusBar(context, store);
      vscode.window.showInformationMessage(`Authentication refreshed for '${account.name}'.`);
      void accountsView?.refresh(true);
    } catch { /* Keep waiting for the browser login. */ }
  }, 2000);
  const closeListener = vscode.window.onDidCloseTerminal((closed) => {
    if (closed !== terminal || completed) return;
    clearInterval(poll);
    closeListener.dispose();
  });
  context.subscriptions.push(closeListener);
}

async function selectAccountForReauthentication(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    store.all().map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })),
    { placeHolder: "Choose the account to re-authenticate" },
  );
  if (selected) await reauthenticateAccount(context, store, selected.account);
}

async function chooseAccount(context: vscode.ExtensionContext, store: AccountStore, minimum: number, excludeId?: string): Promise<{ account: AccountProfile; limits: RateLimits } | undefined> {
  const cooldownMs = config().get<number>("cooldownMinutes", 10) * 60 * 1000;
  const candidates = store.all().filter((account) => {
    if (!account.enabled || account.id === excludeId) return false;
    if (!account.lastLimitedAt || cooldownMs <= 0) return true;
    return Date.now() - account.lastLimitedAt >= cooldownMs;
  });
  const checked: Array<{ account: AccountProfile; limits: RateLimits; remaining: number }> = [];
  for (const account of candidates) {
    try {
      const limits = await getLimits(context, account);
      const remaining = remainingPercent(limits);
      if (remaining >= minimum) checked.push({ account, limits, remaining });
    } catch (error) {
      console.warn(`Could not check Codex profile ${account.name}:`, error);
    }
  }
  checked.sort((a, b) => b.remaining - a.remaining || a.account.priority - b.account.priority);
  return checked[0];
}

async function addAccount(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
  const pending = await store.add("Pending login", codexHome, id);
  await syncLauncherRegistry(context, store);

  const terminal = vscode.window.createTerminal({
    name: "Codex login",
    env: codexLoginEnvironment(codexHome),
  });
  terminal.show(true);
  terminal.sendText(codexLoginCommand(context.extensionPath), true);
  vscode.window.showInformationMessage("The official Codex login is open. Complete authentication in your browser and close the terminal.");
  let completed = false;
  const finishLogin = async (): Promise<boolean> => {
    if (completed) return true;
    try {
      const identity = await readIdentity(pending);
      if (!identity.email) throw new Error("No authenticated email returned");
      completed = true;
      clearInterval(poll);
      closeListener.dispose();
      const nickname = await vscode.window.showInputBox({
        prompt: `Nickname for ${identity.email}`,
        value: identity.email.split("@")[0],
        validateInput: (value) => value.trim() ? undefined : "Enter a nickname",
      });
      if (!nickname) {
        await store.remove(id);
        await fs.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
        return false;
      }
      await store.update(id, { name: nickname.trim(), email: identity.email, planType: identity.planType });
      await syncLauncherRegistry(context, store);
      const account = { ...pending, name: nickname.trim(), email: identity.email, planType: identity.planType };
      await getLimits(context, account, true).catch(() => undefined);
      await updateStatusBar(context, store);
      void accountsView?.refresh(true);
      vscode.window.showInformationMessage(`Account ${identity.email} added as '${nickname.trim()}'.`);
      return true;
    } catch {
      return false;
    }
  };
  const poll = setInterval(() => void finishLogin(), 2000);
  const closeListener = vscode.window.onDidCloseTerminal(async (closed) => {
    if (closed !== terminal || completed) return;
    clearInterval(poll);
    const loggedIn = await finishLogin();
    if (!loggedIn) {
      await store.remove(id);
      await fs.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
      vscode.window.showErrorMessage("Could not verify the Codex login. The account was not added.");
    }
  });
  context.subscriptions.push(closeListener);
}

async function importCurrentAccount(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const sourceAuth = path.join(sharedCodexHome(), "auth.json");
  try {
    await fs.access(sourceAuth);
  } catch {
    vscode.window.showWarningMessage("No current Codex auth.json was found to import.");
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
  await fs.copyFile(sourceAuth, path.join(codexHome, "auth.json"));
  await fs.chmod(path.join(codexHome, "auth.json"), 0o600).catch(() => undefined);

  const pending = await store.add("Imported account", codexHome, id);
  try {
    const identity = await readIdentity(pending);
    if (!identity.email) throw new Error("No authenticated email returned");
    const existing = store.all().find((account) => account.email === identity.email && account.id !== id);
    const nickname = await vscode.window.showInputBox({
      prompt: `Nickname for imported account ${identity.email}`,
      value: existing ? `${identity.email.split("@")[0]} copy` : identity.email.split("@")[0],
      validateInput: (value) => value.trim() ? undefined : "Enter a nickname",
    });
    if (!nickname) {
      await store.remove(id);
      await fs.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    await store.update(id, { name: nickname.trim(), email: identity.email, planType: identity.planType });
    await syncLauncherRegistry(context, store);
    await getLimits(context, { ...pending, name: nickname.trim(), email: identity.email, planType: identity.planType }, true).catch(() => undefined);
    await updateStatusBar(context, store);
    void accountsView?.refresh(true);
    vscode.window.showInformationMessage(`Imported Codex account ${identity.email}.`);
  } catch (error) {
    await store.remove(id);
    await fs.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
    vscode.window.showErrorMessage(`Could not import current Codex account: ${String(error)}`);
  }
}

async function exportAccounts(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const accounts = store.all();
  if (!accounts.length) {
    vscode.window.showInformationMessage("No Codex accounts configured.");
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    "Profile backups contain Codex credentials. Encrypted backup is recommended.",
    "Encrypted Backup",
    "Plain JSON (Advanced)",
    "Cancel",
  );
  if (answer !== "Encrypted Backup" && answer !== "Plain JSON (Advanced)") return;
  let password: string | undefined;
  if (answer === "Encrypted Backup") {
    password = await requestBackupPassword(true);
    if (!password) return;
  } else {
    const confirmed = await vscode.window.showWarningMessage(
      "Plain JSON exposes reusable authentication tokens to anyone who can read the file.",
      { modal: true },
      "Export Plain JSON",
    );
    if (confirmed !== "Export Plain JSON") return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), password ? "codex-account-profiles-backup.encrypted.json" : "codex-account-profiles-backup.json")),
    filters: { JSON: ["json"] },
    saveLabel: "Export Profiles",
  });
  if (!target) return;
  const backup: AccountBackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: [],
  };
  for (const account of accounts) {
    try {
      const authJson = JSON.parse(await fs.readFile(path.join(account.codexHome, "auth.json"), "utf8"));
      backup.accounts.push({
        name: account.name,
        email: account.email,
        planType: account.planType,
        enabled: account.enabled,
        priority: account.priority,
        authJson,
      });
    } catch {
      // Skip profiles without a readable auth.json.
    }
  }
  const output = password ? await encryptBackup(backup, password) : backup;
  await writeJsonAtomic(target.fsPath, output);
  vscode.window.showInformationMessage(`Exported ${backup.accounts.length} Codex account backup${backup.accounts.length === 1 ? "" : "s"}${password ? " with encryption" : ""}.`);
}

async function requestBackupPassword(confirm: boolean): Promise<string | undefined> {
  const password = await vscode.window.showInputBox({
    title: "Encrypt Profile Backup",
    prompt: "Enter a password with at least 10 characters",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.length >= 10 ? undefined : "Use at least 10 characters",
  });
  if (!password || !confirm) return password;
  const repeated = await vscode.window.showInputBox({
    title: "Confirm Backup Password",
    prompt: "Enter the same password again",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value === password ? undefined : "Passwords do not match",
  });
  return repeated === password ? password : undefined;
}

async function importAccountsBackup(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { JSON: ["json"] },
    openLabel: "Import Profiles",
  });
  const source = selected?.[0];
  if (!source) return;
  let parsed: AccountBackupFile;
  try {
    const file = JSON.parse(await fs.readFile(source.fsPath, "utf8")) as unknown;
    let contents = file;
    if (isEncryptedBackup(file)) {
      const password = await requestBackupPassword(false);
      if (!password) return;
      contents = await decryptBackup(file, password);
    } else {
      const answer = await vscode.window.showWarningMessage(
        "This is an unencrypted backup containing authentication tokens. Import only from a trusted source.",
        { modal: true },
        "Import Plain JSON",
      );
      if (answer !== "Import Plain JSON") return;
    }
    parsed = parseAccountBackup(contents);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not import Codex account backup: ${String(error)}`);
    return;
  }
  let imported = 0;
  for (const entry of parsed.accounts) {
    if (!entry.authJson || typeof entry.authJson !== "object") continue;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
    await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFileAtomic(path.join(codexHome, "auth.json"), JSON.stringify(entry.authJson, null, 2));
    const account = await store.add(entry.name || "Imported account", codexHome, id);
    let identity: Awaited<ReturnType<typeof readIdentity>> | undefined;
    try {
      identity = await readIdentity(account);
    } catch {
      identity = undefined;
    }
    await store.update(id, {
      name: entry.name || identity?.email?.split("@")[0] || "Imported account",
      email: identity?.email ?? entry.email,
      planType: identity?.planType ?? entry.planType,
      enabled: entry.enabled !== false,
      priority: entry.priority,
    });
    imported += 1;
  }
  await syncLauncherRegistry(context, store);
  await updateStatusBar(context, store);
  void accountsView?.refresh(true);
  vscode.window.showInformationMessage(`Imported ${imported} Codex account backup${imported === 1 ? "" : "s"}.`);
}

async function syncLauncherRegistry(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  await writeJsonAtomic(
    path.join(context.globalStorageUri.fsPath, "accounts.json"),
    {
      forcedAccountId: null,
      startupSelectionMode: config().get<number>("startupSelectionMode", 2),
      startupProbePrompt: config().get<string>("startupProbePrompt", "Reply with OK."),
      autoSwitch: config().get<boolean>("autoSwitch", false),
      cooldownMinutes: config().get<number>("cooldownMinutes", 10),
      accounts: store.all().map(({ id, name, email, planType, codexHome, enabled, priority }) => ({ id, name, email, planType, codexHome, enabled, priority })),
    },
  );

}

function managedProfileRoots(context: vscode.ExtensionContext): string[] {
  const storageParent = path.dirname(context.globalStorageUri.fsPath);
  return [
    path.join(context.globalStorageUri.fsPath, "profiles"),
    path.join(storageParent, TEMPORARY_EXTENSION_STORAGE_ID, "profiles"),
  ].map((root) => path.resolve(root));
}

function isManagedProfile(context: vscode.ExtensionContext, codexHome: string): boolean {
  return isPathInsideRoots(codexHome, managedProfileRoots(context));
}

async function isAccountBackendRunning(context: vscode.ExtensionContext, accountId: string): Promise<boolean> {
  const storageParent = path.dirname(context.globalStorageUri.fsPath);
  const dataDirectories = [
    context.globalStorageUri.fsPath,
    path.join(storageParent, TEMPORARY_EXTENSION_STORAGE_ID),
  ];
  for (const root of [...dataDirectories]) {
    const windows = await fs.readdir(path.join(root, "runtime"), { withFileTypes: true }).catch(() => []);
    dataDirectories.push(...windows.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, "runtime", entry.name)));
  }
  for (const dataDirectory of dataDirectories) {
    try {
      const current = JSON.parse(await fs.readFile(path.join(dataDirectory, "current-account.json"), "utf8")) as { accountId?: string };
      if (current.accountId !== accountId) continue;
      const pid = Number(await fs.readFile(path.join(dataDirectory, "codex.pid"), "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) continue;
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    }
  }
  return false;
}

async function deleteAccount(context: vscode.ExtensionContext, store: AccountStore, account: AccountProfile): Promise<boolean> {
  if (await isAccountBackendRunning(context, account.id)) {
    vscode.window.showWarningMessage("Switch away from this active Codex account before removing it.");
    return false;
  }
  await store.remove(account.id);
  if (activeId === account.id) activeId = undefined;
  const limitCache = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
  const tokenState = context.globalState.get<TokenRefreshState>(TOKEN_REFRESH_STATE_KEY, {});
  delete limitCache[account.id];
  delete tokenState[account.id];
  await Promise.all([
    context.globalState.update(LIMIT_CACHE_KEY, limitCache),
    context.globalState.update(TOKEN_REFRESH_STATE_KEY, tokenState),
  ]);
  if (isManagedProfile(context, account.codexHome)) {
    await fs.rm(account.codexHome, { recursive: true, force: true });
  }
  await syncLauncherRegistry(context, store);
  return true;
}

async function removeAccount(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const accounts = store.all();
  const selected = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })), { placeHolder: "Select an account to remove" });
  if (!selected) return;
  const answer = await vscode.window.showWarningMessage(
    `Remove Codex account '${selected.account.name}' and delete its local authentication tokens?`,
    "Remove",
    "Cancel",
  );
  if (answer === "Remove") await deleteAccount(context, store, selected.account);
}

async function showLimits(context: vscode.ExtensionContext, store: AccountStore, force = false): Promise<void> {
  const rows: string[] = [];
  for (const account of store.all()) {
    try {
      const limits = await getLimits(context, account, force);
      const accountContext = account.planType ? `, ${account.planType}` : "";
      rows.push(`${account.name} (${account.email ?? "no email"}${accountContext}): ${formatLimits(limits)}`);
    } catch (error) {
      rows.push(`${account.name}: unavailable`);
    }
  }
  vscode.window.showInformationMessage(rows.length ? rows.join(" | ") : "No Codex accounts configured.");
}

async function switchAccount(context: vscode.ExtensionContext, store: AccountStore, force = false): Promise<AccountProfile | undefined> {
  const selected = await chooseAccount(context, store, config().get<number>("minimumRemainingPercent", 1));
  if (!selected) {
    vscode.window.showWarningMessage("No enabled Codex account has enough available quota.");
    return undefined;
  }
  if (!force && config().get<boolean>("confirmBeforeSwitch", true)) {
    const answer = await vscode.window.showInformationMessage(`Use Codex account '${selected.account.name}'?`, "Switch", "Cancel");
    if (answer !== "Switch") return undefined;
  }
  return selected.account;
}

async function requestBackendSwitch(context: vscode.ExtensionContext, store: AccountStore, account: AccountProfile, confirm: boolean): Promise<boolean> {
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(
      `Queue Codex switch to '${account.name}' without reloading VS Code? It will apply after the current request finishes.`,
      "Switch", "Cancel",
    );
    if (answer !== "Switch") return false;
  }
  const pending: PendingSwitch = { accountId: account.id, requestedAt: Date.now(), requestId: randomUUID() };
  try {
    await syncLauncherRegistry(context, store);
    const launcher = await readRuntimeJson<LauncherState>(context, "launcher.json");
    if (!launcher || Date.now() - (launcher.updatedAt || 0) >= 10000) {
      // Older launchers need one reload to adopt the window-specific handshake.
      const pid = Number(await fs.readFile(path.join(runtimeDirectory(context), "codex.pid"), "utf8").catch(() => "0"));
      let running = false;
      try { if (pid > 0) { process.kill(pid, 0); running = true; } } catch {}
      activeId = account.id;
      await writeJsonAtomic(path.join(runtimeDirectory(context), "selection.json"), { accountId: account.id });
      await context.workspaceState.update(PENDING_SWITCH_KEY, undefined);
      vscode.window.showInformationMessage(running
        ? `Profile '${account.name}' selected. Reload the VS Code window once to activate the updated account switcher.`
        : `Profile '${account.name}' selected for the next Codex session. Open Codex to use it.`);
      void accountsView?.refresh();
      await updateStatusBar(context, store);
      return true;
    }
    try { await fs.unlink(path.join(runtimeDirectory(context), "switch-result.json")); } catch {}
    await writeJsonAtomic(
      path.join(runtimeDirectory(context), "switch-request.json"),
      pending,
    );
    await context.workspaceState.update(PENDING_SWITCH_KEY, pending);
    await writeJsonAtomic(path.join(runtimeDirectory(context), "selection.json"), { accountId: account.id });
    vscode.window.showInformationMessage(`Codex switch to '${account.name}' queued. It will apply after the current request finishes.`);
    await updateStatusBar(context, store);
    void accountsView?.refresh(true);
    return true;
  } catch {
    vscode.window.showErrorMessage("Could not queue the Codex profile switch.");
    return false;
  }
}

async function monitorAutomaticSwitch(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  if (!config().get<boolean>("autoSwitch", false)) return;
  if (automaticSwitchInFlight) return;
  const now = Date.now();
  const lastSwitch = context.workspaceState.get<number>("codexAccountProfiles.lastAutoSwitch", 0);
  if (now - lastSwitch < 30000) return;
  const dataDir = runtimeDirectory(context);
  let currentId: string | undefined;
  let trigger = false;
  let triggerAt = 0;
  let finishedAt = 0;
  try {
    const current = JSON.parse(await fs.readFile(path.join(dataDir, "current-account.json"), "utf8"));
    currentId = current.accountId;
  } catch { return; }
  try {
    const event = JSON.parse(await fs.readFile(path.join(dataDir, "turn-finished.json"), "utf8")) as { accountId?: string; finishedAt?: number };
    if (event.accountId === currentId) finishedAt = Number(event.finishedAt) || 0;
  } catch { /* No completed message has been reported yet. */ }
  try {
    const event = JSON.parse(await fs.readFile(path.join(dataDir, "rate-limit-trigger.json"), "utf8"));
    trigger = event.accountId === currentId;
    if (trigger) triggerAt = Number(event.detectedAt) || 0;
  } catch { /* Automatic switching requires a confirmed launcher event. */ }
  const current = store.all().find((account) => account.id === currentId && account.enabled);
  if (!current) return;
  const lastDecision = context.workspaceState.get<number>("codexAccountProfiles.lastAutoDecision", 0);
  const eventAt = confirmedLimitBoundary(trigger, triggerAt, finishedAt, lastDecision);
  if (!eventAt) return;
  automaticSwitchInFlight = true;
  try {
    const currentLimits = await getLimits(context, current, true);
    const currentRemaining = remainingPercent(currentLimits);
    if (trigger) await store.markLimited(current.id);
    // Only move at a message boundary, and only when the current account is
    // below 100% while another account is completely available.
    if (currentRemaining >= 100) {
      await context.workspaceState.update("codexAccountProfiles.lastAutoDecision", eventAt);
      try { await fs.unlink(path.join(dataDir, "rate-limit-trigger.json")); } catch {}
      try { await fs.unlink(path.join(dataDir, "turn-finished.json")); } catch {}
      return;
    }
    const next = await chooseAccount(context, store, 100, current.id);
    try { await fs.unlink(path.join(dataDir, "rate-limit-trigger.json")); } catch { /* Already consumed. */ }
    try { await fs.unlink(path.join(dataDir, "turn-finished.json")); } catch { /* Already consumed. */ }
    if (!next) {
      await context.workspaceState.update("codexAccountProfiles.lastAutoDecision", eventAt);
      if (trigger) vscode.window.showWarningMessage("The Codex account reached its limit and no other account is available.");
      return;
    }
    await context.workspaceState.update("codexAccountProfiles.lastAutoDecision", eventAt);
    await context.workspaceState.update("codexAccountProfiles.lastAutoSwitch", now);
    await requestBackendSwitch(context, store, next.account, false);
    vscode.window.showInformationMessage(`Limit reached. Automatically switching to '${next.account.name}'.`);
  } finally {
    automaticSwitchInFlight = false;
  }
}

async function runTokenRefreshSweep(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  if (!config().get<boolean>("backgroundTokenRefresh", false)) return;
  const state = context.globalState.get<TokenRefreshState>(TOKEN_REFRESH_STATE_KEY, {});
  let changed = false;
  for (const account of store.all().filter((item) => item.enabled)) {
    const result = await refreshAccountTokensIfNeeded(account);
    state[account.id] = {
      checkedAt: Date.now(),
      refreshedAt: result.refreshed ? Date.now() : state[account.id]?.refreshedAt,
      error: result.error,
    };
    changed = true;
  }
  if (changed) await context.globalState.update(TOKEN_REFRESH_STATE_KEY, state);
  await updateStatusBar(context, store);
  void accountsView?.refresh();
}

async function readExternalAuthSignature(): Promise<string | undefined> {
  const authPath = path.join(sharedCodexHome(), "auth.json");
  try {
    const stat = await fs.stat(authPath);
    return `${authPath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return undefined;
  }
}

async function syncExternalAuthState(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const next = await readExternalAuthSignature();
  if (next === context.globalState.get<string>(EXTERNAL_AUTH_SIGNATURE_KEY)) return;
  await context.globalState.update(EXTERNAL_AUTH_SIGNATURE_KEY, next);
  await updateStatusBar(context, store);
  void accountsView?.refresh();
}

const resetRedemptions = new Set<string>();
async function applyAccountReset(context: vscode.ExtensionContext, account: AccountProfile): Promise<void> {
  if (resetRedemptions.has(account.id)) return;
  resetRedemptions.add(account.id);
  try {
    const pending = await readPendingRedemption(account);
    let creditId = pending?.creditId;
    let selectedLabel = "the next available banked reset";
    if (!pending) {
      const result = await getLimits(context, account, true);
      const summary = result.rateLimitResetCredits;
      if (!summary || !summary.availableCount || summary.availableCount <= 0) {
        vscode.window.showInformationMessage(`No banked resets are reported for '${account.name}'.`);
        return;
      }
      const credits = (summary.credits || []).filter(credit => credit.status === "available" && credit.resetType === "codexRateLimits"
        && (!credit.expiresAt || credit.expiresAt * 1000 > Date.now())).sort((a, b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity));
      if (credits.length) {
        const selected = await vscode.window.showQuickPick(credits.map(credit => ({
          label: credit.title || "Rate-limit reset",
          description: credit.expiresAt ? `Expires ${new Date(credit.expiresAt * 1000).toLocaleString()}` : "Expiry not reported",
          detail: `Granted ${new Date(credit.grantedAt * 1000).toLocaleString()}`,
          credit,
        })), { placeHolder: `Choose a banked reset for '${account.name}'` });
        if (!selected) return;
        creditId = selected.credit.id;
        selectedLabel = selected.label;
      }
    }
    const answer = await vscode.window.showWarningMessage(pending
      ? `Check/retry the unresolved reset for '${account.name}' (${account.email || "saved account"})? The same request key will be reused so this retry cannot consume a second reset.`
      : `Use '${selectedLabel}' for '${account.name}' (${account.email || "saved account"})? This consumes one banked reset and may change this account's reset dates.`,
      { modal: true }, pending ? "Check / retry reset" : "Use one reset");
    if (!answer) return;
    const applied = await redeemAccountReset(account, creditId);
    const messages = {
      reset: `Banked reset applied to '${account.name}'.`,
      alreadyRedeemed: `This reset was already applied to '${account.name}'; no additional reset was consumed.`,
      nothingToReset: `No eligible usage window needs resetting for '${account.name}'.`,
      noCredit: `No banked reset remains available for '${account.name}'.`,
    };
    vscode.window.showInformationMessage(messages[applied.outcome]);
    // Refresh official data after every outcome; never guess the new windows.
    await getLimits(context, account, true);
  } catch (error) {
    vscode.window.showWarningMessage(`Reset for '${account.name}': ${String(error)}. If the result is uncertain, retry to check the same attempt.`);
  } finally {
    resetRedemptions.delete(account.id);
    void accountsView?.refresh();
    void updateStatusBar(context, new AccountStore(context.globalState));
  }
}

async function manuallySelectAccount(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const choices = store.all().filter((account) => account.enabled).map((account) => ({
    label: account.name,
    description: [account.email, account.planType].filter(Boolean).join(" / ") || "no email",
    account,
  }));
  const choice = await vscode.window.showQuickPick(choices, { placeHolder: "Choose the account for the next Codex session" });
  if (!choice) return;
  await requestBackendSwitch(context, store, choice.account, true);
}

export function activate(context: vscode.ExtensionContext): void {
  process.env.CODEX_ACCOUNT_PROFILES_INSTANCE = process.env.VSCODE_IPC_HOOK_CLI || context.storageUri?.fsPath || String(process.pid);
  const store = new AccountStore(context.globalState);
  accountsView = new AccountsView(context, store, {
    addAccount: () => addAccount(context, store),
    importCurrentAccount: () => importCurrentAccount(context, store),
    exportAccounts: () => exportAccounts(context, store),
    importAccountsBackup: () => importAccountsBackup(context, store),
    showLimits: (force) => showLimits(context, store, force),
    requestBackendSwitch: (account) => requestBackendSwitch(context, store, account, false),
    deleteAccount: (account) => deleteAccount(context, store, account),
    reauthenticateAccount: (account) => reauthenticateAccount(context, store, account),
    resolveDisplayedAccount: () => resolveDisplayedAccountId(context),
    getLimits: (account, force) => getLimits(context, account, force),
    getLimitCache: () => context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {}),
    getTokenRefreshState: () => context.globalState.get<TokenRefreshState>(TOKEN_REFRESH_STATE_KEY, {}),
    readResetHistory,
    getSortOrder: () => config().get<AccountSortOrder>("accountSortOrder", "current"),
    setSortOrder: async (order) => { await config().update("accountSortOrder", order, vscode.ConfigurationTarget.Global); },
    openPublicResetTracker: () => { void vscode.env.openExternal(vscode.Uri.parse("https://codexreset.ai/")); },
    applyReset: (account) => applyAccountReset(context, account),
    hasPendingReset: async (account) => Boolean(await readPendingRedemption(account)),
    isAuthenticationError,
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexAccountProfiles.accountsView", accountsView));
  process.env.CODEX_ACCOUNT_PROFILES_DATA = context.globalStorageUri.fsPath;
  void fs.mkdir(context.globalStorageUri.fsPath, { recursive: true })
    .then(() => migrateTemporaryExtensionStorage(context, store))
    .then(() => migrateLegacyConfiguration())
    .then(async () => {
      const selection = await readRuntimeJson<{ accountId?: string }>(context, "selection.json");
      activeId = selection?.accountId;
      await syncLauncherRegistry(context, store);
    });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codexAccountProfiles.startupSelectionMode")
      || event.affectsConfiguration("codexAccountProfiles.startupProbePrompt")
      || event.affectsConfiguration("codexAccountProfiles.autoSwitch")
      || event.affectsConfiguration("codexAccountProfiles.cooldownMinutes")) {
      void syncLauncherRegistry(context, store);
    }
  }));
  const nativeCli = nativeLauncherPath(context);
  if (!vscode.extensions.getExtension("openai.chatgpt")) {
    void vscode.window.showWarningMessage(
      "The official OpenAI Codex extension is not installed. Account switching is ready, but Codex itself is required.",
      "Find Codex Extension",
    ).then((choice) => {
      if (choice === "Find Codex Extension") void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
    });
  }
  void installNativeLauncher(context).then(async () => {
    const configuredCli = vscode.workspace.getConfiguration("chatgpt").get<string>("cliExecutable");
    if (isObsoleteVersionedLauncher(context, configuredCli)) {
      await enableNativeIntegration(context, nativeCli);
      vscode.window.showInformationMessage("Codex launcher path was repaired. Reload the VS Code window.");
      return;
    }
    if (configuredCli === nativeCli || context.globalState.get<boolean>(NATIVE_INTEGRATION_PROMPTED_KEY, false)) return;
    await context.globalState.update(NATIVE_INTEGRATION_PROMPTED_KEY, true);
    const choice = await vscode.window.showInformationMessage(
      "Enable Codex Account Profiles for the official Codex extension? Your current CLI setting will be preserved.",
      "Enable",
      "Not Now",
    );
    if (choice !== "Enable") return;
    await enableNativeIntegration(context, nativeCli);
    vscode.window.showInformationMessage("Native Codex integration configured. Reload the VS Code window.");
  }).catch(() => {
    vscode.window.showWarningMessage("Could not configure the official Codex extension. Run Codex: Enable Native Integration.");
  });
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = "codexAccountProfiles.switchAccount";
  statusItem.text = "◆ Codex account";
  statusItem.tooltip = "Select Codex account";
  if (config().get<boolean>("showStatusBar", true)) statusItem.show();
  context.subscriptions.push(statusItem);
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.addAccount", () => addAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.importCurrentAccount", () => importCurrentAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.reauthenticateAccount", () => selectAccountForReauthentication(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.exportAccounts", () => exportAccounts(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.importAccounts", () => importAccountsBackup(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.removeAccount", () => removeAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.showLimits", () => showLimits(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.switchAccount", () => manuallySelectAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.startCodex", async () => {
    const account = await switchAccount(context, store, config().get<boolean>("autoSwitch", false));
    if (!account) return;
    const launcher = await installNativeLauncher(context);
    const terminal = vscode.window.createTerminal({ name: `Codex (${account.name})`, env: {
      CODEX_SHARED_HOME: process.env.CODEX_SHARED_HOME || path.join(os.homedir(), ".codex"),
      CODEX_ACCOUNT_PROFILES_DATA: context.globalStorageUri.fsPath,
      CODEX_ACCOUNT_PROFILES_INSTANCE: `${process.env.CODEX_ACCOUNT_PROFILES_INSTANCE}-terminal-${Date.now()}`,
      CODEX_ACCOUNT_PROFILES_ACCOUNT_ID: account.id,
      ELECTRON_RUN_AS_NODE: "1",
    } });
    terminal.show(true);
    terminal.sendText([process.execPath, launcher].map(shellQuote).join(" "), true);
  }));
  const refreshMs = Math.max(10, config().get<number>("refreshIntervalSeconds", 60)) * 1000;
  const refreshTimer = setInterval(() => {
    const enabled = store.all().filter((account) => account.enabled);
    if (!enabled.length) return;
    refreshCursor = refreshCursor % enabled.length;
    const account = enabled[refreshCursor];
    refreshCursor = (refreshCursor + 1) % enabled.length;
    void getLimits(context, account, true)
      .then(() => updateStatusBar(context, store))
      .catch(() => { /* Keep the last successful cache entry. */ });
  }, refreshMs);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
  const tokenRefreshTimer = setInterval(() => void runTokenRefreshSweep(context, store), 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(tokenRefreshTimer) });
  void runTokenRefreshSweep(context, store);
  const autoSwitchTimer = setInterval(() => void monitorAutomaticSwitch(context, store), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(autoSwitchTimer) });
  const viewRefreshTimer = setInterval(() => {
    void accountsView?.refresh();
    void updateStatusBar(context, store);
  }, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(viewRefreshTimer) });
  const externalAuthTimer = setInterval(() => void syncExternalAuthState(context, store), 3000);
  context.subscriptions.push({ dispose: () => clearInterval(externalAuthTimer) });
  void syncExternalAuthState(context, store);
  void loadCodexProxyEnvironment(sharedCodexHome()).catch((error) => {
    vscode.window.showWarningMessage(`Codex proxy environment was ignored: ${String(error)}`);
  });
  void updateStatusBar(context, store);
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.openLauncherFolder", () => {
    vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(context.extensionUri.fsPath));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.enableNativeIntegration", async () => {
    await enableNativeIntegration(context, await installNativeLauncher(context));
    vscode.window.showInformationMessage("Native Codex integration configured. Reload the VS Code window.");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountProfiles.disableNativeIntegration", async () => {
    await disableNativeIntegration(context, nativeCli);
    vscode.window.showInformationMessage("Previous Codex CLI setting restored. Reload the VS Code window.");
  }));
}

export function deactivate(): void {}
