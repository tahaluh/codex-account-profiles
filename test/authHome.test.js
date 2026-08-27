const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, symlinkSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { ensureWritableAuthHome } = require("../bin/auth-home");

test("ensureWritableAuthHome recreates the parent directory for a broken auth symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-auth-home-"));
  const brokenTargetDir = join(root, "profiles", "missing");
  const authPath = join(root, "auth.json");
  mkdirSync(join(root, "profiles"), { recursive: true });
  symlinkSync(join(brokenTargetDir, "auth.json"), authPath);

  ensureWritableAuthHome(root);

  assert.equal(existsSync(brokenTargetDir), true);
});
