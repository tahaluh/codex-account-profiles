const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAccountBackup } = require("../dist/accountBackup");

test("backup parser normalizes valid account metadata", () => {
  const backup = parseAccountBackup({
    version: 1,
    exportedAt: "2026-08-28T00:00:00.000Z",
    accounts: [{ name: " Main ", enabled: true, priority: 3, authJson: { tokens: {} } }],
  });
  assert.equal(backup.accounts[0].name, "Main");
  assert.equal(backup.accounts[0].priority, 3);
});

test("backup parser rejects non-string names and non-object auth data", () => {
  assert.throws(() => parseAccountBackup({ version: 1, accounts: [{ name: {}, authJson: {} }] }), /name/);
  assert.throws(() => parseAccountBackup({ version: 1, accounts: [{ name: "Main", authJson: [] }] }), /authJson/);
});
