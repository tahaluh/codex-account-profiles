const test = require("node:test");
const assert = require("node:assert/strict");
const { parseProxyEnv } = require("../dist/proxyEnv");

test("parseProxyEnv reads supported proxy keys and ignores other values", () => {
  const parsed = parseProxyEnv(`
    export HTTPS_PROXY="http://proxy.example:8080"
    http_proxy='http://lower.example:8080'
    NO_PROXY=localhost,127.0.0.1 # local
    SECRET_TOKEN=hidden
  `);

  assert.equal(parsed.HTTPS_PROXY, "http://proxy.example:8080");
  assert.equal(parsed.HTTP_PROXY, "http://lower.example:8080");
  assert.equal(parsed.NO_PROXY, "localhost,127.0.0.1");
  assert.equal(parsed.SECRET_TOKEN, undefined);
});
