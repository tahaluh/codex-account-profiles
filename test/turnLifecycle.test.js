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

test("a rejected start releases only that request while another conversation is active", () => {
  const lifecycle = createTurnLifecycle();
  lifecycle.recordClientMessage({ id: 1, method: "turn/start", params: { threadId: "a" } });
  lifecycle.recordClientMessage({ id: 2, method: "turn/start", params: { threadId: "b" } });
  lifecycle.recordBackendMessage({ id: 1, result: { turn: { id: "turn-a" } } });
  lifecycle.recordBackendMessage({ id: 2, error: { code: -32600 } });
  assert.equal(lifecycle.isIdle(), false);
  lifecycle.recordBackendMessage({ method: "turn/completed", params: { threadId: "a", turn: { id: "turn-a" } } });
  assert.equal(lifecycle.isIdle(), true);
});

test("duplicate completion events do not release a different active turn", () => {
  const lifecycle = createTurnLifecycle();
  for (const threadId of ["a", "b"]) {
    lifecycle.recordClientMessage({ id: threadId, method: "turn/start", params: { threadId } });
    lifecycle.recordBackendMessage({ id: threadId, result: { turn: { id: "turn-" + threadId } } });
  }
  const finished = { method: "turn/completed", params: { threadId: "a", turn: { id: "turn-a" } } };
  lifecycle.recordBackendMessage(finished);
  lifecycle.recordBackendMessage(finished);
  assert.equal(lifecycle.isIdle(), false);
  lifecycle.recordBackendMessage({ method: "turn/completed", params: { threadId: "b", turn: { id: "turn-b" } } });
  assert.equal(lifecycle.isIdle(), true);
});

test("a terminal turn returned directly in the start response cannot leave a phantom active turn", () => {
  const lifecycle = createTurnLifecycle();
  lifecycle.recordClientMessage({ id: 1, method: "turn/start", params: { threadId: "a" } });
  lifecycle.recordBackendMessage({ id: 1, result: { turn: { id: "done", status: "failed" } } });
  assert.equal(lifecycle.isIdle(), true);
});
