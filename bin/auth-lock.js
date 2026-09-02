const { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const AUTH_LOCK_WAIT_MS = 30000;
const AUTH_LOCK_POLL_MS = 100;

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function shouldRemoveAuthLock(pid, processProbe = isProcessRunning) {
  return !processProbe(pid);
}

function tryRemoveStaleLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, "utf8");
    let holder = {};
    try { holder = JSON.parse(raw); } catch {}
    if (shouldRemoveAuthLock(Number(holder.pid))) {
      unlinkSync(lockPath);
      return true;
    }
  } catch {}
  return false;
}

function acquireAuthLock(sharedHome) {
  const lockDir = join(sharedHome, ".locks");
  const lockPath = join(lockDir, "codex-account-profiles-auth.lock");
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const started = Date.now();
  while (true) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { unlinkSync(lockPath); } catch {}
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (tryRemoveStaleLock(lockPath)) continue;
      if (Date.now() - started >= AUTH_LOCK_WAIT_MS) {
        throw new Error("Timed out waiting for Codex auth lock. Another Codex account switch may still be active.");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, AUTH_LOCK_POLL_MS);
    }
  }
}

module.exports = { acquireAuthLock, isProcessRunning, shouldRemoveAuthLock };
