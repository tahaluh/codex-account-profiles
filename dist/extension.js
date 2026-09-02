"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_fs_1 = require("node:fs");
const accountStore_1 = require("./accountStore");
const codexClient_1 = require("./codexClient");
const fsUtils_1 = require("./fsUtils");
const quotaCache_1 = require("./quotaCache");
const proxyEnv_1 = require("./proxyEnv");
const authTokens_1 = require("./authTokens");
const quotaPolicy_1 = require("./quotaPolicy");
const profilePaths_1 = require("./profilePaths");
const accountBackup_1 = require("./accountBackup");
const quotaPresentation_1 = require("./quotaPresentation");
const accountsView_1 = require("./accountsView");
const backupCrypto_1 = require("./backupCrypto");
let activeId;
let accountsView;
let statusItem;
let refreshCursor = 0;
let automaticSwitchInFlight = false;
const limitRequests = new Map();
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
];
async function migrateTemporaryExtensionStorage(context, store) {
    if (store.all().length)
        return;
    const temporaryStorage = path.join(path.dirname(context.globalStorageUri.fsPath), TEMPORARY_EXTENSION_STORAGE_ID);
    try {
        const registry = JSON.parse(await node_fs_1.promises.readFile(path.join(temporaryStorage, "accounts.json"), "utf8"));
        const accounts = Array.isArray(registry.accounts)
            ? registry.accounts.filter((account) => account && typeof account.id === "string" && typeof account.name === "string" && typeof account.codexHome === "string")
            : [];
        if (!accounts.length)
            return;
        await store.save(accounts.map((account, index) => ({
            ...account,
            enabled: account.enabled !== false,
            priority: Number.isFinite(account.priority) ? account.priority : index,
        })));
        vscode.window.showInformationMessage(`Recovered ${accounts.length} Codex profile${accounts.length === 1 ? "" : "s"} from version 0.3.11.`);
    }
    catch {
        // The temporary 0.3.11 identity may never have been installed.
    }
}
function config() {
    return vscode.workspace.getConfiguration("codexAccountProfiles");
}
async function migrateLegacyConfiguration() {
    const current = config();
    const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIGURATION_SECTION);
    for (const key of CONFIGURATION_KEYS) {
        if (current.inspect(key)?.globalValue !== undefined)
            continue;
        const legacyValue = legacy.inspect(key)?.globalValue;
        if (legacyValue !== undefined) {
            await current.update(key, legacyValue, vscode.ConfigurationTarget.Global);
        }
    }
}
function shellQuote(value) {
    return JSON.stringify(value);
}
function codexLoginCommand(extensionPath) {
    const launcher = path.join(extensionPath, "bin", "codex-account-profiles");
    return [process.execPath, launcher, "login"].map(shellQuote).join(" ");
}
function codexLoginEnvironment(codexHome) {
    return { CODEX_HOME: codexHome, ELECTRON_RUN_AS_NODE: "1" };
}
async function enableNativeIntegration(context, nativeCli) {
    const chatgpt = vscode.workspace.getConfiguration("chatgpt");
    if (chatgpt.get("cliExecutable") === nativeCli)
        return;
    if (!context.globalState.get(PREVIOUS_CLI_SETTING_KEY)) {
        const inspected = chatgpt.inspect("cliExecutable");
        await context.globalState.update(PREVIOUS_CLI_SETTING_KEY, {
            hadGlobalValue: inspected?.globalValue !== undefined,
            value: inspected?.globalValue,
        });
    }
    await chatgpt.update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global);
}
async function disableNativeIntegration(context, nativeCli) {
    const chatgpt = vscode.workspace.getConfiguration("chatgpt");
    const previous = context.globalState.get(PREVIOUS_CLI_SETTING_KEY);
    const inspected = chatgpt.inspect("cliExecutable");
    if (inspected?.globalValue === nativeCli) {
        await chatgpt.update("cliExecutable", previous?.hadGlobalValue ? previous.value : undefined, vscode.ConfigurationTarget.Global);
    }
    await context.globalState.update(PREVIOUS_CLI_SETTING_KEY, undefined);
}
function nativeLauncherPath(context) {
    return path.join(context.globalStorageUri.fsPath, "bin", "codex-account-profiles");
}
async function installNativeLauncher(context) {
    const source = path.join(context.extensionPath, "bin");
    const destination = path.join(context.globalStorageUri.fsPath, "bin");
    await node_fs_1.promises.mkdir(destination, { recursive: true });
    await node_fs_1.promises.cp(source, destination, { recursive: true, force: true });
    const launcher = nativeLauncherPath(context);
    if (process.platform !== "win32")
        await node_fs_1.promises.chmod(launcher, 0o755);
    return launcher;
}
function isObsoleteVersionedLauncher(context, configuredCli) {
    if (!configuredCli || path.basename(configuredCli) !== "codex-account-profiles")
        return false;
    const extensionDirectory = path.basename(path.dirname(path.dirname(configuredCli)));
    return extensionDirectory.startsWith(`${context.extension.id}-`);
}
function isAuthenticationError(error) {
    return /\b(auth|authentication|authenticated|unauthenticated|authorization|authorized|credential|credentials|login|logged.?out|sign.?in|token|expired|unauthorized|forbidden|401|403)\b/i.test(String(error));
}
function sharedCodexHome() {
    return process.env.CODEX_SHARED_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}
