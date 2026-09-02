const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldRemoveAuthLock } = require("../bin/auth-lock");

test("auth lock is preserved while its owner process is alive", () => {
  assert.equal(shouldRemoveAuthLock(123, () => true), false);
});

test("auth lock is removable after its owner exits", () => {
  assert.equal(shouldRemoveAuthLock(123, () => false), true);
});
