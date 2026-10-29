const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { redeemAccountReset, readPendingRedemption } = require("../dist/resetRedemption");
const { readResetHistory } = require("../dist/resetTracker");
async function accountFixture(t) {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-reset-attempt-"));
  t.after(() => fs.rm(codexHome, { recursive: true, force: true }));
  return { id: "fixture", codexHome };
}
test("an uncertain redemption reuses its saved idempotency key across retries", async (t) => {
  const account = await accountFixture(t), keys = [];
  await assert.rejects(redeemAccountReset(account, "credit-1", async (_, key) => { keys.push(key); throw new Error("connection lost"); }));
  assert.ok(await readPendingRedemption(account));
  const result = await redeemAccountReset(account, "credit-1", async (_, key, credit) => {
    keys.push(key); assert.equal(credit, "credit-1"); return { outcome: "alreadyRedeemed" };
  });
  assert.equal(keys[0], keys[1]);
  assert.equal(result.outcome, "alreadyRedeemed");
  assert.equal(await readPendingRedemption(account), undefined);
  assert.equal((await readResetHistory(account)).events[0].kind, "creditApplied");
});
test("an unresolved attempt cannot silently switch to a different reset credit", async (t) => {
  const account = await accountFixture(t);
  await assert.rejects(redeemAccountReset(account, "one", async () => { throw new Error("connection lost"); }));
  let called = false;
  await assert.rejects(redeemAccountReset(account, "two", async () => { called = true; return { outcome: "reset" }; }), /unresolved/);
  assert.equal(called, false);
});
test("nothingToReset and noCredit do not create a successful-reset history event", async (t) => {
  for (const outcome of ["nothingToReset", "noCredit"]) {
    const account = await accountFixture(t);
    await redeemAccountReset(account, undefined, async () => ({ outcome }));
    assert.equal((await readResetHistory(account)).events.length, 0);
    assert.equal(await readPendingRedemption(account), undefined);
  }
});
