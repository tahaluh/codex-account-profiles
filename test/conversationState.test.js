const test = require("node:test");
const assert = require("node:assert/strict");
const { createConversationState, isMissingRollout } = require("../bin/conversation-state");

test("empty sessions retain client identity without modifying prompt text", () => {
  const state = createConversationState();
  state.remember({ method: "thread/start", params: { cwd: "/project" } }, { thread: { id: "original" } });
  const record = state.get("original");
  state.attach(record, "recreated");
  assert.equal(state.toBackend({ method: "turn/start", params: { threadId: "original", input: [{ text: "original" }] } }).params.threadId, "recreated");
  const event = state.toClient({ method: "item/agentMessage/delta", params: { threadId: "recreated", delta: "recreated" } });
  assert.equal(event.params.threadId, "original");
  assert.equal(event.params.delta, "recreated");
  assert.equal(state.toClient({ result: { thread: { id: "recreated" } } }).result.thread.id, "original");
});

test("accepted user turns prevent a saved conversation from being treated as an empty tab", () => {
  const state = createConversationState();
  state.remember({ method: "thread/start", params: {} }, { thread: { id: "original" } });
  assert.equal(state.get("original").hasTurns, false);
  state.noteRequest({ method: "turn/start", params: { threadId: "original" } });
  assert.equal(state.get("original").hasTurns, true);
  assert.equal(state.resume(state.get("original")).excludeTurns, true);
  state.resetLoaded();
  assert.equal(state.get("original").loaded, false);
});

test("only missing-history errors allow deferring a conversation", () => {
  assert.equal(isMissingRollout(new Error("no rollout found for thread id")), true);
  assert.equal(isMissingRollout(new Error("Authentication required")), false);
  assert.equal(isMissingRollout(new Error("required MCP server failed")), false);
});
