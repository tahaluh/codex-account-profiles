const test = require("node:test");
const assert = require("node:assert/strict");
const { renderAccountsViewHtml } = require("../dist/accountsViewHtml");

test("accounts view applies its nonce and renders supplied rows", () => {
  const html = renderAccountsViewHtml({ nonce: "test-nonce", codexInstalled: true, accountRows: ["<article>Profile</article>"] });
  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.match(html, /<script nonce="test-nonce">/);
  assert.match(html, /<article>Profile<\/article>/);
  assert.doesNotMatch(html, /OpenAI Codex is required/);
});

test("accounts view renders empty and missing-Codex states", () => {
  const html = renderAccountsViewHtml({ nonce: "test-nonce", codexInstalled: false, accountRows: [] });
  assert.match(html, /No profiles configured/);
  assert.match(html, /OpenAI Codex is required/);
});

test("reset planner sort and public tracker actions are rendered with saved disclosure state", () => {
  const html = renderAccountsViewHtml({ nonce: "n", codexInstalled: true, accountRows: [], sortOrder: "nextReset", resetDashboard: '<section id="reset-planner">Reset planner</section>' });
  assert.match(html, /<option value="nextReset" selected>/);
  assert.match(html, /id="reset-planner"/);
  assert.match(html, /command:'sort'/);
  assert.match(html, /post\('publicResetTracker'\)/);
  assert.match(html, /vscode\.getState\(\)/);
});
