import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { AccountProfile, AccountStore } from "./accountStore";
import { RateLimits, remainingPercent } from "./codexClient";
import { renderAccountsViewHtml } from "./accountsViewHtml";
import { LimitCache, TokenRefreshState } from "./extensionState";
import { escapeHtml, formatAge, formatLimitHtml, quotaTone } from "./quotaPresentation";
import { ResetHistory } from "./resetTracker";
import { renderResetAgenda } from "./resetSchedule";
import { AccountSortOrder, ResetDashboardAccount, renderCreditDetails, renderHistory, renderResetDashboard, sortResetAccounts } from "./resetPresentation";

interface DisplayedAccount {
  accountId?: string;
  pending: boolean;
  pendingLabel?: string;
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
  readResetHistory(account: AccountProfile): Promise<ResetHistory>;
  getSortOrder(): AccountSortOrder;
  setSortOrder(order: AccountSortOrder): Promise<void>;
  openPublicResetTracker(): void;
  applyReset(account: AccountProfile): Promise<void>;
  hasPendingReset(account: AccountProfile): Promise<boolean>;
  exportCalendar(): Promise<void>;
  copyResetSchedule(): Promise<void>;
}

export class AccountsView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastRenderedContent?: string;
  private refreshTask?: Promise<void>;
  private queuedForce = false;

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
      if (message.command === "applyReset") {
        const account = this.store.all().find(item => item.id === message.id && item.enabled);
        if (account) void this.dependencies.applyReset(account);
      }
      if (message.command === "exportResetCalendar") void this.dependencies.exportCalendar();
      if (message.command === "copyResetSchedule") void this.dependencies.copyResetSchedule();
      if (message.command === "resetNotificationSettings") void vscode.commands.executeCommand("workbench.action.openSettings", "codexAccountProfiles");
      if (message.command === "publicResetTracker") this.dependencies.openPublicResetTracker();
      if (message.command === "sort" && ["current", "nextReset", "available"].includes(message.order)) {
        void this.dependencies.setSortOrder(message.order).then(() => this.refresh());
      }
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
    if (this.refreshTask) { this.queuedForce ||= force; return this.refreshTask; }
    this.refreshTask = (async () => {
      let requested = force;
      do {
        this.queuedForce = false;
        await this.renderOnce(requested);
        requested = this.queuedForce;
      } while (requested);
    })();
    try { await this.refreshTask; } finally { this.refreshTask = undefined; }
  }

  private async renderOnce(force: boolean): Promise<void> {
    if (!this.view) return;
    const accounts = this.store.all();
    const codexInstalled = Boolean(vscode.extensions.getExtension("openai.chatgpt"));
    const displayedAccount = await this.dependencies.resolveDisplayedAccount();
    const tokenState = this.dependencies.getTokenRefreshState();
    const rows: string[] = [];
    const snapshots: (ResetDashboardAccount & { authError?: boolean; pendingReset?: boolean })[] = [];
    for (const account of accounts) {
      let result: RateLimits | undefined, error = false, authError = false;
      try { result = await this.dependencies.getLimits(account, force); }
      catch (failure) { error = true; authError = this.dependencies.isAuthenticationError(failure); result = this.dependencies.getLimitCache()[account.id]?.result; }
      const currentCache = this.dependencies.getLimitCache()[account.id];
      snapshots.push({ account, result, history: await this.dependencies.readResetHistory(account), checkedAt: currentCache?.checkedAt, error: error || Boolean(currentCache?.error), authError, pendingReset: await this.dependencies.hasPendingReset(account) });
    }
    const sortOrder = this.dependencies.getSortOrder();
    const ordered = sortResetAccounts(snapshots, sortOrder, displayedAccount.accountId) as typeof snapshots;
    for (const snapshot of ordered) {
      const { account, result, history } = snapshot;
      const hasAuthError = Boolean(snapshot.authError);
      const remaining = result && !hasAuthError ? remainingPercent(result) : undefined;
      const limits = hasAuthError
        ? '<div class="limit auth-error"><strong>Authentication required</strong><small>Sign in again to use this account.</small></div>'
        : result ? formatLimitHtml(result) : "Limits unavailable";
      const isActive = account.id === displayedAccount.accountId;
      const isPending = isActive && displayedAccount.pending;
      const action = hasAuthError
        ? `<button class="reauth" data-id="${escapeHtml(account.id)}">Re-authenticate</button>`
        : `<button class="switch" data-id="${escapeHtml(account.id)}" data-name="${escapeHtml(account.name)}" ${isActive || !account.enabled ? "disabled" : ""}>${!account.enabled ? "Disabled" : isPending ? escapeHtml(displayedAccount.pendingLabel || "Switching...") : isActive ? "Current" : "Use this account"}</button>`;
      const resetAction = !hasAuthError && account.enabled && ((result?.rateLimitResetCredits?.availableCount || 0) > 0 || snapshot.pendingReset)
        ? `<button class="secondary apply-reset" data-id="${escapeHtml(account.id)}">${snapshot.pendingReset ? "Check / retry previous reset…" : "Use a banked reset…"}</button>` : "";
      const accountDescription = [account.email ?? "login pending", account.planType].filter(Boolean).join(" / ");
      const cacheText = snapshot.checkedAt ? `Quota checked ${formatAge(snapshot.checkedAt)}` : "Quota not checked";
      const tokenText = tokenState[account.id]?.refreshedAt ? `Token refreshed ${formatAge(tokenState[account.id]?.refreshedAt)}` : tokenState[account.id]?.error ? "Token refresh failed" : "Token refresh idle";
      const health = hasAuthError ? "Needs auth" : remaining === undefined ? "Unknown" : `${remaining.toFixed(0)}% available`;
      rows.push(`<article class="${isActive ? "active" : ""}"><div class="account-head"><div class="account"><strong>${escapeHtml(account.name)} ${isPending ? `<small>${escapeHtml(displayedAccount.pendingLabel || "Switching")}</small>` : isActive ? "<small>Current</small>" : ""}</strong><span>${escapeHtml(accountDescription)}</span></div><button class="remove" data-id="${escapeHtml(account.id)}" title="Remove account" aria-label="Remove account">x</button></div><div class="health ${remaining === undefined ? "" : quotaTone(remaining)}">${escapeHtml(health)}</div><div class="quota"><div class="quota-label">Quota</div><div class="limits">${limits}<div data-account-reset="${escapeHtml(account.id)}">${renderCreditDetails(result)}${renderHistory(history)}</div></div></div><div class="meta"><span>${escapeHtml(cacheText)}</span><span>${escapeHtml(tokenText)}</span></div>${action}${resetAction}</article>`);
    }
    const resetDashboard = renderResetDashboard(ordered);
    const resetAgenda = renderResetAgenda(ordered);
    const renderedContent = JSON.stringify({ codexInstalled, rows, sortOrder, resetDashboard, resetAgenda });
    if (!force && renderedContent === this.lastRenderedContent) return;
    this.lastRenderedContent = renderedContent;
    const nonce = crypto.randomBytes(16).toString("base64");
    this.view.webview.html = renderAccountsViewHtml({ nonce, codexInstalled, accountRows: rows, sortOrder, resetDashboard, resetAgenda });
  }
}
