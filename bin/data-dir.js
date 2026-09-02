const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");

const CURRENT_STORAGE_ID = "tahaluh.tahaluh-codex-account-switcher";
const TEMPORARY_STORAGE_ID = "tahaluh.tahaluh-codex-account-profiles";

function storageRoots(platform = process.platform, env = process.env, home = homedir()) {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    return ["Code", "Code - Insiders", "VSCodium"].map((product) => join(appData, product, "User", "globalStorage"));
  }
  if (platform === "darwin") {
    return ["Code", "Code - Insiders", "VSCodium"].map((product) => join(home, "Library", "Application Support", product, "User", "globalStorage"));
  }
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return ["Code", "Code - Insiders", "VSCodium"].map((product) => join(configHome, product, "User", "globalStorage"));
}

function dataDirCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const roots = storageRoots(platform, options.env, options.home);
  const ids = [CURRENT_STORAGE_ID, TEMPORARY_STORAGE_ID];
  return [
    ...ids.flatMap((id) => roots.map((root) => join(root, id))),
    join(options.home || homedir(), ".config", "Code", "User", "globalStorage", "local.codex-account-profiles"),
  ];
}

function resolveDataDir(options = {}) {
  const env = options.env || process.env;
  if (env.CODEX_ACCOUNT_PROFILES_DATA) return env.CODEX_ACCOUNT_PROFILES_DATA;
  const candidates = dataDirCandidates({ ...options, env });
  return candidates.find((candidate) => existsSync(path.join(candidate, "accounts.json"))) || candidates[0];
}

module.exports = { CURRENT_STORAGE_ID, TEMPORARY_STORAGE_ID, dataDirCandidates, resolveDataDir, storageRoots };
