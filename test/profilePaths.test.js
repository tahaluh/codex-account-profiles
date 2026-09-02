const test = require("node:test");
const assert = require("node:assert/strict");
const { isPathInsideRoots } = require("../dist/profilePaths");

test("managed profile paths must be children of an approved root", () => {
  assert.equal(isPathInsideRoots("/storage/profiles/account-1", ["/storage/profiles"]), true);
  assert.equal(isPathInsideRoots("/storage/profiles", ["/storage/profiles"]), false);
  assert.equal(isPathInsideRoots("/storage/profiles-copy/account-1", ["/storage/profiles"]), false);
  assert.equal(isPathInsideRoots("/home/user/.codex", ["/storage/profiles"]), false);
});
