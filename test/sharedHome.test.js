const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { prepareSharedHome } = require("../bin/shared-home");

test("shared history setup is idempotent and preserves credentials and previous local sessions", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "shared-home-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = join(root, "account"), shared = join(root, "shared");
  fs.mkdirSync(join(home, "sessions"), { recursive: true });
  fs.mkdirSync(shared);
  fs.writeFileSync(join(home, "sessions", "original.jsonl"), "preserve me");
  fs.writeFileSync(join(home, "auth.json"), '{"account":"private"}');
  fs.writeFileSync(join(shared, "auth.json"), '{"account":"global"}');
  fs.writeFileSync(join(shared, "config.toml"), 'model="test"');
  const prepared = prepareSharedHome(home, shared);
  prepareSharedHome(home, shared);
  assert.equal(prepared.home, home);
  assert.ok(prepared.args.includes(`sqlite_home=${JSON.stringify(shared)}`));
  assert.equal(fs.realpathSync(join(home, "sessions")), join(shared, "sessions"));
  assert.equal(fs.realpathSync(join(home, "history.jsonl")), join(shared, "history.jsonl"));
  const backups = fs.readdirSync(home).filter((name) => name.startsWith("sessions.before-shared-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(join(home, backups[0], "original.jsonl"), "utf8"), "preserve me");
  assert.equal(fs.readFileSync(join(home, "auth.json"), "utf8"), '{"account":"private"}');
  assert.equal(fs.readFileSync(join(shared, "auth.json"), "utf8"), '{"account":"global"}');
});
