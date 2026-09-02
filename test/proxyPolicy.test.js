const test = require("node:test");
const assert = require("node:assert/strict");
const { isConfirmedRateLimitDiagnostic, isConfirmedRateLimitMessage } = require("../bin/proxy-policy");

test("normal rate-limit fields and assistant text do not trigger failover", () => {
  assert.equal(isConfirmedRateLimitMessage({
    method: "account/rateLimits/updated",
    params: { rateLimits: { rateLimitReachedType: null, spendControlReached: false } },
  }), false);
  assert.equal(isConfirmedRateLimitMessage({
    method: "item/completed",
    params: { item: { text: "Explain what rate limit reached means." } },
  }), false);
});

test("structured limit events trigger failover", () => {
  assert.equal(isConfirmedRateLimitMessage({
    method: "turn/completed",
    params: { turn: { error: { codexErrorInfo: "usageLimitExceeded" } } },
  }), true);
  assert.equal(isConfirmedRateLimitMessage({
    method: "turn/completed",
    params: { turn: { error: { codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } } } },
  }), true);
  assert.equal(isConfirmedRateLimitMessage({
    method: "account/rateLimits/updated",
    params: { rateLimits: { rateLimitReachedType: "rate_limit_reached" } },
  }), true);
  assert.equal(isConfirmedRateLimitMessage({ error: { code: 429 } }), true);
});

test("stderr detection requires an explicit HTTP signal", () => {
  assert.equal(isConfirmedRateLimitDiagnostic("HTTP 429: Too Many Requests"), true);
  assert.equal(isConfirmedRateLimitDiagnostic("rateLimitReachedType"), false);
  assert.equal(isConfirmedRateLimitDiagnostic("quota reached"), false);
});
