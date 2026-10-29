const test = require("node:test");
const assert = require("node:assert/strict");
const { renderResetDashboard, renderCreditDetails, renderHistory, sortResetAccounts, renderDate } = require("../dist/resetPresentation");
const { emptyHistory } = require("../dist/resetTracker");
const { formatLimitHtml } = require("../dist/quotaPresentation");
const row = (id, reset, used) => ({ account: { id, name: id, priority: 0 }, history: emptyHistory(), checkedAt: 4000,
  result: { primary: { resetsAt: reset, usedPercent: used }, rateLimitResetCredits: { availableCount: 2 } } });
test("planner orders by reset dates or remaining quota without changing the current account", () => {
  const rows = [row("a", 10, 10), row("b", 6, 90), row("c", 2, 0)];
  assert.deepEqual(sortResetAccounts(rows, "nextReset", "a", 4000).map(item => item.account.id), ["b", "a", "c"]);
  assert.deepEqual(sortResetAccounts(rows, "available", "a", 4000).map(item => item.account.id), ["c", "a", "b"]);
  assert.equal(sortResetAccounts(rows, "current", "b", 4000)[0].account.id, "b");
  assert.deepEqual(rows.map(item => item.account.id), ["a", "b", "c"]);
});
test("planner shows dates and distinguishes account observations from global announcements", () => {
  const rows = [row('<img onerror="bad()">', 9999999999, 10)];
  const html = renderResetDashboard(rows, 4000);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<time datetime=/);
  assert.match(html, /Not observed yet/);
  assert.match(html, /not global announcements/);
});
test("reset credit details show granted/expiry dates with escaped labels", () => {
  const html = renderCreditDetails({ rateLimitResetCredits: { availableCount: 2, credits: [
    { id: "private-id", status: "available", resetType: "codexRateLimits", title: "<bad>", grantedAt: 100, expiresAt: 200 },
  ] } });
  assert.match(html, /Granted/);
  assert.match(html, /Expires/);
  assert.match(html, /&lt;bad&gt;/);
  assert.doesNotMatch(html, /private-id/);
});
test("unknown historical resets and elapsed reset dates never display a false future countdown", () => {
  assert.match(renderHistory(emptyHistory()), /No reset observed/);
  assert.match(formatLimitHtml({ primary: { usedPercent: 25, resetsAt: 1 } }), /Reset time passed/);
  assert.doesNotMatch(formatLimitHtml({ primary: { usedPercent: 25, resetsAt: 1 } }), /less than 1m/);
  assert.equal(renderDate(Infinity), "Unknown");
});
