const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { emptyHistory, observeQuota, nextResetAt, recordQuotaObservation, readResetHistory } = require("../dist/resetTracker");
const limits = (used, reset, duration = 300) => ({ rateLimitsByLimitId: { codex: { primary: { usedPercent: used, resetsAt: reset, windowDurationMins: duration } } } });

test("a first sample never fabricates the date of a previous reset", () => {
  const history = observeQuota(emptyHistory(), limits(0, 8000), 1000000);
  assert.deepEqual(history.events, []);
});
test("quota renewal records an observation interval, not an invented exact reset time", () => {
  const initial = observeQuota(emptyHistory(), limits(90, 2000), 1000000);
  const history = observeQuota(initial, limits(2, 5000), 3000000);
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].since, 1000000);
  assert.equal(history.events[0].observedAt, 3000000);
  assert.equal(history.events[0].beforeUsed, 90);
  assert.equal(history.events[0].afterUsed, 2);
  assert.equal(observeQuota(history, limits(2, 5000), 4000000).events.length, 1);
});
test("usage increases, small corrections, timer changes alone, and stale samples are not resets", () => {
  const initial = observeQuota(emptyHistory(), limits(50, 2000), 1000000);
  for (const result of [limits(60, 5000), limits(49.9, 5000), limits(50, 5000), limits(2, 2000)]) {
    assert.equal(observeQuota(initial, result, 3000000).events.length, 0);
  }
  assert.strictEqual(observeQuota(initial, limits(0, 5000), 1000000), initial);
  assert.equal(observeQuota(initial, limits(0, 5000, 10080), 3000000).events.length, 0);
});
test("next reset ignores missing, nonfinite, and elapsed timestamps across every bucket", () => {
  assert.equal(nextResetAt({ rateLimitsByLimitId: {
    codex: { primary: { resetsAt: 2 }, secondary: { resetsAt: 8 } }, other: { primary: { resetsAt: 5 } }, invalid: { primary: { resetsAt: Infinity } },
  } }, 3000), 5);
  assert.equal(nextResetAt(limits(50, 2), 3000), undefined);
});
test("history survives reopening and simultaneous window polls do not duplicate renewals", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-reset-history-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const account = { id: "test", codexHome: home };
  await recordQuotaObservation(account, limits(90, 2000), 1000000);
  await Promise.all([recordQuotaObservation(account, limits(0, 5000), 3000000), recordQuotaObservation(account, limits(0, 5000), 3000000)]);
  const history = await readResetHistory(account);
  assert.equal(history.events.length, 1);
  assert.equal(history.checkedAt, 3000000);
  assert.equal((await fs.stat(path.join(home, "profile-reset-history.json"))).mode & 0o777, 0o600);
});
