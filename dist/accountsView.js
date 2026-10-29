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
exports.AccountsView = void 0;
const crypto = __importStar(require("node:crypto"));
const vscode = __importStar(require("vscode"));
const codexClient_1 = require("./codexClient");
const accountsViewHtml_1 = require("./accountsViewHtml");
const quotaPresentation_1 = require("./quotaPresentation");
const resetSchedule_1 = require("./resetSchedule");
const resetPresentation_1 = require("./resetPresentation");
class AccountsView {
    context;
    store;
    dependencies;
    view;
    lastRenderedContent;
    refreshTask;
    queuedForce = false;
    constructor(context, store, dependencies) {
        this.context = context;
        this.store = store;
        this.dependencies = dependencies;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage((message) => {
            if (message.command === "refresh")
                void this.refresh(true);
            if (message.command === "add")
                void this.dependencies.addAccount().then(() => this.refresh());
            if (message.command === "importCurrent")
                void this.dependencies.importCurrentAccount().then(() => this.refresh(true));
            if (message.command === "export")
                void this.dependencies.exportAccounts();
            if (message.command === "importBackup")
                void this.dependencies.importAccountsBackup().then(() => this.refresh(true));
            if (message.command === "showLimits")
                void this.dependencies.showLimits(true);
            if (message.command === "applyReset") {
                const account = this.store.all().find(item => item.id === message.id && item.enabled);
                if (account)
                    void this.dependencies.applyReset(account);
            }
            if (message.command === "exportResetCalendar")
                void this.dependencies.exportCalendar();
            if (message.command === "copyResetSchedule")
                void this.dependencies.copyResetSchedule();
            if (message.command === "resetNotificationSettings")
                void vscode.commands.executeCommand("workbench.action.openSettings", "codexAccountProfiles");
            if (message.command === "publicResetTracker")
                this.dependencies.openPublicResetTracker();
            if (message.command === "sort" && ["current", "nextReset", "available"].includes(message.order)) {
                void this.dependencies.setSortOrder(message.order).then(() => this.refresh());
            }
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
        if (account)
            await this.dependencies.requestBackendSwitch(account);
    }
    async remove(id) {
        const account = this.store.all().find((item) => item.id === id);
        if (!account)
            return;
        const answer = await vscode.window.showWarningMessage(`Remove Codex account '${account.name}' and delete its local authentication tokens?`, "Remove", "Cancel");
        if (answer !== "Remove")
            return;
        if (await this.dependencies.deleteAccount(account))
            await this.refresh(true);
    }
    async reauthenticate(id) {
        const account = this.store.all().find((item) => item.id === id && item.enabled);
        if (account)
            await this.dependencies.reauthenticateAccount(account);
    }
    async refresh(force = false) {
        if (this.refreshTask) {
            this.queuedForce ||= force;
            return this.refreshTask;
        }
        this.refreshTask = (async () => {
            let requested = force;
            do {
                this.queuedForce = false;
                await this.renderOnce(requested);
                requested = this.queuedForce;
            } while (requested);
        })();
        try {
            await this.refreshTask;
        }
        finally {
            this.refreshTask = undefined;
        }
    }
    async renderOnce(force) {
        if (!this.view)
            return;
        const accounts = this.store.all();
        const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
        const displayedAccount = await this.dependencies.resolveDisplayedAccount();
        const tokenState = this.dependencies.getTokenRefreshState();
        const rows = [];
        const snapshots = [];
        for (const account of accounts) {
            let result, error = false, authError = false;
            try {
                result = await this.dependencies.getLimits(account, force);
            }
            catch (failure) {
                error = true;
                authError = this.dependencies.isAuthenticationError(failure);
                result = this.dependencies.getLimitCache()[account.id]?.result;
            }
            const currentCache = this.dependencies.getLimitCache()[account.id];
            snapshots.push({ account, result, history: await this.dependencies.readResetHistory(account), checkedAt: currentCache?.checkedAt, error: error || Boolean(currentCache?.error), authError, pendingReset: await this.dependencies.hasPendingReset(account) });
        }
        const sortOrder = this.dependencies.getSortOrder();
        const ordered = (0, resetPresentation_1.sortResetAccounts)(snapshots, sortOrder, displayedAccount.accountId);
        for (const snapshot of ordered) {
            const { account, result, history } = snapshot;
            const hasAuthError = Boolean(snapshot.authError);
            const remaining = result && !hasAuthError ? (0, codexClient_1.remainingPercent)(result) : undefined;
            const limits = hasAuthError
                ? '<div class="limit auth-error"><strong>Authentication required</strong><small>Sign in again to use this account.</small></div>'
                : result ? (0, quotaPresentation_1.formatLimitHtml)(result) : "Limits unavailable";
            const isActive = account.id === displayedAccount.accountId;
            const isPending = isActive && displayedAccount.pending;
            const action = hasAuthError
                ? `<button class="reauth" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}">Re-authenticate</button>`
                : `<button class="switch" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}" data-name="${(0, quotaPresentation_1.escapeHtml)(account.name)}" ${isActive || !account.enabled ? "disabled" : ""}>${!account.enabled ? "Disabled" : isPending ? (0, quotaPresentation_1.escapeHtml)(displayedAccount.pendingLabel || "Switching...") : isActive ? "Current" : "Use this account"}</button>`;
            const resetAction = !hasAuthError && account.enabled && ((result?.rateLimitResetCredits?.availableCount || 0) > 0 || snapshot.pendingReset)
                ? `<button class="secondary apply-reset" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}">${snapshot.pendingReset ? "Check / retry previous reset…" : "Use a banked reset…"}</button>` : "";
            const accountDescription = [account.email ?? "login pending", account.planType].filter(Boolean).join(" / ");
            const cacheText = snapshot.checkedAt ? `Quota checked ${(0, quotaPresentation_1.formatAge)(snapshot.checkedAt)}` : "Quota not checked";
            const tokenText = tokenState[account.id]?.refreshedAt ? `Token refreshed ${(0, quotaPresentation_1.formatAge)(tokenState[account.id]?.refreshedAt)}` : tokenState[account.id]?.error ? "Token refresh failed" : "Token refresh idle";
            const health = hasAuthError ? "Needs auth" : remaining === undefined ? "Unknown" : `${remaining.toFixed(0)}% available`;
            rows.push(`<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${(0, quotaPresentation_1.escapeHtml)(account.name)} ${isPending ? `<small>${(0, quotaPresentation_1.escapeHtml)(displayedAccount.pendingLabel || "Switching")}</small>` : isActive ? "<small>Current</small>" : ""}</strong><span>${(0, quotaPresentation_1.escapeHtml)(accountDescription)}</span></div><button class="remove" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}" title="Remove account" aria-label="Remove account">x</button></div><div class="health ${remaining === undefined ? "" : (0, quotaPresentation_1.quotaTone)(remaining)}">${(0, quotaPresentation_1.escapeHtml)(health)}</div><div class="quota"><div class="quota-label">Quota</div><div class="limits">${limits}<div data-account-reset="${(0, quotaPresentation_1.escapeHtml)(account.id)}">${(0, resetPresentation_1.renderCreditDetails)(result)}${(0, resetPresentation_1.renderHistory)(history)}</div></div></div><div class="meta"><span>${(0, quotaPresentation_1.escapeHtml)(cacheText)}</span><span>${(0, quotaPresentation_1.escapeHtml)(tokenText)}</span></div>${action}${resetAction}</article>`);
        }
        const resetDashboard = (0, resetPresentation_1.renderResetDashboard)(ordered);
        const resetAgenda = (0, resetSchedule_1.renderResetAgenda)(ordered);
        const renderedContent = JSON.stringify({ codexInstalled, rows, sortOrder, resetDashboard, resetAgenda });
        if (!force && renderedContent === this.lastRenderedContent)
            return;
        this.lastRenderedContent = renderedContent;
        const nonce = crypto.randomBytes(16).toString("base64");
        this.view.webview.html = (0, accountsViewHtml_1.renderAccountsViewHtml)({ nonce, codexInstalled, accountRows: rows, sortOrder, resetDashboard, resetAgenda });
    }
}
exports.AccountsView = AccountsView;
//# sourceMappingURL=accountsView.js.map