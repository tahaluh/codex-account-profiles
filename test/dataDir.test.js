const assert = require("node:assert/strict");
const test = require("node:test");
const { dataDirCandidates } = require("../bin/data-dir");

test("data directory candidates prefer the current Marketplace identifier", () => {
  const candidates = dataDirCandidates({ platform: "linux", env: {}, home: "/home/test" });
  assert.equal(candidates[0], "/home/test/.config/Code/User/globalStorage/tahaluh.tahaluh-codex-account-switcher");
  assert.ok(candidates.some((candidate) => candidate.endsWith("tahaluh.tahaluh-codex-account-profiles")));
});

test("data directory candidates support macOS and Windows layouts", () => {
  const mac = dataDirCandidates({ platform: "darwin", env: {}, home: "/Users/test" });
  assert.equal(mac[0], "/Users/test/Library/Application Support/Code/User/globalStorage/tahaluh.tahaluh-codex-account-switcher");
  const windows = dataDirCandidates({ platform: "win32", env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, home: "C:\\Users\\test" });
  assert.equal(windows[0], "C:\\Users\\test\\AppData\\Roaming\\Code\\User\\globalStorage\\tahaluh.tahaluh-codex-account-switcher");
});
