const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, formatLimitHtml, formatLimits, quotaTone } = require("../dist/quotaPresentation");

test("quota presentation escapes account-provided labels", () => {
  const html = formatLimitHtml({
    rateLimitsByLimitId: {
      usage: {
        limitName: '<img src=x onerror="bad()">',
        primary: { windowDurationMins: 300, usedPercent: 96 },
      },
    },
  });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /4\.0% remaining/);
});

test("quota presentation keeps status text and tones stable", () => {
  const limits = { primary: { windowDurationMins: 300, usedPercent: 25 } };
  assert.match(formatLimits(limits), /5h: 75\.0% remaining/);
  assert.equal(quotaTone(10), "bad");
  assert.equal(quotaTone(30), "warn");
  assert.equal(quotaTone(31), "good");
  assert.equal(escapeHtml("A&B"), "A&amp;B");
});
