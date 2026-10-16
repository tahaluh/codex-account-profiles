const fs = require("node:fs");
const { join, resolve } = require("node:path");
const { homedir } = require("node:os");
const { acquireAuthLock } = require("./auth-lock");

const SHARED_DIRECTORIES = [
  "sessions", "archived_sessions", "shell_snapshots", "generated_images", "attachments",
  "memories", "skills", "plugins", "rules", "packages", "vendor_imports", "thread-writer-locks",
];
const SHARED_FILES = ["config.toml", "AGENTS.md", "hooks.json", "history.jsonl", "session_index.jsonl"];

// Credentials and temporary state belong to the account. Never replace global auth.json.
function prepareSharedHome(accountHome, sharedHome = process.env.CODEX_SHARED_HOME || join(homedir(), ".codex")) {
  accountHome = resolve(accountHome);
  sharedHome = resolve(sharedHome);
  fs.mkdirSync(accountHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(sharedHome, { recursive: true, mode: 0o700 });
  if (accountHome !== sharedHome) {
    const release = acquireAuthLock(accountHome);
    try {
      for (const name of SHARED_DIRECTORIES) {
        fs.mkdirSync(join(sharedHome, name), { recursive: true, mode: 0o700 });
      }
      for (const name of ["history.jsonl", "session_index.jsonl"]) {
        const fd = fs.openSync(join(sharedHome, name), "a", 0o600);
        fs.closeSync(fd);
      }
      for (const name of [...SHARED_DIRECTORIES, ...SHARED_FILES]) {
        const target = join(sharedHome, name);
        if (!fs.existsSync(target)) continue;
        const destination = join(accountHome, name);
        let stat;
        try { stat = fs.lstatSync(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (stat?.isSymbolicLink() && resolve(accountHome, fs.readlinkSync(destination)) === target) continue;
        // Preserve pre-existing account-local state for manual recovery.
        if (stat) fs.renameSync(destination, `${destination}.before-shared-${Date.now()}-${process.pid}`);
        fs.symlinkSync(target, destination, SHARED_DIRECTORIES.includes(name) ? "junction" : "file");
      }
    } finally { release(); }
  }
  return {
    home: accountHome,
    args: ["-c", `sqlite_home=${JSON.stringify(sharedHome)}`, "-c", 'cli_auth_credentials_store="file"'],
    cleanup: () => {},
  };
}

module.exports = { prepareSharedHome };
