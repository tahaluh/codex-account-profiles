import * as vscode from "vscode";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { AccountProfile, AccountStore } from "./accountStore";
import { bucketRemainingPercent, extractLimitBuckets, extractWindows, limitBucketLabel, readIdentity, readRateLimits, remainingPercent, resetLabel, RateLimitBucket, RateLimits, RateWindow } from "./codexClient";

let activeId: string | undefined;
let accountsView: AccountsView | undefined;
const LIMIT_CACHE_KEY = "codexAccountSwitcher.rateLimitCache";
const REOPEN_CODEX_KEY = "codexAccountSwitcher.reopenCodexAfterSwitch";
const REOPEN_CHAT_URI_KEY = "codexAccountSwitcher.reopenChatUri";
const PENDING_SWITCH_KEY = "codexAccountSwitcher.pendingSwitch";
const PENDING_SWITCH_TTL_MS = 30000;

interface LimitCacheEntry {
  result?: RateLimits;
  checkedAt: number;
  error?: string;
}

type LimitCache = Record<string, LimitCacheEntry>;

interface PendingSwitch {
  accountId: string;
  requestedAt: number;
}

function config() {
  return vscode.workspace.getConfiguration("codexAccountSwitcher");
}

function isAuthenticationError(error: unknown): boolean {
  return /\b(auth|authentication|authenticated|unauthenticated|authorization|authorized|credential|credentials|login|logged.?out|sign.?in|token|expired|unauthorized|forbidden|401|403)\b/i.test(String(error));
}

