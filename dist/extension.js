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
let activeId;
let accountsView;
let statusItem;
let refreshCursor = 0;
const LIMIT_CACHE_KEY = "codexAccountProfiles.rateLimitCache";
const REOPEN_CODEX_KEY = "codexAccountProfiles.reopenCodexAfterSwitch";
const REOPEN_CHAT_URI_KEY = "codexAccountProfiles.reopenChatUri";
const PENDING_SWITCH_KEY = "codexAccountProfiles.pendingSwitch";
const PENDING_SWITCH_TTL_MS = 30000;
const EXTERNAL_AUTH_SIGNATURE_KEY = "codexAccountProfiles.externalAuthSignature";
const TOKEN_REFRESH_STATE_KEY = "codexAccountProfiles.tokenRefreshState";
function config() {
    return vscode.workspace.getConfiguration("codexAccountProfiles");
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
    if (!force) {
        const shared = await (0, quotaCache_1.readSharedQuotaCache)(account, ttl);
        if (shared) {
            await context.globalState.update(LIMIT_CACHE_KEY, {
                ...cache,
                [account.id]: { result: shared.result, checkedAt: shared.checkedAt },
            });
            return shared.result;
        }
    }
    try {
        const result = await (0, codexClient_1.readRateLimits)(account);
        await (0, quotaCache_1.writeSharedQuotaCache)(account, result);
        await context.globalState.update(LIMIT_CACHE_KEY, {
            ...cache,
            [account.id]: { result, checkedAt: Date.now() },
        });
        return result;
    }
    catch (error) {
        await context.globalState.update(LIMIT_CACHE_KEY, {
            ...cache,
            [account.id]: { ...cached, checkedAt: cached?.checkedAt ?? 0, error: String(error) },
        });
        if (isAuthenticationError(error))
            throw error;
        if (cached?.result)
            return cached.result;
        throw error;
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
    if (Date.now() - pending.requestedAt <= PENDING_SWITCH_TTL_MS) {
        return { accountId: pending.accountId, pending: true };
    }
    await context.globalState.update(PENDING_SWITCH_KEY, undefined);
    return { accountId: currentAccountId ?? activeId, pending: false };
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
        cached?.result ? `Quota: ${formatLimits(cached.result)}` : "Quota: not checked yet",
        tokenState?.refreshedAt ? `Token refreshed: ${new Date(tokenState.refreshedAt).toLocaleString()}` : undefined,
        tokenState?.error ? `Token refresh error: ${tokenState.error}` : undefined,
        stale ? "Quota cache is stale" : undefined,
    ].filter(Boolean).join("\n");
}
function windowName(window) {
    if (window.windowDurationMins === 300)
        return "5h";
    if (window.windowDurationMins === 10080)
        return "weekly";
    return window.windowDurationMins ? `${window.windowDurationMins}m` : "limit";
}
function formatRelativeTime(targetSeconds) {
    const diffSeconds = Math.max(0, targetSeconds - Math.floor(Date.now() / 1000));
    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m`;
    return "less than 1m";
}
function formatResetText(resetSeconds) {
    if (!resetSeconds)
        return "Reset unknown";
    return `Reset in ${formatRelativeTime(resetSeconds)} (${new Date(resetSeconds * 1000).toLocaleString()})`;
}
function formatCompactResetText(resetSeconds) {
    if (!resetSeconds)
        return "reset ?";
    return `resets ${formatRelativeTime(resetSeconds)}`;
}
function formatResetHtml(resetSeconds) {
    if (!resetSeconds)
        return "<small>Reset unknown</small>";
    const date = new Date(resetSeconds * 1000).toLocaleString();
    return `<small><span class="reset-relative">Reset in ${escapeHtml(formatRelativeTime(resetSeconds))}</span><span class="reset-date">${escapeHtml(date)}</span></small>`;
}
function formatLimits(result) {
    return (0, codexClient_1.extractWindows)(result).map((window) => {
        const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
        return `${windowName(window)}: ${remaining.toFixed(1)}% remaining, ${formatResetText(window.resetsAt)}`;
    }).join(" | ");
}
function formatBucketHtml(bucket, showBucketLabel) {
    const bucketLabel = showBucketLabel ? `<div class="bucket-label">${escapeHtml((0, codexClient_1.limitBucketLabel)(bucket))}</div>` : "";
    const windows = (0, codexClient_1.extractWindows)(bucket).map((window) => {
        const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
        return `<div class="limit"><div class="limit-head"><strong>${escapeHtml(windowName(window))}</strong><span>${remaining.toFixed(1)}% remaining</span></div><div class="bar" role="progressbar" aria-valuenow="${remaining.toFixed(1)}"><i style="width:${remaining.toFixed(1)}%"></i></div>${formatResetHtml(window.resetsAt)}</div>`;
    }).join("");
    const reachedType = bucket.rateLimitReachedType ? `<small class="limit-reason">${escapeHtml(bucket.rateLimitReachedType)}</small>` : "";
    return `<section class="bucket ${(0, codexClient_1.bucketRemainingPercent)(bucket) <= 0 ? "depleted" : ""}">${bucketLabel}${windows}${reachedType}</section>`;
}
function formatLimitHtml(result) {
    const availableResets = result.rateLimitResetCredits?.availableCount;
    const buckets = (0, codexClient_1.extractLimitBuckets)(result);
    const nextReset = buckets.flatMap((bucket) => (0, codexClient_1.extractWindows)(bucket).map((window) => window.resetsAt)).filter((value) => Boolean(value)).sort()[0];
    const summaryParts = [];
    if (typeof availableResets === "number")
        summaryParts.push(`${availableResets} reset${availableResets === 1 ? "" : "s"} available`);
    if (nextReset)
        summaryParts.push(`Next reset in ${formatRelativeTime(nextReset)}`);
    const summary = summaryParts.length ? `<div class="reset-summary">${escapeHtml(summaryParts.join(" | "))}</div>` : "";
    const showBucketLabels = buckets.length > 1 || buckets.some((bucket) => bucket.planType || bucket.limitName);
    return summary + buckets.map((bucket) => formatBucketHtml(bucket, showBucketLabels)).join("");
}
async function reauthenticateAccount(context, store, account) {
    const terminal = vscode.window.createTerminal({ name: `Codex login (${account.name})`, env: { CODEX_HOME: account.codexHome } });
    terminal.show(true);
    terminal.sendText("codex login", true);
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
        env: { CODEX_HOME: codexHome },
    });
    terminal.show(true);
    terminal.sendText("codex login", true);
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
                return false;
            }
            await store.update(id, { name: nickname.trim(), email: identity.email, planType: identity.planType });
            await syncLauncherRegistry(context, store);
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
    const answer = await vscode.window.showWarningMessage("Exported backups include local Codex auth tokens. Store the JSON securely and do not share it.", "Export", "Cancel");
    if (answer !== "Export")
        return;
    const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), "codex-account-profiles-backup.json")),
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
    await (0, fsUtils_1.writeJsonAtomic)(target.fsPath, backup);
    vscode.window.showInformationMessage(`Exported ${backup.accounts.length} Codex account backup${backup.accounts.length === 1 ? "" : "s"}.`);
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
    const answer = await vscode.window.showWarningMessage("Only import Codex account backups from a source you trust. The JSON may contain auth tokens.", "Import", "Cancel");
    if (answer !== "Import")
        return;
    const parsed = JSON.parse(await node_fs_1.promises.readFile(source.fsPath, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
        vscode.window.showErrorMessage("Unsupported Codex account backup format.");
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
        accounts: store.all().map(({ id, name, email, planType, codexHome, enabled, priority }) => ({ id, name, email, planType, codexHome, enabled, priority })),
    });
}
async function removeAccount(context, store) {
    const accounts = store.all();
    const selected = await vscode.window.showQuickPick(accounts.map((account) => ({ label: account.name, description: account.email ?? "Login pending", account })), { placeHolder: "Select an account to remove" });
    if (!selected)
        return;
    await store.remove(selected.account.id);
    if (activeId === selected.account.id)
        activeId = undefined;
    await syncLauncherRegistry(context, store);
}
async function showLimits(context, store, force = false) {
    const rows = [];
    for (const account of store.all()) {
        try {
            const limits = await getLimits(context, account, force);
            const accountContext = account.planType ? `, ${account.planType}` : "";
            rows.push(`${account.name} (${account.email ?? "no email"}${accountContext}): ${formatLimits(limits)}`);
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
async function restartCodexOnly(context) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const tabInput = activeTab?.input;
    const chatUri = tabInput?.viewType === "chatgpt.conversationEditor" ? tabInput.uri?.toString() : undefined;
    await context.globalState.update(REOPEN_CHAT_URI_KEY, chatUri);
    await context.globalState.update(REOPEN_CODEX_KEY, true);
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes("workbench.action.restartExtensionHost")) {
        await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    }
    else {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}
async function requestBackendSwitch(context, store, account, confirm) {
    if (confirm) {
        const answer = await vscode.window.showWarningMessage(`Switch Codex to '${account.name}' without reloading VS Code? The current request may be interrupted.`, "Switch", "Cancel");
        if (answer !== "Switch")
            return false;
    }
    activeId = account.id;
    await markPendingSwitch(context, account.id);
    await syncLauncherRegistry(context, store);
    try {
        await (0, fsUtils_1.writeJsonAtomic)(path.join(context.globalStorageUri.fsPath, "switch-request.json"), { accountId: account.id, requestedAt: Date.now() });
        vscode.window.showInformationMessage(`Switch to '${account.name}' queued. The next Codex request will use it.`);
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
    const now = Date.now();
    const lastSwitch = context.globalState.get("codexAccountProfiles.lastAutoSwitch", 0);
    if (now - lastSwitch < 30000)
        return;
    const dataDir = context.globalStorageUri.fsPath;
    let currentId;
    let trigger = false;
    try {
        const current = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDir, "current-account.json"), "utf8"));
        currentId = current.accountId;
    }
    catch {
        return;
    }
    try {
        const event = JSON.parse(await node_fs_1.promises.readFile(path.join(dataDir, "rate-limit-trigger.json"), "utf8"));
        trigger = event.accountId === currentId;
    }
    catch { /* Polling limits remains the fallback. */ }
    const current = store.all().find((account) => account.id === currentId && account.enabled);
    if (!current)
        return;
    try {
        const limits = await getLimits(context, current, trigger);
        const hourlyThreshold = config().get("autoSwitchHourlyThreshold", config().get("minimumRemainingPercent", 1));
        const weeklyThreshold = config().get("autoSwitchWeeklyThreshold", config().get("minimumRemainingPercent", 1));
        if (!trigger && !(0, quotaPolicy_1.shouldSwitchForThresholds)(limits, hourlyThreshold, weeklyThreshold))
            return;
    }
    catch {
        if (!trigger)
            return;
    }
    await store.markLimited(current.id);
    const next = await chooseAccount(context, store, config().get("minimumRemainingPercent", 1), current.id);
    if (!next) {
        vscode.window.showWarningMessage("The Codex account reached its limit and no other account is available.");
        return;
    }
    await context.globalState.update("codexAccountProfiles.lastAutoSwitch", now);
    try {
        await node_fs_1.promises.unlink(path.join(dataDir, "rate-limit-trigger.json"));
    }
    catch { /* Already consumed. */ }
    await requestBackendSwitch(context, store, next.account, false);
    vscode.window.showInformationMessage(`Limit reached. Automatically switching to '${next.account.name}'.`);
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
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}
function formatAge(timestamp) {
    if (!timestamp)
        return "never";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
function quotaTone(remaining) {
    if (remaining <= 10)
        return "bad";
    if (remaining <= 30)
        return "warn";
    return "good";
}
function formatUsageMetricsHtml(result) {
    const windows = (0, codexClient_1.extractLimitBuckets)(result).flatMap((bucket) => (0, codexClient_1.extractWindows)(bucket).map((window) => ({ bucket, window })));
    if (!windows.length)
        return "<div class=\"metric empty\"><strong>No quota data</strong><span>Refresh to check usage.</span></div>";
    return windows.map(({ bucket, window }) => {
        const used = Math.max(0, Math.min(100, window.usedPercent ?? 100));
        const remaining = Math.max(0, 100 - used);
        const label = `${(0, codexClient_1.limitBucketLabel)(bucket)} ${windowName(window)}`;
        const tone = quotaTone(remaining);
        return `<div class="metric ${tone}"><div class="metric-top"><strong>${escapeHtml(label)}</strong><span>${remaining.toFixed(0)}%</span></div><div class="meter" style="--used:${used.toFixed(1)}%"><i></i></div><div class="metric-foot"><span>${used.toFixed(1)}% used</span><span>${escapeHtml(formatCompactResetText(window.resetsAt))}</span></div></div>`;
    }).join("");
}
class AccountsView {
    context;
    store;
    view;
    constructor(context, store) {
        this.context = context;
        this.store = store;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage((message) => {
            if (message.command === "refresh")
                void this.refresh(true);
            if (message.command === "add")
                void addAccount(this.context, this.store).then(() => this.refresh());
            if (message.command === "importCurrent")
                void importCurrentAccount(this.context, this.store).then(() => this.refresh(true));
            if (message.command === "export")
                void exportAccounts(this.context, this.store);
            if (message.command === "importBackup")
                void importAccountsBackup(this.context, this.store).then(() => this.refresh(true));
            if (message.command === "showLimits")
                void showLimits(this.context, this.store, true);
            if (message.command === "settings")
                void vscode.commands.executeCommand("workbench.action.openSettings", "codexAccountProfiles");
            if (message.command === "selectConfirmed")
                void this.select(message.id);
            if (message.command === "remove")
                void this.remove(message.id);
            if (message.command === "reauth")
                void this.reauthenticate(message.id);
            if (message.command === "findCodex")
                void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
        }, undefined, this.context.subscriptions);
        void this.refresh();
    }
    async select(id) {
        const account = this.store.all().find((item) => item.id === id && item.enabled);
        if (!account)
            return;
        await requestBackendSwitch(this.context, this.store, account, false);
    }
    async remove(id) {
        const account = this.store.all().find((item) => item.id === id);
        if (!account)
            return;
        const answer = await vscode.window.showWarningMessage(`Remove Codex account '${account.name}'?`, "Remove", "Cancel");
        if (answer !== "Remove")
            return;
        await this.store.remove(id);
        if (activeId === id)
            activeId = undefined;
        await syncLauncherRegistry(this.context, this.store);
        await this.refresh(true);
    }
    async reauthenticate(id) {
        const account = this.store.all().find((item) => item.id === id && item.enabled);
        if (account)
            await reauthenticateAccount(this.context, this.store, account);
    }
    async refresh(force = false) {
        if (!this.view)
            return;
        const accounts = this.store.all();
        const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
        const displayedAccount = await resolveDisplayedAccountId(this.context);
        const cache = this.context.globalState.get(LIMIT_CACHE_KEY, {});
        const tokenState = this.context.globalState.get(TOKEN_REFRESH_STATE_KEY, {});
        const rows = [];
        let available = 0;
        let checked = 0;
        const orderedAccounts = [...accounts].sort((a, b) => {
            if (a.id === displayedAccount.accountId)
                return -1;
            if (b.id === displayedAccount.accountId)
                return 1;
            return 0;
        });
        for (const account of orderedAccounts) {
            let limits = "limits unavailable";
            let metrics = "<div class=\"metric empty\"><strong>Unavailable</strong><span>No recent usage data.</span></div>";
            let hasAuthError = false;
            let remaining;
            try {
                const result = await getLimits(this.context, account, force);
                checked += 1;
                remaining = (0, codexClient_1.remainingPercent)(result);
                if (remaining >= config().get("minimumRemainingPercent", 1))
                    available += 1;
                metrics = formatUsageMetricsHtml(result);
                limits = formatLimitHtml(result) || "<div class=\"limit\">No limit data</div>";
            }
            catch (error) {
                hasAuthError = isAuthenticationError(error);
                limits = hasAuthError
                    ? "<div class=\"limit auth-error\"><strong>Authentication required</strong><small>Sign in again to use this account.</small></div>"
                    : "limits unavailable";
            }
            const isActive = account.id === displayedAccount.accountId;
            const isPending = isActive && displayedAccount.pending;
            const action = hasAuthError
                ? `<button class="reauth" data-id="${escapeHtml(account.id)}">Re-authenticate</button>`
                : `<button class="switch" data-id="${escapeHtml(account.id)}" data-name="${escapeHtml(account.name)}" ${isActive ? "disabled" : ""}>${isPending ? "Switching..." : isActive ? "Current" : "Use this account"}</button>`;
            const accountDescription = [account.email ?? "login pending", account.planType].filter(Boolean).join(" / ");
            const cacheText = cache[account.id]?.checkedAt ? `Quota checked ${formatAge(cache[account.id]?.checkedAt)}` : "Quota not checked";
            const tokenText = tokenState[account.id]?.refreshedAt ? `Token refreshed ${formatAge(tokenState[account.id]?.refreshedAt)}` : tokenState[account.id]?.error ? "Token refresh failed" : "Token refresh idle";
            const health = hasAuthError ? "Needs auth" : remaining === undefined ? "Unknown" : `${remaining.toFixed(0)}% available`;
            const article = `<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${escapeHtml(account.name)} ${isPending ? "<small>Switching</small>" : isActive ? "<small>Current</small>" : ""}</strong><span>${escapeHtml(accountDescription)}</span></div><div style="min-width:42px;text-align:right;font-size:18px;font-weight:700" class="${remaining === undefined ? "" : quotaTone(remaining)}">${remaining === undefined ? "?" : remaining.toFixed(0)}%</div><button class="remove" data-id="${escapeHtml(account.id)}" title="Remove account" aria-label="Remove account">x</button></div><div class="health ${remaining === undefined ? "" : quotaTone(remaining)}">${escapeHtml(health)}</div><div class="quota"><div class="quota-label">Quota</div><div class="limits">${limits}</div></div><div class="meta"><span>${escapeHtml(cacheText)}</span><span>${escapeHtml(tokenText)}</span></div>${action}</article>`;
            rows.push(article);
        }
        const codexNotice = codexInstalled ? "" : `<div class="notice"><strong>OpenAI Codex is required</strong><span>Install the official Codex extension to use these accounts.</span><button id="findCodex">Find Codex Extension</button></div>`;
        this.view.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><style>
      :root{color-scheme:light dark}body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px;background:var(--vscode-sideBar-background)}button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 7px;cursor:pointer;font:inherit;font-size:11px;border-radius:3px}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.65;cursor:default}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}header{display:grid;gap:7px;margin-bottom:8px}.title-row{display:flex;align-items:center;justify-content:space-between;gap:6px}h2{margin:0;font-size:14px;font-weight:650}.toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start}.more-actions{display:inline-grid;gap:4px}.more-actions>summary{list-style:none;cursor:pointer;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:4px 7px;font:inherit;font-size:11px;border-radius:3px}.more-actions>summary::-webkit-details-marker{display:none}.more-actions[open]>.secondary-actions{display:grid;gap:4px;margin-top:2px}.overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}.stat{padding:6px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px}.stat strong{display:block;font-size:16px;line-height:18px}.stat span,.active-empty,.meta,.metric-foot,.account span,.notice span{font-size:10px;color:var(--vscode-descriptionForeground)}.hero{display:grid;gap:7px;margin-bottom:8px;padding:8px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px}.active-account{display:flex;justify-content:space-between;align-items:center;gap:8px}.active-account div:first-child{display:grid;gap:1px;min-width:0}.active-account strong{font-size:13px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-account small{color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.active-score{font-size:20px;font-weight:700}.metrics{display:grid;gap:5px}.hero-metrics{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.metric{display:grid;gap:4px;padding:6px;background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-panel-border);border-radius:3px}.metric.good{border-left-color:var(--vscode-testing-iconPassed)}.metric.warn{border-left-color:var(--vscode-editorWarning-foreground)}.metric.bad{border-left-color:var(--vscode-testing-iconFailed)}.metric.empty{border-left-color:var(--vscode-descriptionForeground)}.metric-top,.metric-foot,.account-head,.meta{display:flex;justify-content:space-between;gap:6px}.metric-top strong{font-size:10px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric-top span{font-size:11px;font-weight:650}.metric-foot span:last-child{white-space:nowrap}.meter{height:5px;background:var(--vscode-progressBar-background);overflow:hidden;border-radius:999px;opacity:.9}.meter i{display:block;height:100%;width:var(--used);background:var(--vscode-testing-iconFailed)}section.accounts{display:grid;gap:7px}article{border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px;padding:8px}.active{border-left:3px solid var(--vscode-testing-iconPassed)}.account{display:flex;flex-direction:column;gap:1px;min-width:0}.account small{font-size:9px;color:var(--vscode-testing-iconPassed);font-weight:normal;margin-left:4px}.account strong{font-size:12px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account span{line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.health{margin:5px 0;font-size:11px;font-weight:650}.health.good,.active-score.good{color:var(--vscode-testing-iconPassed)}.health.warn,.active-score.warn{color:var(--vscode-editorWarning-foreground)}.health.bad,.active-score.bad{color:var(--vscode-testing-iconFailed)}details{margin:5px 0}summary{cursor:pointer;font-size:10px;color:var(--vscode-descriptionForeground)}.reset-summary{margin-top:5px;font-size:10px;color:var(--vscode-descriptionForeground)}.limits{display:grid;gap:5px;margin:5px 0}.bucket{display:grid;gap:4px}.bucket-label{font-size:9px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground)}.bucket.depleted .bucket-label,.limit-reason{color:var(--vscode-editorWarning-foreground)}.limit{display:grid;gap:3px;padding:5px 6px;background:var(--vscode-textBlockQuote-background);border-left:2px solid var(--vscode-panel-border);font-size:10px}.limit.auth-error{border-left-color:var(--vscode-editorWarning-foreground)}.limit-head{display:flex;justify-content:space-between;gap:6px}.bar{height:4px;background:var(--vscode-progressBar-background);opacity:.35;overflow:hidden}.bar i{display:block;height:100%;background:var(--vscode-testing-iconPassed);opacity:1}.limit small{display:flex;justify-content:space-between;gap:6px;color:var(--vscode-descriptionForeground)}.reset-relative{color:var(--vscode-foreground);font-weight:600}.reset-date{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.switch,.reauth{width:100%;margin-top:6px}.confirm{display:grid;gap:5px;margin-top:6px;padding:6px;border-left:2px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);font-size:10px}.confirm strong{font-size:11px}.confirm span{color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}.confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.confirm-cancel{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.remove{flex:0 0 22px;width:22px;height:22px;padding:0;border:0;background:transparent;color:var(--vscode-testing-iconFailed);font-size:14px;line-height:14px}.remove:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-errorForeground)}.notice{display:grid;gap:5px;margin:0 0 8px;padding:7px;border-left:2px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);font-size:10px}@media(max-width:260px){.overview{grid-template-columns:1fr}.toolbar{display:grid}.active-account{align-items:flex-start}.metric-top,.metric-foot,.meta{display:grid}.account span,.account strong,.active-account strong,.active-account small{white-space:normal}}
    </style></head><body><header><div class="title-row"><h2>Codex Profiles</h2><button class="secondary" id="settings"><span class="icon">⚙</span><span>Settings</span></button></div><div class="toolbar"><button id="refresh"><span class="icon">↻</span><span>Refresh</span></button><button id="add"><span class="icon">＋</span><span>Add</span></button><button class="secondary" id="importCurrent"><span class="icon">☁↓</span><span>Import current</span></button><details class="more-actions"><summary><span class="icon">⋯</span><span>More</span></summary><div class="secondary-actions"><button class="secondary" id="export">Export</button><button class="secondary" id="importBackup">Import backup</button></div></details></div></header>${codexNotice}<section class="accounts">${rows.join("") || "<p>No profiles configured.</p>"}</section><script>
      const vscode=acquireVsCodeApi(); const post=(command)=>vscode.postMessage({command}); document.getElementById('refresh')?.addEventListener('click',()=>post('refresh')); document.getElementById('add')?.addEventListener('click',()=>post('add')); document.getElementById('importCurrent')?.addEventListener('click',()=>post('importCurrent')); document.getElementById('export')?.addEventListener('click',()=>post('export')); document.getElementById('importBackup')?.addEventListener('click',()=>post('importBackup')); document.getElementById('settings')?.addEventListener('click',()=>post('settings')); document.getElementById('findCodex')?.addEventListener('click',()=>post('findCodex')); document.querySelectorAll('.switch').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('.confirm').forEach((item)=>item.remove());const panel=document.createElement('div');panel.className='confirm';panel.innerHTML='<strong>Switch Codex account?</strong><span>'+(button.dataset.name || 'this account')+'</span><div class="confirm-actions"><button class="confirm-yes">Confirm</button><button class="confirm-cancel">Cancel</button></div>';button.after(panel);panel.querySelector('.confirm-yes')?.addEventListener('click',()=>vscode.postMessage({command:'selectConfirmed',id:button.dataset.id}));panel.querySelector('.confirm-cancel')?.addEventListener('click',()=>panel.remove());})); document.querySelectorAll('.remove').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'remove',id:button.dataset.id}))); document.querySelectorAll('.reauth').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'reauth',id:button.dataset.id})));
    </script></body></html>`;
    }
}
function activate(context) {
    const store = new accountStore_1.AccountStore(context.globalState);
    accountsView = new AccountsView(context, store);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexAccountProfiles.accountsView", accountsView));
    process.env.CODEX_ACCOUNT_PROFILES_DATA = context.globalStorageUri.fsPath;
    void node_fs_1.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true }).then(() => syncLauncherRegistry(context, store));
    const nativeCli = path.join(context.extensionPath, "bin", "codex-account-profiles");
    if (!vscode.extensions.getExtension("openai.chatgpt")) {
        void vscode.window.showWarningMessage("The official OpenAI Codex extension is not installed. Account switching is ready, but Codex itself is required.", "Find Codex Extension").then((choice) => {
            if (choice === "Find Codex Extension")
                void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
        });
    }
    const reopenCodex = context.globalState.get(REOPEN_CODEX_KEY, false);
    if (reopenCodex) {
        const chatUri = context.globalState.get(REOPEN_CHAT_URI_KEY);
        void context.globalState.update(REOPEN_CODEX_KEY, false);
        void context.globalState.update(REOPEN_CHAT_URI_KEY, undefined);
        setTimeout(() => {
            if (chatUri) {
                void vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(chatUri));
            }
            else {
                void vscode.commands.executeCommand("chatgpt.openSidebar");
            }
        }, 1500);
    }
    void vscode.workspace.getConfiguration("chatgpt").update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global).then(undefined, () => {
        vscode.window.showWarningMessage("Could not connect automatically to the official Codex. Run Codex: Enable Native Integration.");
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
        await vscode.workspace.getConfiguration("chatgpt").update("cliExecutable", nativeCli, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("Native Codex integration configured. Reload the VS Code window.");
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map