async function getLimits(context, account, force = false) {
    const cache = context.globalState.get(LIMIT_CACHE_KEY, {});
    const cached = cache[account.id];
    const ttl = config().get("cacheTtlSeconds", 60) * 1000;
    if (!force && cached?.result && Date.now() - cached.checkedAt < ttl)
        return cached.result;
    const existing = limitRequests.get(account.id);
    if (existing)
        return existing;
    const request = (async () => {
        if (!force) {
            const shared = await (0, quotaCache_1.readSharedQuotaCache)(account, ttl);
            if (shared) {
                const latest = context.globalState.get(LIMIT_CACHE_KEY, {});
                await context.globalState.update(LIMIT_CACHE_KEY, {
                    ...latest,
                    [account.id]: { result: shared.result, checkedAt: shared.checkedAt },
                });
                return shared.result;
            }
        }
        try {
            const result = await (0, codexClient_1.readRateLimits)(account);
            await (0, quotaCache_1.writeSharedQuotaCache)(account, result);
            const latest = context.globalState.get(LIMIT_CACHE_KEY, {});
            await context.globalState.update(LIMIT_CACHE_KEY, {
                ...latest,
                [account.id]: { result, checkedAt: Date.now() },
            });
            return result;
        }
        catch (error) {
            const latest = context.globalState.get(LIMIT_CACHE_KEY, {});
            const latestCached = latest[account.id];
            await context.globalState.update(LIMIT_CACHE_KEY, {
                ...latest,
                [account.id]: { ...latestCached, checkedAt: latestCached?.checkedAt ?? 0, error: String(error) },
            });
            if (isAuthenticationError(error))
                throw error;
            if (latestCached?.result)
                return latestCached.result;
            throw error;
        }
    })();
    limitRequests.set(account.id, request);
    try {
        return await request;
    }
    finally {
        if (limitRequests.get(account.id) === request)
            limitRequests.delete(account.id);
    }
}
async function clearLimitError(context, accountId) {
    const cache = context.globalState.get(LIMIT_CACHE_KEY, {});
    if (!cache[accountId]?.error)
        return;
    await context.globalState.update(LIMIT_CACHE_KEY, {
        ...cache,
        [accountId]: { ...cache[accountId], error: undefined },
    });
}
async function markPendingSwitch(context, accountId) {
    await context.globalState.update(PENDING_SWITCH_KEY, { accountId, requestedAt: Date.now() });
}
async function resolveDisplayedAccountId(context) {
    let currentAccountId;
    try {
        const current = JSON.parse(await node_fs_1.promises.readFile(path.join(context.globalStorageUri.fsPath, "current-account.json"), "utf8"));
        currentAccountId = current.accountId;
    }
    catch { /* No Codex session has been registered yet. */ }
    const pending = context.globalState.get(PENDING_SWITCH_KEY);
    if (!pending)
        return { accountId: currentAccountId ?? activeId, pending: false };
    if (pending.accountId === currentAccountId) {
        await context.globalState.update(PENDING_SWITCH_KEY, undefined);
        return { accountId: currentAccountId, pending: false };
    }
    try {
        const result = JSON.parse(await node_fs_1.promises.readFile(path.join(context.globalStorageUri.fsPath, "switch-result.json"), "utf8"));
        if (result.accountId === pending.accountId && result.success === false && (result.completedAt ?? 0) >= pending.requestedAt) {
            await context.globalState.update(PENDING_SWITCH_KEY, undefined);
            return { accountId: currentAccountId ?? activeId, pending: false };
        }
    }
    catch {
        // A missing result means the request is still queued or no proxy is running yet.
    }
    return { accountId: pending.accountId, pending: true };
}
async function readCurrentAccountId(context) {
    try {
        const current = JSON.parse(await node_fs_1.promises.readFile(path.join(context.globalStorageUri.fsPath, "current-account.json"), "utf8"));
        return current.accountId;
    }
    catch {
        return activeId;
    }
}
async function updateStatusBar(context, store) {
    if (!statusItem)
        return;
    if (!config().get("showStatusBar", true)) {
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
    const cache = context.globalState.get(LIMIT_CACHE_KEY, {});
    const cached = cache[account.id];
    const tokenState = context.globalState.get(TOKEN_REFRESH_STATE_KEY, {})[account.id];
    const remaining = cached?.result ? `${(0, codexClient_1.remainingPercent)(cached.result).toFixed(0)}%` : "quota ?";
    const stale = cached?.checkedAt ? Date.now() - cached.checkedAt > config().get("cacheTtlSeconds", 60) * 1000 : false;
    statusItem.text = `◆ ${account.name} ${remaining}${stale ? "*" : ""}`;
    statusItem.tooltip = [
        `Codex account: ${account.name}`,
        account.email ? `Email: ${account.email}` : undefined,
        account.planType ? `Plan: ${account.planType}` : undefined,
        cached?.result ? `Quota: ${(0, quotaPresentation_1.formatLimits)(cached.result)}` : "Quota: not checked yet",
        tokenState?.refreshedAt ? `Token refreshed: ${new Date(tokenState.refreshedAt).toLocaleString()}` : undefined,
        tokenState?.error ? `Token refresh error: ${tokenState.error}` : undefined,
        stale ? "Quota cache is stale" : undefined,
    ].filter(Boolean).join("\n");
}
async function reauthenticateAccount(context, store, account) {
    const terminal = vscode.window.createTerminal({ name: `Codex login (${account.name})`, env: codexLoginEnvironment(account.codexHome) });
    terminal.show(true);
    terminal.sendText(codexLoginCommand(context.extensionPath), true);
    vscode.window.showInformationMessage(`Complete authentication for '${account.name}' in the browser, then close the login terminal.`);
    let completed = false;
    const poll = setInterval(async () => {
        if (completed)
            return;
        try {
            const identity = await (0, codexClient_1.readIdentity)(account);
            if (!identity.email)
                return;
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
        }
        catch { /* Keep waiting for the browser login. */ }
    }, 2000);
    const closeListener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== terminal || completed)
            return;
        clearInterval(poll);
        closeListener.dispose();
    });
    context.subscriptions.push(closeListener);
}
async function selectAccountForReauthentication(context, store) {
    const selected = await vscode.window.showQuickPick(store.all().map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })), { placeHolder: "Choose the account to re-authenticate" });
    if (selected)
        await reauthenticateAccount(context, store, selected.account);
}
async function chooseAccount(context, store, minimum, excludeId) {
    const cooldownMs = config().get("cooldownMinutes", 10) * 60 * 1000;
    const candidates = store.all().filter((account) => {
        if (!account.enabled || account.id === excludeId)
            return false;
        if (!account.lastLimitedAt || cooldownMs <= 0)
            return true;
        return Date.now() - account.lastLimitedAt >= cooldownMs;
    });
    const checked = [];
    for (const account of candidates) {
        try {
            const limits = await getLimits(context, account);
            const remaining = (0, codexClient_1.remainingPercent)(limits);
            if (remaining >= minimum)
                checked.push({ account, limits, remaining });
        }
        catch (error) {
            console.warn(`Could not check Codex profile ${account.name}:`, error);
        }
    }
    checked.sort((a, b) => b.remaining - a.remaining || a.account.priority - b.account.priority);
    return checked[0];
}
async function addAccount(context, store) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
    await node_fs_1.promises.mkdir(codexHome, { recursive: true, mode: 0o700 });
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
    const finishLogin = async () => {
        if (completed)
            return true;
        try {
            const identity = await (0, codexClient_1.readIdentity)(pending);
            if (!identity.email)
                throw new Error("No authenticated email returned");
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
                await node_fs_1.promises.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
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
        }
        catch {
            return false;
        }
    };
    const poll = setInterval(() => void finishLogin(), 2000);
    const closeListener = vscode.window.onDidCloseTerminal(async (closed) => {
        if (closed !== terminal || completed)
            return;
        clearInterval(poll);
        const loggedIn = await finishLogin();
        if (!loggedIn) {
            await store.remove(id);
            await node_fs_1.promises.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
            vscode.window.showErrorMessage("Could not verify the Codex login. The account was not added.");
        }
    });
    context.subscriptions.push(closeListener);
}
async function importCurrentAccount(context, store) {
    const sourceAuth = path.join(sharedCodexHome(), "auth.json");
    try {
        await node_fs_1.promises.access(sourceAuth);
    }
    catch {
        vscode.window.showWarningMessage("No current Codex auth.json was found to import.");
        return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
    await node_fs_1.promises.mkdir(codexHome, { recursive: true, mode: 0o700 });
    await node_fs_1.promises.copyFile(sourceAuth, path.join(codexHome, "auth.json"));
    await node_fs_1.promises.chmod(path.join(codexHome, "auth.json"), 0o600).catch(() => undefined);
    const pending = await store.add("Imported account", codexHome, id);
    try {
        const identity = await (0, codexClient_1.readIdentity)(pending);
        if (!identity.email)
            throw new Error("No authenticated email returned");
        const existing = store.all().find((account) => account.email === identity.email && account.id !== id);
        const nickname = await vscode.window.showInputBox({
            prompt: `Nickname for imported account ${identity.email}`,
            value: existing ? `${identity.email.split("@")[0]} copy` : identity.email.split("@")[0],
            validateInput: (value) => value.trim() ? undefined : "Enter a nickname",
        });
        if (!nickname) {
            await store.remove(id);
            await node_fs_1.promises.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
            return;
        }
        await store.update(id, { name: nickname.trim(), email: identity.email, planType: identity.planType });
        await syncLauncherRegistry(context, store);
        await getLimits(context, { ...pending, name: nickname.trim(), email: identity.email, planType: identity.planType }, true).catch(() => undefined);
        await updateStatusBar(context, store);
        void accountsView?.refresh(true);
        vscode.window.showInformationMessage(`Imported Codex account ${identity.email}.`);
    }
    catch (error) {
        await store.remove(id);
        await node_fs_1.promises.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
        vscode.window.showErrorMessage(`Could not import current Codex account: ${String(error)}`);
    }
}
async function exportAccounts(context, store) {
    const accounts = store.all();
    if (!accounts.length) {
        vscode.window.showInformationMessage("No Codex accounts configured.");
        return;
    }
    const answer = await vscode.window.showWarningMessage("Profile backups contain Codex credentials. Encrypted backup is recommended.", "Encrypted Backup", "Plain JSON (Advanced)", "Cancel");
    if (answer !== "Encrypted Backup" && answer !== "Plain JSON (Advanced)")
        return;
    let password;
    if (answer === "Encrypted Backup") {
        password = await requestBackupPassword(true);
        if (!password)
            return;
    }
    else {
        const confirmed = await vscode.window.showWarningMessage("Plain JSON exposes reusable authentication tokens to anyone who can read the file.", { modal: true }, "Export Plain JSON");
        if (confirmed !== "Export Plain JSON")
            return;
    }
    const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), password ? "codex-account-profiles-backup.encrypted.json" : "codex-account-profiles-backup.json")),
        filters: { JSON: ["json"] },
        saveLabel: "Export Profiles",
    });
    if (!target)
        return;
    const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        accounts: [],
    };
    for (const account of accounts) {
        try {
            const authJson = JSON.parse(await node_fs_1.promises.readFile(path.join(account.codexHome, "auth.json"), "utf8"));
            backup.accounts.push({
                name: account.name,
                email: account.email,
                planType: account.planType,
                enabled: account.enabled,
                priority: account.priority,
                authJson,
            });
        }
        catch {
            // Skip profiles without a readable auth.json.
        }
    }
    const output = password ? await (0, backupCrypto_1.encryptBackup)(backup, password) : backup;
    await (0, fsUtils_1.writeJsonAtomic)(target.fsPath, output);
    vscode.window.showInformationMessage(`Exported ${backup.accounts.length} Codex account backup${backup.accounts.length === 1 ? "" : "s"}${password ? " with encryption" : ""}.`);
}
async function requestBackupPassword(confirm) {
    const password = await vscode.window.showInputBox({
        title: "Encrypt Profile Backup",
        prompt: "Enter a password with at least 10 characters",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => value.length >= 10 ? undefined : "Use at least 10 characters",
    });
    if (!password || !confirm)
        return password;
    const repeated = await vscode.window.showInputBox({
        title: "Confirm Backup Password",
        prompt: "Enter the same password again",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => value === password ? undefined : "Passwords do not match",
    });
    return repeated === password ? password : undefined;
}
async function importAccountsBackup(context, store) {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { JSON: ["json"] },
        openLabel: "Import Profiles",
    });
    const source = selected?.[0];
    if (!source)
        return;
    let parsed;
    try {
        const file = JSON.parse(await node_fs_1.promises.readFile(source.fsPath, "utf8"));
        let contents = file;
        if ((0, backupCrypto_1.isEncryptedBackup)(file)) {
            const password = await requestBackupPassword(false);
            if (!password)
                return;
            contents = await (0, backupCrypto_1.decryptBackup)(file, password);
        }
        else {
            const answer = await vscode.window.showWarningMessage("This is an unencrypted backup containing authentication tokens. Import only from a trusted source.", { modal: true }, "Import Plain JSON");
            if (answer !== "Import Plain JSON")
                return;
        }
        parsed = (0, accountBackup_1.parseAccountBackup)(contents);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Could not import Codex account backup: ${String(error)}`);
        return;
    }
    let imported = 0;
    for (const entry of parsed.accounts) {
        if (!entry.authJson || typeof entry.authJson !== "object")
            continue;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const codexHome = path.join(context.globalStorageUri.fsPath, "profiles", id);
        await node_fs_1.promises.mkdir(codexHome, { recursive: true, mode: 0o700 });
        await (0, fsUtils_1.writeFileAtomic)(path.join(codexHome, "auth.json"), JSON.stringify(entry.authJson, null, 2));
        const account = await store.add(entry.name || "Imported account", codexHome, id);
        let identity;
        try {
            identity = await (0, codexClient_1.readIdentity)(account);
        }
        catch {
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
async function syncLauncherRegistry(context, store) {
    let forcedAccountId = activeId;
    if (forcedAccountId === undefined) {
        try {
            const current = JSON.parse(await node_fs_1.promises.readFile(path.join(context.globalStorageUri.fsPath, "accounts.json"), "utf8"));
            forcedAccountId = current.forcedAccountId ?? null;
        }
        catch {
            forcedAccountId = null;
        }
    }
    await (0, fsUtils_1.writeJsonAtomic)(path.join(context.globalStorageUri.fsPath, "accounts.json"), {
        forcedAccountId,
        startupSelectionMode: config().get("startupSelectionMode", 2),
        startupProbePrompt: config().get("startupProbePrompt", "Reply with OK."),
        autoSwitch: config().get("autoSwitch", false),
        cooldownMinutes: config().get("cooldownMinutes", 10),
        accounts: store.all().map(({ id, name, email, planType, codexHome, enabled, priority }) => ({ id, name, email, planType, codexHome, enabled, priority })),
    });
}
function managedProfileRoots(context) {
    const storageParent = path.dirname(context.globalStorageUri.fsPath);
    return [
        path.join(context.globalStorageUri.fsPath, "profiles"),
        path.join(storageParent, TEMPORARY_EXTENSION_STORAGE_ID, "profiles"),
    ].map((root) => path.resolve(root));
}
function isManagedProfile(context, codexHome) {
    return (0, profilePaths_1.isPathInsideRoots)(codexHome, managedProfileRoots(context));
}
async function isAccountBackendRunning(context, accountId) {
    const storageParent = path.dirname(context.globalStorageUri.fsPath);
    const dataDirectories = [
        context.globalStorageUri.fsPath,
        path.join(storageParent, TEMPORARY_EXTENSION_STORAGE_ID),
    ];
    for (const dataDirectory of dataDirectories) {
        try {
            const current = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDirectory, "current-account.json"), "utf8"));
            if (current.accountId !== accountId)
                continue;
            const pid = Number(await node_fs_1.promises.readFile(path.join(dataDirectory, "codex.pid"), "utf8"));
            if (!Number.isInteger(pid) || pid <= 0)
                continue;
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            if (error.code === "EPERM")
                return true;
        }
    }
    return false;
}
async function deleteAccount(context, store, account) {
    if (await isAccountBackendRunning(context, account.id)) {
        vscode.window.showWarningMessage("Switch away from this active Codex account before removing it.");
        return false;
    }
    await store.remove(account.id);
    if (activeId === account.id)
        activeId = undefined;
    const limitCache = context.globalState.get(LIMIT_CACHE_KEY, {});
    const tokenState = context.globalState.get(TOKEN_REFRESH_STATE_KEY, {});
    delete limitCache[account.id];
    delete tokenState[account.id];
    await Promise.all([
        context.globalState.update(LIMIT_CACHE_KEY, limitCache),
        context.globalState.update(TOKEN_REFRESH_STATE_KEY, tokenState),
    ]);
    if (isManagedProfile(context, account.codexHome)) {
        await node_fs_1.promises.rm(account.codexHome, { recursive: true, force: true });
    }
    await syncLauncherRegistry(context, store);
    return true;
}
async function removeAccount(context, store) {
    const accounts = store.all();
    const selected = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })), { placeHolder: "Select an account to remove" });
    if (!selected)
        return;
    const answer = await vscode.window.showWarningMessage(`Remove Codex account '${selected.account.name}' and delete its local authentication tokens?`, "Remove", "Cancel");
    if (answer === "Remove")
        await deleteAccount(context, store, selected.account);
}
async function showLimits(context, store, force = false) {
    const rows = [];
    for (const account of store.all()) {
        try {
            const limits = await getLimits(context, account, force);
            const accountContext = account.planType ? `, ${account.planType}` : "";
            rows.push(`${account.name} (${account.email ?? "no email"}${accountContext}): ${(0, quotaPresentation_1.formatLimits)(limits)}`);
        }
        catch (error) {
            rows.push(`${account.name}: unavailable`);
        }
    }
    vscode.window.showInformationMessage(rows.length ? rows.join(" | ") : "No Codex accounts configured.");
}
async function switchAccount(context, store, force = false) {
    const selected = await chooseAccount(context, store, config().get("minimumRemainingPercent", 1));
    if (!selected) {
        vscode.window.showWarningMessage("No enabled Codex account has enough available quota.");
        return undefined;
    }
    if (!force && config().get("confirmBeforeSwitch", true)) {
        const answer = await vscode.window.showInformationMessage(`Use Codex account '${selected.account.name}'?`, "Switch", "Cancel");
        if (answer !== "Switch")
            return undefined;
    }
    activeId = selected.account.id;
    await markPendingSwitch(context, selected.account.id);
    await syncLauncherRegistry(context, store);
    await updateStatusBar(context, store);
    return selected.account;
}
async function requestBackendSwitch(context, store, account, confirm) {
    if (confirm) {
        const answer = await vscode.window.showWarningMessage(`Queue Codex switch to '${account.name}' without reloading VS Code? It will apply after the current request finishes.`, "Switch", "Cancel");
        if (answer !== "Switch")
            return false;
    }
    activeId = account.id;
    await markPendingSwitch(context, account.id);
    await syncLauncherRegistry(context, store);
    try {
        try {
            await node_fs_1.promises.unlink(path.join(context.globalStorageUri.fsPath, "switch-result.json"));
        }
        catch { }
        await (0, fsUtils_1.writeJsonAtomic)(path.join(context.globalStorageUri.fsPath, "switch-request.json"), { accountId: account.id, requestedAt: Date.now() });
        vscode.window.showInformationMessage(`Codex switch to '${account.name}' queued. It will apply after the current request finishes.`);
        await updateStatusBar(context, store);
        void accountsView?.refresh(true);
        return true;
    }
    catch {
        vscode.window.showErrorMessage("Could not queue the backend switch test.");
        return false;
    }
}
async function monitorAutomaticSwitch(context, store) {
    if (!config().get("autoSwitch", false))
        return;
    if (automaticSwitchInFlight)
        return;
    const now = Date.now();
    const lastSwitch = context.globalState.get("codexAccountProfiles.lastAutoSwitch", 0);
    if (now - lastSwitch < 30000)
        return;
    const dataDir = context.globalStorageUri.fsPath;
    let currentId;
    let trigger = false;
    let triggerAt = 0;
    let finishedAt = 0;
    try {
        const current = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDir, "current-account.json"), "utf8"));
        currentId = current.accountId;
    }
    catch {
        return;
    }
    try {
        const event = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDir, "turn-finished.json"), "utf8"));
        if (event.accountId === currentId)
            finishedAt = Number(event.finishedAt) || 0;
    }
    catch { /* No completed message has been reported yet. */ }
    try {
        const event = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDir, "rate-limit-trigger.json"), "utf8"));
        trigger = event.accountId === currentId;
        if (trigger)
            triggerAt = Number(event.detectedAt) || 0;
    }
    catch { /* Automatic switching requires a confirmed launcher event. */ }
    const current = store.all().find((account) => account.id === currentId && account.enabled);
    if (!current)
        return;
    const lastDecision = context.globalState.get("codexAccountProfiles.lastAutoDecision", 0);
    const eventAt = (0, quotaPolicy_1.confirmedLimitBoundary)(trigger, triggerAt, finishedAt, lastDecision);
    if (!eventAt)
        return;
    automaticSwitchInFlight = true;
    try {
        const currentLimits = await getLimits(context, current, true);
        const currentRemaining = (0, codexClient_1.remainingPercent)(currentLimits);
        if (trigger)
            await store.markLimited(current.id);
        // Only move at a message boundary, and only when the current account is
        // below 100% while another account is completely available.
        if (currentRemaining >= 100) {
            await context.globalState.update("codexAccountProfiles.lastAutoDecision", eventAt);
            try {
                await node_fs_1.promises.unlink(path.join(dataDir, "rate-limit-trigger.json"));
            }
            catch { }
            try {
                await node_fs_1.promises.unlink(path.join(dataDir, "turn-finished.json"));
            }
            catch { }
            return;
        }
        const next = await chooseAccount(context, store, 100, current.id);
        try {
            await node_fs_1.promises.unlink(path.join(dataDir, "rate-limit-trigger.json"));
        }
        catch { /* Already consumed. */ }
        try {
            await node_fs_1.promises.unlink(path.join(dataDir, "turn-finished.json"));
        }
        catch { /* Already consumed. */ }
        if (!next) {
            await context.globalState.update("codexAccountProfiles.lastAutoDecision", eventAt);
            if (trigger)
                vscode.window.showWarningMessage("The Codex account reached its limit and no other account is available.");
            return;
        }
        await context.globalState.update("codexAccountProfiles.lastAutoDecision", eventAt);
        await context.globalState.update("codexAccountProfiles.lastAutoSwitch", now);
        await requestBackendSwitch(context, store, next.account, false);
        vscode.window.showInformationMessage(`Limit reached. Automatically switching to '${next.account.name}'.`);
    }
    finally {
        automaticSwitchInFlight = false;
    }
}
async function runTokenRefreshSweep(context, store) {
    if (!config().get("backgroundTokenRefresh", false))
        return;
    const state = context.globalState.get(TOKEN_REFRESH_STATE_KEY, {});
    let changed = false;
    for (const account of store.all().filter((item) => item.enabled)) {
        const result = await (0, authTokens_1.refreshAccountTokensIfNeeded)(account);
        state[account.id] = {
            checkedAt: Date.now(),
            refreshedAt: result.refreshed ? Date.now() : state[account.id]?.refreshedAt,
            error: result.error,
        };
        changed = true;
    }
    if (changed)
        await context.globalState.update(TOKEN_REFRESH_STATE_KEY, state);
    await updateStatusBar(context, store);
    void accountsView?.refresh();
}
async function readExternalAuthSignature() {
    const authPath = path.join(sharedCodexHome(), "auth.json");
    try {
        const stat = await node_fs_1.promises.stat(authPath);
        return `${authPath}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    }
    catch {
        return undefined;
    }
}
async function syncExternalAuthState(context, store) {
    const next = await readExternalAuthSignature();
    if (next === context.globalState.get(EXTERNAL_AUTH_SIGNATURE_KEY))
        return;
    await context.globalState.update(EXTERNAL_AUTH_SIGNATURE_KEY, next);
    await updateStatusBar(context, store);
    void accountsView?.refresh();
}
async function manuallySelectAccount(context, store) {
    const choices = store.all().filter((account) => account.enabled).map((account) => ({
        label: account.name,
        description: [account.email, account.planType].filter(Boolean).join(" / ") || "no email",
        account,
    }));
    const choice = await vscode.window.showQuickPick(choices, { placeHolder: "Choose the account for the next Codex session" });
    if (!choice)
        return;
    await requestBackendSwitch(context, store, choice.account, true);
}
function activate(context) {
    const store = new accountStore_1.AccountStore(context.globalState);
    accountsView = new accountsView_1.AccountsView(context, store, {
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
        getLimitCache: () => context.globalState.get(LIMIT_CACHE_KEY, {}),
        getTokenRefreshState: () => context.globalState.get(TOKEN_REFRESH_STATE_KEY, {}),
        isAuthenticationError,
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexAccountProfiles.accountsView", accountsView));
    process.env.CODEX_ACCOUNT_PROFILES_DATA = context.globalStorageUri.fsPath;
    void node_fs_1.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true })
        .then(() => migrateTemporaryExtensionStorage(context, store))
        .then(() => migrateLegacyConfiguration())
        .then(() => syncLauncherRegistry(context, store));
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
        void vscode.window.showWarningMessage("The official OpenAI Codex extension is not installed. Account switching is ready, but Codex itself is required.", "Find Codex Extension").then((choice) => {
            if (choice === "Find Codex Extension")
                void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
        });
    }
    void installNativeLauncher(context).then(async () => {
        const configuredCli = vscode.workspace.getConfiguration("chatgpt").get("cliExecutable");
        if (isObsoleteVersionedLauncher(context, configuredCli)) {
            await enableNativeIntegration(context, nativeCli);
            vscode.window.showInformationMessage("Codex launcher path was repaired. Reload the VS Code window.");
            return;
        }
        if (configuredCli === nativeCli || context.globalState.get(NATIVE_INTEGRATION_PROMPTED_KEY, false))
            return;
        await context.globalState.update(NATIVE_INTEGRATION_PROMPTED_KEY, true);
        const choice = await vscode.window.showInformationMessage("Enable Codex Account Profiles for the official Codex extension? Your current CLI setting will be preserved.", "Enable", "Not Now");
        if (choice !== "Enable")
            return;
        await enableNativeIntegration(context, nativeCli);
        vscode.window.showInformationMessage("Native Codex integration configured. Reload the VS Code window.");
    }).catch(() => {
        vscode.window.showWarningMessage("Could not configure the official Codex extension. Run Codex: Enable Native Integration.");
    });
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.command = "codexAccountProfiles.switchAccount";
    statusItem.text = "◆ Codex account";
    statusItem.tooltip = "Select Codex account";
    if (config().get("showStatusBar", true))
        statusItem.show();
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
        const account = await switchAccount(context, store, config().get("autoSwitch", false));
        if (!account)
            return;
        const terminal = vscode.window.createTerminal({ name: `Codex (${account.name})`, env: { CODEX_HOME: account.codexHome } });
        terminal.show(true);
        terminal.sendText("codex", true);
    }));
    const refreshMs = Math.max(10, config().get("refreshIntervalSeconds", 60)) * 1000;
    const refreshTimer = setInterval(() => {
        const enabled = store.all().filter((account) => account.enabled);
        if (!enabled.length)
            return;
        refreshCursor = refreshCursor % enabled.length;
        const account = enabled[refreshCursor];
        refreshCursor = (refreshCursor + 1) % enabled.length;
        void getLimits(context, account, true)
            .then(() => updateStatusBar(context, store))
            .catch(() => { });
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
    void (0, proxyEnv_1.loadCodexProxyEnvironment)(sharedCodexHome()).catch((error) => {
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
function deactivate() { }
//# sourceMappingURL=extension.js.map