async function getLimits(context: vscode.ExtensionContext, account: AccountProfile, force = false): Promise<RateLimits> {
  const cache = context.globalState.get<LimitCache>(LIMIT_CACHE_KEY, {});
  const cached = cache[account.id];
  const ttl = config().get<number>("cacheTtlSeconds", 60) * 1000;
  if (!force && cached?.result && Date.now() - cached.checkedAt < ttl) return cached.result;
  try {
    const result = await readRateLimits(account);
    await context.globalState.update(LIMIT_CACHE_KEY, {
      ...cache,
      [account.id]: { result, checkedAt: Date.now() },
    });
    return result;
  } catch (error) {
    await context.globalState.update(LIMIT_CACHE_KEY, {
      ...cache,
      [account.id]: { ...cached, checkedAt: cached?.checkedAt ?? 0, error: String(error) },
    });
    if (isAuthenticationError(error)) throw error;
    if (cached?.result) return cached.result;
    throw error;
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

async function markPendingSwitch(context: vscode.ExtensionContext, accountId: string): Promise<void> {
  await context.globalState.update(PENDING_SWITCH_KEY, { accountId, requestedAt: Date.now() });
}

async function resolveDisplayedAccountId(context: vscode.ExtensionContext): Promise<{ accountId?: string; pending: boolean }> {
  let currentAccountId: string | undefined;
  try {
    const current = JSON.parse(await fs.readFile(path.join(context.globalStorageUri.fsPath, "current-account.json"), "utf8"));
    currentAccountId = current.accountId;
  } catch { /* No Codex session has been registered yet. */ }

  const pending = context.globalState.get<PendingSwitch>(PENDING_SWITCH_KEY);
  if (!pending) return { accountId: currentAccountId ?? activeId, pending: false };
  if (pending.accountId === currentAccountId) {
    await context.globalState.update(PENDING_SWITCH_KEY, undefined);
    return { accountId: currentAccountId, pending: false };
  }
  if (Date.now() - pending.requestedAt <= PENDING_SWITCH_TTL_MS) {
    return { accountId: pending.accountId, pending: true };
  }
  await context.globalState.update(PENDING_SWITCH_KEY, undefined);
  return { accountId: currentAccountId ?? activeId, pending: false };
}

function windowName(window: RateWindow): string {
  if (window.windowDurationMins === 300) return "5h";
  if (window.windowDurationMins === 10080) return "weekly";
  return window.windowDurationMins ? `${window.windowDurationMins}m` : "limit";
}

function formatRelativeTime(targetSeconds: number): string {
  const diffSeconds = Math.max(0, targetSeconds - Math.floor(Date.now() / 1000));
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "less than 1m";
}

function formatResetText(resetSeconds?: number): string {
  if (!resetSeconds) return "Reset unknown";
  return `Reset in ${formatRelativeTime(resetSeconds)} (${new Date(resetSeconds * 1000).toLocaleString()})`;
}

function formatResetHtml(resetSeconds?: number): string {
  if (!resetSeconds) return "<small>Reset unknown</small>";
  const date = new Date(resetSeconds * 1000).toLocaleString();
  return `<small><span class="reset-relative">Reset in ${escapeHtml(formatRelativeTime(resetSeconds))}</span><span class="reset-date">${escapeHtml(date)}</span></small>`;
}

function formatLimits(result: RateLimits): string {
  return extractWindows(result).map((window) => {
    const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
    return `${windowName(window)}: ${remaining.toFixed(1)}% remaining, ${formatResetText(window.resetsAt)}`;
  }).join(" | ");
}

function formatBucketHtml(bucket: RateLimitBucket, showBucketLabel: boolean): string {
  const bucketLabel = showBucketLabel ? `<div class="bucket-label">${escapeHtml(limitBucketLabel(bucket))}</div>` : "";
  const windows = extractWindows(bucket).map((window) => {
    const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
    return `<div class="limit"><div class="limit-head"><strong>${escapeHtml(windowName(window))}</strong><span>${remaining.toFixed(1)}% remaining</span></div><div class="bar" role="progressbar" aria-valuenow="${remaining.toFixed(1)}"><i style="width:${remaining.toFixed(1)}%"></i></div>${formatResetHtml(window.resetsAt)}</div>`;
  }).join("");
  const reachedType = bucket.rateLimitReachedType ? `<small class="limit-reason">${escapeHtml(bucket.rateLimitReachedType)}</small>` : "";
  return `<section class="bucket ${bucketRemainingPercent(bucket) <= 0 ? "depleted" : ""}">${bucketLabel}${windows}${reachedType}</section>`;
}

function formatLimitHtml(result: RateLimits): string {
  const availableResets = result.rateLimitResetCredits?.availableCount;
  const buckets = extractLimitBuckets(result);
  const nextReset = buckets.flatMap((bucket) => extractWindows(bucket).map((window) => window.resetsAt)).filter((value): value is number => Boolean(value)).sort()[0];
  const summaryParts = [];
  if (typeof availableResets === "number") summaryParts.push(`${availableResets} reset${availableResets === 1 ? "" : "s"} available`);
  if (nextReset) summaryParts.push(`Next reset in ${formatRelativeTime(nextReset)}`);
  const summary = summaryParts.length ? `<div class="reset-summary">${escapeHtml(summaryParts.join(" | "))}</div>` : "";
  const showBucketLabels = buckets.length > 1 || buckets.some((bucket) => bucket.planType || bucket.limitName);
  return summary + buckets.map((bucket) => formatBucketHtml(bucket, showBucketLabels)).join("");
}

async function reauthenticateAccount(context: vscode.ExtensionContext, store: AccountStore, account: AccountProfile): Promise<void> {
  const terminal = vscode.window.createTerminal({ name: `Codex login (${account.name})`, env: { CODEX_HOME: account.codexHome } });
  terminal.show(true);
  terminal.sendText("codex login", true);
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

async function chooseAccount(context: vscode.ExtensionContext, store: AccountStore, minimum: number, excludeId?: string): Promise<{ account: AccountProfile; limits: RateLimits } | undefined> {
  const candidates = store.all().filter((account) => account.enabled && account.id !== excludeId);
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
    env: { CODEX_HOME: codexHome },
  });
  terminal.show(true);
  terminal.sendText("codex login", true);
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
        return false;
      }
      await store.update(id, { name: nickname.trim(), email: identity.email, planType: identity.planType });
      await syncLauncherRegistry(context, store);
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
      vscode.window.showErrorMessage("Could not verify the Codex login. The account was not added.");
    }
  });
  context.subscriptions.push(closeListener);
}

async function syncLauncherRegistry(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  let forcedAccountId: string | null | undefined = activeId;
  if (forcedAccountId === undefined) {
    try {
      const current = JSON.parse(await fs.readFile(path.join(context.globalStorageUri.fsPath, "accounts.json"), "utf8"));
      forcedAccountId = current.forcedAccountId ?? null;
    } catch {
      forcedAccountId = null;
    }
  }
  await fs.writeFile(
    path.join(context.globalStorageUri.fsPath, "accounts.json"),
    JSON.stringify({
      forcedAccountId,
      accounts: store.all().map(({ id, name, email, planType, codexHome, enabled, priority }) => ({ id, name, email, planType, codexHome, enabled, priority })),
    }, null, 2),
    { mode: 0o600 },
  );
}

