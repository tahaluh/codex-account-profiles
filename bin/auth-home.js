const { mkdirSync, lstatSync, readlinkSync } = require("node:fs");
const { dirname, isAbsolute, resolve, join } = require("node:path");

function ensureWritableAuthHome(home) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const authPath = join(home, "auth.json");
  try {
    const stat = lstatSync(authPath);
    if (!stat.isSymbolicLink()) return;
    const target = readlinkSync(authPath);
    const absoluteTarget = isAbsolute(target) ? target : resolve(dirname(authPath), target);
    mkdirSync(dirname(absoluteTarget), { recursive: true, mode: 0o700 });
  } catch {
    // No auth link to repair.
  }
}

module.exports = { ensureWritableAuthHome };
