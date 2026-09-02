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
class AccountsView {
    context;
    store;
    dependencies;
    view;
    lastRenderedContent;
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
        if (!this.view)
            return;
        const accounts = this.store.all();
        const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
        const displayedAccount = await this.dependencies.resolveDisplayedAccount();
        const cache = this.dependencies.getLimitCache();
        const tokenState = this.dependencies.getTokenRefreshState();
        const rows = [];
        const orderedAccounts = [...accounts].sort((a, b) => {
            if (a.id === displayedAccount.accountId)
                return -1;
            if (b.id === displayedAccount.accountId)
                return 1;
            return 0;
        });
        for (const account of orderedAccounts) {
            let limits = "limits unavailable";
            let hasAuthError = false;
            let remaining;
            try {
                const result = await this.dependencies.getLimits(account, force);
                remaining = (0, codexClient_1.remainingPercent)(result);
                limits = (0, quotaPresentation_1.formatLimitHtml)(result) || "<div class=\"limit\">No limit data</div>";
            }
            catch (error) {
                hasAuthError = this.dependencies.isAuthenticationError(error);
                limits = hasAuthError
                    ? "<div class=\"limit auth-error\"><strong>Authentication required</strong><small>Sign in again to use this account.</small></div>"
                    : "limits unavailable";
            }
            const isActive = account.id === displayedAccount.accountId;
            const isPending = isActive && displayedAccount.pending;
            const action = hasAuthError
                ? `<button class="reauth" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}">Re-authenticate</button>`
                : `<button class="switch" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}" data-name="${(0, quotaPresentation_1.escapeHtml)(account.name)}" ${isActive ? "disabled" : ""}>${isPending ? "Switching..." : isActive ? "Current" : "Use this account"}</button>`;
            const accountDescription = [account.email ?? "login pending", account.planType].filter(Boolean).join(" / ");
            const cacheText = cache[account.id]?.checkedAt ? `Quota checked ${(0, quotaPresentation_1.formatAge)(cache[account.id]?.checkedAt)}` : "Quota not checked";
            const tokenText = tokenState[account.id]?.refreshedAt ? `Token refreshed ${(0, quotaPresentation_1.formatAge)(tokenState[account.id]?.refreshedAt)}` : tokenState[account.id]?.error ? "Token refresh failed" : "Token refresh idle";
            const health = hasAuthError ? "Needs auth" : remaining === undefined ? "Unknown" : `${remaining.toFixed(0)}% available`;
            rows.push(`<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${(0, quotaPresentation_1.escapeHtml)(account.name)} ${isPending ? "<small>Switching</small>" : isActive ? "<small>Current</small>" : ""}</strong><span>${(0, quotaPresentation_1.escapeHtml)(accountDescription)}</span></div><button class="remove" data-id="${(0, quotaPresentation_1.escapeHtml)(account.id)}" title="Remove account" aria-label="Remove account">x</button></div><div class="health ${remaining === undefined ? "" : (0, quotaPresentation_1.quotaTone)(remaining)}">${(0, quotaPresentation_1.escapeHtml)(health)}</div><div class="quota"><div class="quota-label">Quota</div><div class="limits">${limits}</div></div><div class="meta"><span>${(0, quotaPresentation_1.escapeHtml)(cacheText)}</span><span>${(0, quotaPresentation_1.escapeHtml)(tokenText)}</span></div>${action}</article>`);
        }
        const renderedContent = JSON.stringify({ codexInstalled, rows });
        if (!force && renderedContent === this.lastRenderedContent)
            return;
        this.lastRenderedContent = renderedContent;
        const nonce = crypto.randomBytes(16).toString("base64");
        this.view.webview.html = (0, accountsViewHtml_1.renderAccountsViewHtml)({ nonce, codexInstalled, accountRows: rows });
    }
}
exports.AccountsView = AccountsView;
//# sourceMappingURL=accountsView.js.map