async function removeAccount(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  const accounts = store.all();
  const selected = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })), { placeHolder: "Select an account to remove" });
  if (!selected) return;
  await store.remove(selected.account.id);
  if (activeId === selected.account.id) activeId = undefined;
  await syncLauncherRegistry(context, store);
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
  activeId = selected.account.id;
  await markPendingSwitch(context, selected.account.id);
  await syncLauncherRegistry(context, store);
  vscode.window.setStatusBarMessage(`Codex: ${selected.account.name} (${remainingPercent(selected.limits).toFixed(0)}% left)`, 5000);
  return selected.account;
}

async function restartCodexOnly(context: vscode.ExtensionContext): Promise<void> {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabInput = activeTab?.input as { uri?: vscode.Uri; viewType?: string } | undefined;
  const chatUri = tabInput?.viewType === "chatgpt.conversationEditor" ? tabInput.uri?.toString() : undefined;
  await context.globalState.update(REOPEN_CHAT_URI_KEY, chatUri);
  await context.globalState.update(REOPEN_CODEX_KEY, true);
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes("workbench.action.restartExtensionHost")) {
    await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
  } else {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function requestBackendSwitch(context: vscode.ExtensionContext, store: AccountStore, account: AccountProfile, confirm: boolean): Promise<boolean> {
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(
      `Switch Codex to '${account.name}' without reloading VS Code? The current request may be interrupted.`,
      "Switch", "Cancel",
    );
    if (answer !== "Switch") return false;
  }
  activeId = account.id;
  await markPendingSwitch(context, account.id);
  await syncLauncherRegistry(context, store);
  try {
    await fs.writeFile(
      path.join(context.globalStorageUri.fsPath, "switch-request.json"),
      JSON.stringify({ accountId: account.id, requestedAt: Date.now() }),
      { mode: 0o600 },
    );
    vscode.window.showInformationMessage(`Switch to '${account.name}' queued. The next Codex request will use it.`);
    void accountsView?.refresh(true);
    return true;
  } catch {
    vscode.window.showErrorMessage("Could not queue the backend switch test.");
    return false;
  }
}

