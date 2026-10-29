const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { planResetNotifications, emptyNotificationState, collectResetNotifications } = require("../dist/resetNotifications");
const { emptyHistory } = require("../dist/resetTracker");
const now = 1700000000000;
const options = { quotaRenewed: true, creditExpiring: true, expiryHours: 24 };
const event = { id: "renewal-1", kind: "quotaRenewed", observedAt: now };
const history = { ...emptyHistory(), checkedAt: now, events: [event] };
const expiring = { rateLimitResetCredits: { availableCount: 1, credits: [{ id: "credit-1", status: "available", expiresAt: now / 1000 + 3600 }] } };

test("first notification poll establishes a history baseline without replaying reset events", () => {
  const planned = planResetNotifications(history, {}, emptyNotificationState(), options, now);
  assert.deepEqual(planned.notices, []);
  assert.ok(planned.state.seenEvents.includes(event.id));
});
test("new quota renewals notify once and muted observations do not replay on re-enable", () => {
  const initial = { ...emptyNotificationState(), initialized: true };
  const first = planResetNotifications(history, {}, initial, options, now);
  assert.equal(first.notices[0].kind, "quotaRenewed");
  assert.deepEqual(planResetNotifications(history, {}, first.state, options, now).notices, []);
  const muted = planResetNotifications(history, {}, initial, { ...options, quotaRenewed: false }, now);
  assert.deepEqual(planResetNotifications(history, {}, muted.state, options, now).notices, []);
});
test("expiry warnings respect thresholds, ignore expired/unavailable credits, and deduplicate", () => {
  const first = planResetNotifications(emptyHistory(), expiring, emptyNotificationState(), options, now);
  assert.equal(first.notices[0].kind, "creditExpiring");
  assert.deepEqual(planResetNotifications(emptyHistory(), expiring, first.state, options, now).notices, []);
  const result = { rateLimitResetCredits: { credits: [
    { id: "expired", status: "available", expiresAt: now / 1000 - 1 },
    { id: "used", status: "redeemed", expiresAt: now / 1000 + 3600 },
    { id: "later", status: "available", expiresAt: now / 1000 + 5 * 86400 },
  ] } };
  assert.deepEqual(planResetNotifications(emptyHistory(), result, emptyNotificationState(), options, now).notices, []);
});
test("out-of-order samples and old history cannot create renewed-quota alerts", () => {
  const previous = { ...emptyNotificationState(), initialized: true, lastCheckedAt: now + 1000 };
  assert.strictEqual(planResetNotifications(history, expiring, previous, options, now).state, previous);
  const old = { ...history, events: [{ ...event, observedAt: now - 3600000 }] };
  assert.deepEqual(planResetNotifications(old, {}, { ...previous, lastCheckedAt: 0 }, options, now).notices, []);
});
test("simultaneous windows claim an expiry notification only once", async (t) => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-reset-notice-"));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  const account = { id: "test", enabled: true, codexHome };
  const notices = await Promise.all([
    collectResetNotifications(account, emptyHistory(), expiring, options, now),
    collectResetNotifications(account, emptyHistory(), expiring, options, now),
  ]);
  assert.equal(notices.flat().length, 1);
  assert.deepEqual(await collectResetNotifications({ ...account, enabled: false }, history, expiring, options, now), []);
});
