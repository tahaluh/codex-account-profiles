import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AccountProfile } from "./accountStore";
import { RateLimits, RateWindow, extractLimitBuckets, limitBucketLabel } from "./codexClient";
import { writeJsonAtomic } from "./fsUtils";

export interface ResetWindow extends RateWindow { key: string; label: string }
export interface ResetEvent {
  id: string;
  kind: "quotaRenewed" | "creditApplied";
  observedAt: number;
  since?: number;
  window?: string;
  beforeUsed?: number;
  afterUsed?: number;
}
export interface ResetHistory { version: 1; checkedAt: number; windows: ResetWindow[]; events: ResetEvent[] }
export const emptyHistory = (): ResetHistory => ({ version: 1, checkedAt: 0, windows: [], events: [] });

export function quotaWindows(result: RateLimits): ResetWindow[] {
  return extractLimitBuckets(result).flatMap((bucket) => (["primary", "secondary"] as const).flatMap((slot) => {
    const window = bucket[slot];
    if (!window) return [];
    const duration = window.windowDurationMins;
    const name = duration === 300 ? "5h" : duration === 10080 ? "Weekly" : duration ? `${duration}m` : slot;
    return [{ ...window, key: `${bucket.limitId || "default"}:${slot}:${duration || 0}`, label: `${limitBucketLabel(bucket)} · ${name}` }];
  }));
}

export function nextResetAt(result?: RateLimits, now = Date.now()): number | undefined {
  const dates = result ? quotaWindows(result).map(window => window.resetsAt).filter((date): date is number =>
    typeof date === "number" && Number.isFinite(date) && date * 1000 > now && date < 8640000000000) : [];
  return dates.length ? Math.min(...dates) : undefined;
}

export function observeQuota(previous: ResetHistory, result: RateLimits, checkedAt = Date.now()): ResetHistory {
  if (checkedAt <= previous.checkedAt) return previous;
  const windows = quotaWindows(result);
  const events = [...previous.events];
  for (const current of windows) {
    const old = previous.windows.find(window => window.key === current.key);
    const before = old?.usedPercent, after = current.usedPercent;
    // A first sample or a timer crossing alone cannot establish a historical reset.
    // Require restored quota plus a changed/elapsed window boundary.
    const validUsage = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    const boundaryChanged = old?.resetsAt && current.resetsAt && current.resetsAt > old.resetsAt;
    if (old && validUsage(before) && validUsage(after) && before - after >= 1 && boundaryChanged) {
      const id = `${current.key}:${old.resetsAt}:${current.resetsAt}`;
      if (!events.some(event => event.id === id)) events.push({ id, kind: "quotaRenewed", observedAt: checkedAt,
        since: previous.checkedAt, window: current.label, beforeUsed: before, afterUsed: after });
    }
  }
  return { version: 1, checkedAt, windows, events: events.sort((a, b) => b.observedAt - a.observedAt).slice(0, 50) };
}

export async function readResetHistory(account: AccountProfile): Promise<ResetHistory> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(account.codexHome, "profile-reset-history.json"), "utf8")) as ResetHistory;
    return value.version === 1 && Array.isArray(value.windows) && Array.isArray(value.events) ? value : emptyHistory();
  } catch { return emptyHistory(); }
}

// Account-specific locks avoid lost history when several VS Code windows poll at once.
export async function withAccountResetLock<T>(account: AccountProfile, action: () => Promise<T>): Promise<T> {
  await fs.mkdir(account.codexHome, { recursive: true, mode: 0o700 });
  const lock = path.join(account.codexHome, ".profile-reset-history.lock");
  const deadline = Date.now() + 3000;
  while (true) {
    try {
      const fd = await fs.open(lock, "wx", 0o600);
      try { await fd.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() })); }
      catch (error) { await fs.unlink(lock).catch(() => undefined); throw error; }
      finally { await fd.close(); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await fs.readFile(lock, "utf8"));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") { await fs.unlink(lock).catch(() => undefined); continue; } }
        }
      } catch { /* Another writer may still be creating its lock. */ }
      if (Date.now() >= deadline) throw new Error("Reset history is busy in another window. Retry shortly.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await action(); }
  finally { await fs.unlink(lock).catch(() => undefined); }
}

export async function recordQuotaObservation(account: AccountProfile, result: RateLimits, checkedAt = Date.now()): Promise<ResetHistory> {
  return withAccountResetLock(account, async () => {
    const previous = await readResetHistory(account);
    const history = observeQuota(previous, result, checkedAt);
    if (history !== previous) await writeJsonAtomic(path.join(account.codexHome, "profile-reset-history.json"), history);
    return history;
  });
}

