import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { AccountProfile, AccountStore } from "./accountStore";
import { RateLimits, remainingPercent } from "./codexClient";
import { renderAccountsViewHtml } from "./accountsViewHtml";
import { LimitCache, TokenRefreshState } from "./extensionState";
import { escapeHtml, formatAge, formatLimitHtml, quotaTone } from "./quotaPresentation";

interface DisplayedAccount {
  accountId?: string;
  pending: boolean;
}

export interface AccountsViewDependencies {
  addAccount(): Promise<void>;
  importCurrentAccount(): Promise<void>;
  exportAccounts(): Promise<void>;
  importAccountsBackup(): Promise<void>;
  showLimits(force: boolean): Promise<void>;
  requestBackendSwitch(account: AccountProfile): Promise<boolean>;
  deleteAccount(account: AccountProfile): Promise<boolean>;
  reauthenticateAccount(account: AccountProfile): Promise<void>;
  resolveDisplayedAccount(): Promise<DisplayedAccount>;
  getLimits(account: AccountProfile, force: boolean): Promise<RateLimits>;
  getLimitCache(): LimitCache;
  getTokenRefreshState(): TokenRefreshState;
  isAuthenticationError(error: unknown): boolean;
}

export class AccountsView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastRenderedContent?: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: AccountStore,
    private readonly dependencies: AccountsViewDependencies,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message) => {
      if (message.command === "refresh") void this.refresh(true);
      if (message.command === "add") void this.dependencies.addAccount().then(() => this.refresh());
      if (message.command === "importCurrent") void this.dependencies.importCurrentAccount().then(() => this.refresh(true));
      if (message.command === "export") void this.dependencies.exportAccounts();
      if (message.command === "importBackup") void this.dependencies.importAccountsBackup().then(() => this.refresh(true));
      if (message.command === "showLimits") void this.dependencies.showLimits(true);
      if (message.command === "settings") void vscode.commands.executeCommand("workbench.action.openSettings", "codexAccountProfiles");
      if (message.command === "selectConfirmed") void this.select(message.id);
      if (message.command === "remove") void this.remove(message.id);
      if (message.command === "reauth") void this.reauthenticate(message.id);
      if (message.command === "findCodex") void vscode.commands.executeCommand("workbench.extensions.search", "@id:openai.chatgpt");
    }, undefined, this.context.subscriptions);
    void this.refresh();
  }

  private async select(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id && item.enabled);
    if (account) await this.dependencies.requestBackendSwitch(account);
  }

  private async remove(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id);
    if (!account) return;
    const answer = await vscode.window.showWarningMessage(
      `Remove Codex account '${account.name}' and delete its local authentication tokens?`,
      "Remove",
      "Cancel",
    );
    if (answer !== "Remove") return;
    if (await this.dependencies.deleteAccount(account)) await this.refresh(true);
  }

  private async reauthenticate(id: string): Promise<void> {
    const account = this.store.all().find((item) => item.id === id && item.enabled);
    if (account) await this.dependencies.reauthenticateAccount(account);
  }

  async refresh(force = false): Promise<void> {
    if (!this.view) return;
    const accounts = this.store.all();
    const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
    const displayedAccount = await this.dependencies.resolveDisplayedAccount();
    const cache = this.dependencies.getLimitCache();
    const tokenState = this.dependencies.getTokenRefreshState();
    const rows: string[] = [];
    const orderedAccounts = [...accounts].sort((a, b) => {
      if (a.id === displayedAccount.accountId) return -1;
      if (b.id === displayedAccount.accountId) return 1;
      return 0;
    });
    for (const account of orderedAccounts) {
      let limits = "limits unavailable";
      let hasAuthError = false;
      let remaining: number | undefined;
      try {
        const result = await this.dependencies.getLimits(account, force);
        remaining = remainingPercent(result);
        limits = formatLimitHtml(result) || "<div class=\"limit\">No limit data</div>";
      } catch (error) {
        hasAuthError = this.dependencies.isAuthenticationError(error);
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
      rows.push(`<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${escapeHtml(account.name)} ${isPending ? "<small>Switching</small>" : isActive ? "<small>Current</small>" : ""}</strong><span>${escapeHtml(accountDescription)}</span></div><button class="remove" data-id="${escapeHtml(account.id)}" title="Remove account" aria-label="Remove account">x</button></div><div class="health ${remaining === undefined ? "" : quotaTone(remaining)}">${escapeHtml(health)}</div><div class="quota"><div class="quota-label">Quota</div><div class="limits">${limits}</div></div><div class="meta"><span>${escapeHtml(cacheText)}</span><span>${escapeHtml(tokenText)}</span></div>${action}</article>`);
    }
    const renderedContent = JSON.stringify({ codexInstalled, rows });
    if (!force && renderedContent === this.lastRenderedContent) return;
    this.lastRenderedContent = renderedContent;
    const nonce = crypto.randomBytes(16).toString("base64");
    this.view.webview.html = renderAccountsViewHtml({ nonce, codexInstalled, accountRows: rows });
  }
}
