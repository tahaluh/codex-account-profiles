"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validEpoch = validEpoch;
exports.renderDate = renderDate;
exports.sortResetAccounts = sortResetAccounts;
exports.renderHistory = renderHistory;
exports.renderCreditDetails = renderCreditDetails;
exports.renderResetDashboard = renderResetDashboard;
const codexClient_1 = require("./codexClient");
const quotaPresentation_1 = require("./quotaPresentation");
const resetTracker_1 = require("./resetTracker");
function validEpoch(seconds) {
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds < 8640000000000;
}
function renderDate(seconds) {
    if (!validEpoch(seconds))
        return "Unknown";
    const date = new Date(seconds * 1000);
    return `<time datetime="${date.toISOString()}" title="${(0, quotaPresentation_1.escapeHtml)(date.toLocaleString(undefined, { timeZoneName: "short" }))}">${(0, quotaPresentation_1.escapeHtml)(date.toLocaleString())}</time>`;
}
function sortResetAccounts(rows, order, current, now = Date.now()) {
    return [...rows].sort((a, b) => {
        if (order === "current") {
            const active = Number(b.account.id === current) - Number(a.account.id === current);
            if (active)
                return active;
        }
        if (order === "nextReset") {
            const first = (0, resetTracker_1.nextResetAt)(a.result, now) ?? Infinity;
            const second = (0, resetTracker_1.nextResetAt)(b.result, now) ?? Infinity;
            if (first !== second)
                return first - second;
        }
        if (order === "available") {
            const value = (b.result && !b.error ? (0, codexClient_1.remainingPercent)(b.result) : -1) - (a.result && !a.error ? (0, codexClient_1.remainingPercent)(a.result) : -1);
            if (value)
                return value;
        }
        return a.account.priority - b.account.priority || a.account.name.localeCompare(b.account.name);
    });
}
function renderHistory(history) {
    if (!history.events.length)
        return '<p class="history-empty">No reset observed yet. Tracking starts with the first quota check.</p>';
    return `<details class="reset-history"><summary>Reset history (${history.events.length})</summary><ol>${history.events.slice(0, 10).map(event => {
        const label = event.kind === "creditApplied" ? "Banked reset applied via this extension" : `${event.window || "Quota"} · quota renewal observed`;
        const interval = event.since ? `<small>Occurred between ${renderDate(event.since / 1000)} and ${renderDate(event.observedAt / 1000)}; exact time unavailable.</small>` : "";
        const quota = event.beforeUsed !== undefined && event.afterUsed !== undefined ? `<small>${(100 - event.beforeUsed).toFixed(0)}% → ${(100 - event.afterUsed).toFixed(0)}% remaining</small>` : "";
        return `<li><strong>${(0, quotaPresentation_1.escapeHtml)(label)}</strong><span>${renderDate(event.observedAt / 1000)} · ${(0, quotaPresentation_1.escapeHtml)((0, quotaPresentation_1.formatAge)(event.observedAt))}</span>${quota}${interval}</li>`;
    }).join("")}</ol></details>`;
}
function renderCreditDetails(result) {
    const summary = result?.rateLimitResetCredits;
    if (!summary)
        return "";
    if (!summary.credits)
        return '<small class="credit-note">Reset dates unavailable: Codex returned only the available count.</small>';
    const credits = summary.credits.filter(credit => credit.status === "available");
    if (!credits.length)
        return summary.availableCount ? '<small class="credit-note">Credit details are not available in this response.</small>' : "";
    return `<details class="banked-resets"><summary>Banked reset dates</summary>${credits.map(credit => `<div class="credit-row"><strong>${(0, quotaPresentation_1.escapeHtml)(credit.title || "Rate-limit reset")}</strong><small>Granted ${renderDate(credit.grantedAt)}</small><small>Expires ${credit.expiresAt === null || credit.expiresAt === undefined ? "Not provided" : renderDate(credit.expiresAt)}</small></div>`).join("")}</details>`;
}
function renderResetDashboard(rows, now = Date.now()) {
    if (!rows.length)
        return "";
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `<section class="reset-dashboard"><h3>Reset planner</h3><p>Account windows · ${(0, quotaPresentation_1.escapeHtml)(zone)}</p><div class="reset-table-wrap"><table><thead><tr><th>Account</th><th>Next window reset</th><th>Last observed</th><th>Banked</th></tr></thead><tbody>${rows.map(({ account, result, history, checkedAt, error }) => {
        const next = (0, resetTracker_1.nextResetAt)(result, now);
        const stale = !checkedAt || now - checkedAt > 120000;
        const last = history.events[0];
        return `<tr><th>${(0, quotaPresentation_1.escapeHtml)(account.name)}</th><td>${next ? renderDate(next) : "Not reported / refresh due"}${stale || error ? '<small class="stale">Cached / unavailable</small>' : ""}</td><td>${last ? `${renderDate(last.observedAt / 1000)}<small>${last.kind === "creditApplied" ? "Applied here" : "Observed; exact time unknown"}</small>` : "Not observed yet"}</td><td>${typeof result?.rateLimitResetCredits?.availableCount === "number" ? Math.max(0, result.rateLimitResetCredits.availableCount) : "?"}</td></tr>`;
    }).join("")}</tbody></table></div><p class="planner-note">Next window reset may not restore every limit. Observations are account-specific, not global announcements.</p><button class="secondary" id="publicResetTracker">Public reset tracker ↗</button></section>`;
}
//# sourceMappingURL=resetPresentation.js.map