const assert = require("node:assert/strict");
const test = require("node:test");
const { decryptBackup, encryptBackup, isEncryptedBackup } = require("../dist/backupCrypto");

test("encrypted backups round trip without exposing auth values", async () => {
  const source = { version: 1, accounts: [{ name: "Work", authJson: { access_token: "secret-token" } }] };
  const encrypted = await encryptBackup(source, "correct horse battery staple");
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.doesNotMatch(JSON.stringify(encrypted), /secret-token/);
  assert.deepEqual(await decryptBackup(encrypted, "correct horse battery staple"), source);
});

test("encrypted backups reject wrong passwords and malformed metadata", async () => {
  const encrypted = await encryptBackup({ version: 1, accounts: [] }, "correct horse battery staple");
  await assert.rejects(decryptBackup(encrypted, "incorrect password"), /Could not decrypt/);
  await assert.rejects(decryptBackup({ ...encrypted, iv: "bad" }, "correct horse battery staple"), /Invalid encrypted backup iv/);
  await assert.rejects(encryptBackup({}, "short"), /at least 10/);
});
