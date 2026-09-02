const test = require("node:test");
const assert = require("node:assert/strict");
const { createTurnLifecycle } = require("../bin/turn-lifecycle");

test("a queued switch stays blocked through all intermediate messages in a turn", () => {
  const lifecycle = createTurnLifecycle();

  lifecycle.recordClientMessage({ method: "turn/start" });
  assert.equal(lifecycle.isIdle(), false);

  for (const method of [
    "turn/started",
    "item/started",
    "item/agentMessage/delta",
    "item/completed",
    "item/started",
    "item/commandExecution/outputDelta",
    "item/completed",
    "item/agentMessage/delta",
    "item/completed",
  ]) {
    assert.equal(lifecycle.recordBackendMessage({ method }), false);
    assert.equal(lifecycle.isIdle(), false, `${method} must not finish the current flow`);
  }

  assert.equal(lifecycle.recordBackendMessage({ method: "turn/completed" }), true);
  assert.equal(lifecycle.isIdle(), true);
});

test("all terminal turn statuses arrive through turn/completed", () => {
  for (const status of ["completed", "failed", "interrupted"]) {
    const lifecycle = createTurnLifecycle();
    lifecycle.recordClientMessage({ method: "turn/start" });
    assert.equal(lifecycle.recordBackendMessage({ method: "turn/completed", params: { turn: { status } } }), true);
    assert.equal(lifecycle.isIdle(), true);
  }
});