async function monitorAutomaticSwitch(context: vscode.ExtensionContext, store: AccountStore): Promise<void> {
  if (!config().get<boolean>("autoSwitch", false)) return;
  const now = Date.now();
  const lastSwitch = context.globalState.get<number>("codexAccountSwitcher.lastAutoSwitch", 0);
  if (now - lastSwitch < 30000) return;
  const dataDir = context.globalStorageUri.fsPath;
  let currentId: string | undefined;
  let trigger = false;
  try {
    const current = JSON.parse(await fs.readFile(path.join(dataDir, "current-account.json"), "utf8"));
    currentId = current.accountId;
  } catch { return; }
  try {
    const event = JSON.parse(await fs.readFile(path.join(dataDir, "rate-limit-trigger.json"), "utf8"));
    trigger = event.accountId === currentId;
  } catch { /* Polling limits remains the fallback. */ }
  const current = store.all().find((account) => account.id === currentId && account.enabled);
  if (!current) return;
  try {
    const limits = await getLimits(context, current, trigger);
    if (!trigger && remainingPercent(limits) > 0) return;
  } catch {
    if (!trigger) return;
  }
  const next = await chooseAccount(context, store, config().get<number>("minimumRemainingPercent", 1), current.id);
  if (!next) {
    vscode.window.showWarningMessage("The Codex account reached its limit and no other account is available.");
    return;
  }
  await context.globalState.update("codexAccountSwitcher.lastAutoSwitch", now);
  try { await fs.unlink(path.join(dataDir, "rate-limit-trigger.json")); } catch { /* Already consumed. */ }
  await requestBackendSwitch(context, store, next.account, false);
  vscode.window.showInformationMessage(`Limit reached. Automatically switching to '${next.account.name}'.`);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

class AccountsView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext, private readonly store: AccountStore) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message) => {
      if (message.command === "refresh") void this.refresh(true);
      if (message.command === "add") void addAccount(this.context, this.store).then(() => this.refresh());
      if (message.command === "select") void this.select(message.id);
      if (message.command === "remove") void this.remove(message.id);
      if (message.command === "reauth") void this.reauthenticate(message.id);
      if (message.command === "findCodex") void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
    }, undefined, this.context.subscriptions);
    void this.refresh();
  }

  private async select(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id && item.enabled);
    if (!account) return;
    await requestBackendSwitch(this.context, this.store, account, true);
  }

  private async remove(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id);
    if (!account) return;
    const answer = await vscode.window.showWarningMessage(`Remove Codex account '${account.name}'?`, "Remove", "Cancel");
    if (answer !== "Remove") return;
    await this.store.remove(id);
    if (activeId === id) activeId = undefined;
    await syncLauncherRegistry(this.context, this.store);
    await this.refresh(true);
  }

  private async reauthenticate(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id && item.enabled);
    if (account) await reauthenticateAccount(this.context, this.store, account);
  }

  async refresh(force = false): Promise<void> {
    if (!this.view) return;
    const accounts = this.store.all();
    const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
    const displayedAccount = await resolveDisplayedAccountId(this.context);
    const rows: string[] = [];
    for (const account of accounts) {
      let limits = "limits unavailable";
      let hasAuthError = false;
      try {
        limits = formatLimitHtml(await getLimits(this.context, account, force)) || "<div class=\"limit\">No limit data</div>";
      } catch (error) {
        hasAuthError = isAuthenticationError(error);
        limits = hasAuthError
          ? "<div class=\"limit auth-error\"><strong>Authentication required</strong><small>Sign in again to use this account.</small></div>"
          : "limits unavailable";
      }
      const isActive = account.id === displayedAccount.accountId;
      const isPending = isActive && displayedAccount.pending;
      const action = hasAuthError
        ? `<button class="reauth" data-id="${escapeHtml(account.id)}">Re-authenticate</button>`
        : `<button class="switch" data-id="${escapeHtml(account.id)}" ${isActive ? "disabled" : ""}>${isPending ? "Switching..." : isActive ? "Current account" : "Use this account"}</button>`;
      const accountDescription = [account.email ?? "login pending", account.planType].filter(Boolean).join(" / ");
      rows.push(`<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${escapeHtml(account.name)} ${isPending ? "<small>Switching</small>" : isActive ? "<small>In use</small>" : ""}</strong><span>${escapeHtml(accountDescription)}</span></div><button class="remove" data-id="${escapeHtml(account.id)}" title="Remove account" aria-label="Remove account">×</button></div><div class="limits">${limits}</div>${action}</article>`);
    }
    const codexNotice = codexInstalled ? "" : `<div class="notice"><strong>OpenAI Codex is required</strong><span>Install the official Codex extension to use these accounts.</span><button id="findCodex">Find Codex Extension</button></div>`;
    this.view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><style>
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:10px 12px}
      header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px} h3{margin:0;font-size:13px}
      button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:5px 8px;cursor:pointer;font:inherit;font-size:11px}
      button:hover{background:var(--vscode-button-hoverBackground)} button:disabled{opacity:.65;cursor:default}.icon{padding:3px 6px;margin-left:4px}
      article{border-top:1px solid var(--vscode-panel-border);padding:10px 0}.active{border-left:2px solid var(--vscode-testing-iconPassed);padding-left:8px}.account-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.account{display:flex;flex-direction:column;gap:3px;min-width:0}.account small{font-size:10px;color:var(--vscode-testing-iconPassed);font-weight:normal;margin-left:5px}.account span{font-size:11px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}.reset-summary{margin-top:8px;font-size:11px;color:var(--vscode-descriptionForeground)}.limits{display:grid;gap:7px;margin:8px 0}.bucket{display:grid;gap:5px}.bucket-label{font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground)}.bucket.depleted .bucket-label,.limit-reason{color:var(--vscode-editorWarning-foreground)}.limit{display:grid;gap:4px;padding:6px 7px;background:var(--vscode-textBlockQuote-background);border-left:2px solid var(--vscode-panel-border);font-size:11px}.limit.auth-error{border-left-color:var(--vscode-editorWarning-foreground)}.limit-head{display:flex;justify-content:space-between;gap:8px}.bar{height:5px;background:var(--vscode-progressBar-background);opacity:.35;overflow:hidden}.bar i{display:block;height:100%;background:var(--vscode-testing-iconPassed);opacity:1}.limit small{display:grid;gap:1px;color:var(--vscode-descriptionForeground)}.reset-relative{color:var(--vscode-foreground);font-weight:600}.reset-date{font-size:10px}.switch,.reauth{width:100%}.remove{flex:0 0 24px;width:24px;height:24px;padding:0;border:0;background:transparent;color:var(--vscode-testing-iconFailed);font-size:20px;line-height:20px}.remove:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-errorForeground)}.notice{display:grid;gap:7px;margin:0 0 10px;padding:9px;border-left:2px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);font-size:11px}.notice span{color:var(--vscode-descriptionForeground)}
    </style></head><body><header><h3>Codex Accounts</h3><div><button class="icon" id="refresh" title="Refresh limits">↻</button><button class="icon" id="add" title="Add account">+</button></div></header>${codexNotice}${rows.join("") || "<p>No accounts configured.</p>"}<script>
      const vscode=acquireVsCodeApi(); document.getElementById('refresh')?.addEventListener('click',()=>vscode.postMessage({command:'refresh'})); document.getElementById('add')?.addEventListener('click',()=>vscode.postMessage({command:'add'})); document.getElementById('findCodex')?.addEventListener('click',()=>vscode.postMessage({command:'findCodex'})); document.querySelectorAll('.switch').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'select',id:button.dataset.id}))); document.querySelectorAll('.remove').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'remove',id:button.dataset.id}))); document.querySelectorAll('.reauth').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'reauth',id:button.dataset.id})));
    </script></body></html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const store = new AccountStore(context.globalState);
  accountsView = new AccountsView(context, store);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexAccountSwitcher.accountsView", accountsView));
  process.env.CODEX_ACCOUNT_SWITCHER_DATA = context.globalStorageUri.fsPath;
  void fs.mkdir(context.globalStorageUri.fsPath, { recursive: true }).then(() => syncLauncherRegistry(context, store));
  const nativeCli = path.join(context.extensionPath, "bin", "codex-account-switcher");
  if (!vscode.extensions.getExtension("openai.chatgpt")) {
    void vscode.window.showWarningMessage(
      "The official OpenAI Codex extension is not installed. Account switching is ready, but Codex itself is required.",
      "Find Codex Extension",
    ).then((choice) => {
      if (choice === "Find Codex Extension") void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
    });
  }
  const reopenCodex = context.globalState.get<boolean>(REOPEN_CODEX_KEY, false);
  if (reopenCodex) {
    const chatUri = context.globalState.get<string>(REOPEN_CHAT_URI_KEY);
    void context.globalState.update(REOPEN_CODEX_KEY, false);
    void context.globalState.update(REOPEN_CHAT_URI_KEY, undefined);
    setTimeout(() => {
      if (chatUri) {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(chatUri));
      } else {
        void vscode.commands.executeCommand("chatgpt.openSidebar");
      }
    }, 1500);
  }
  void vscode.workspace.getConfiguration("chatgpt").update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global).then(undefined, () => {
    vscode.window.showWarningMessage("Could not connect automatically to the official Codex. Run Codex: Enable Native Integration.");
  });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "codexAccountSwitcher.switchAccount";
  status.text = "$(key) Codex account";
  status.tooltip = "Select Codex account";
  status.show();
  context.subscriptions.push(status);
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.addAccount", () => addAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.removeAccount", () => removeAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.showLimits", () => showLimits(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.switchAccount", () => manuallySelectAccount(context, store)));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.startCodex", async () => {
    const account = await switchAccount(context, store, config().get<boolean>("autoSwitch", false));
    if (!account) return;
    const terminal = vscode.window.createTerminal({ name: `Codex (${account.name})`, env: { CODEX_HOME: account.codexHome } });
    terminal.show(true);
    terminal.sendText("codex", true);
  }));
  const refreshMs = Math.max(10, config().get<number>("refreshIntervalSeconds", 60)) * 1000;
  const refreshTimer = setInterval(() => {
    void Promise.all(store.all().filter((account) => account.enabled).map(async (account) => {
      try { await getLimits(context, account, true); } catch { /* Keep the last successful cache entry. */ }
    }));
  }, refreshMs);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
  const autoSwitchTimer = setInterval(() => void monitorAutomaticSwitch(context, store), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(autoSwitchTimer) });
  const viewRefreshTimer = setInterval(() => void accountsView?.refresh(), 5000);
  context.subscriptions.push({ dispose: () => clearInterval(viewRefreshTimer) });
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.openLauncherFolder", () => {
    vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(context.extensionUri.fsPath));
  }));
  context.subscriptions.push(vscode.commands.registerCommand("codexAccountSwitcher.enableNativeIntegration", async () => {
    await vscode.workspace.getConfiguration("chatgpt").update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage("Native Codex integration configured. Reload the VS Code window.");
  }));
}

export function deactivate(): void {}
