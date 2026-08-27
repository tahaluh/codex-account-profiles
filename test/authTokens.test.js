const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeJwtPayload, isJwtExpired } = require("../dist/authTokens");

function token(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.signature`;
}

test("decodeJwtPayload decodes base64url payloads", () => {
  assert.deepEqual(decodeJwtPayload(token({ exp: 123, sub: "acct" })), { exp: 123, sub: "acct" });
});

test("isJwtExpired honors skew seconds", () => {
  assert.equal(isJwtExpired(token({ exp: 200 }), 10, 100), false);
  assert.equal(isJwtExpired(token({ exp: 105 }), 10, 100), true);
  assert.equal(isJwtExpired("bad-token", 0, 100), true);
});
