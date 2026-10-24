const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateSwitch } = require("../dist/switchState");
const now = 200000;
const pending = { accountId: "b", requestedAt: now - 20000, requestId: "new" };

test("stale successful results and an old current-account file cannot complete a new switch", () => {
  const state = evaluateSwitch(pending, { accountId: "b", startedAt: now - 30000 },
    { accountId: "b", requestId: "old", success: true }, undefined, undefined, now);
  assert.equal(state.done, true);
  assert.match(state.error, /not connected/);
});

test("a stopped or mismatched launcher ends pending with a useful error", () => {
  const state = evaluateSwitch(pending, { accountId: "a" }, undefined, { updatedAt: now - 100000 }, undefined, now);
  assert.equal(state.done, true);
  assert.match(state.error, /Reload/);
});

test("a live active response keeps the switch queued with an explicit waiting state", () => {
  const state = evaluateSwitch(pending, { accountId: "a" }, undefined, { updatedAt: now, phase: "busy" }, undefined, now);
  assert.equal(state.done, false);
  assert.match(state.label, /Waiting/);
});

test("a matching failure or success terminates pending without stale-result races", () => {
  for (const success of [false, true]) {
    const state = evaluateSwitch(pending, { accountId: "a" }, { accountId: "b", requestId: "new", success }, undefined, undefined, now);
    assert.equal(state.done, true);
    assert.equal(Boolean(state.error), !success);
  }
});

test("a switch whose progress stops updating cannot remain pending forever", () => {
  const state = evaluateSwitch({ ...pending, requestedAt: 1 }, undefined, undefined,
    { updatedAt: now, phase: "switching" }, { requestId: "new", phase: "switching", updatedAt: 1 }, now);
  assert.equal(state.done, true);
  assert.match(state.error, /did not complete/);
});
