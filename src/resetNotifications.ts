import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AccountProfile } from "./accountStore";
import { RateLimits } from "./codexClient";
import { ResetHistory, withAccountResetLock } from "./resetTracker";
import { writeJsonAtomic } from "./fsUtils";

export interface ResetNotificationOptions { quotaRenewed: boolean; creditExpiring: boolean; expiryHours: number }
export interface NotificationState { version: 1; initialized: boolean; seenEvents: string[]; warnedCredits: string[]; lastCheckedAt?: number }
export interface ResetNotice { kind: "quotaRenewed" | "creditExpiring"; count: number; expiresAt?: number }
export const emptyNotificationState = (): NotificationState => ({ version: 1, initialized: false, seenEvents: [], warnedCredits: [] });

export function planResetNotifications(history: ResetHistory, result: RateLimits, previous: NotificationState,
  options: ResetNotificationOptions, now = Date.now()): { state: NotificationState; notices: ResetNotice[] } {
  const notices: ResetNotice[] = [];
  if (history.checkedAt < (previous.lastCheckedAt || 0)) return { state: previous, notices };
  const fresh = history.events.filter(event => event.kind === "quotaRenewed" && !previous.seenEvents.includes(event.id)
    && event.observedAt <= now && now - event.observedAt <= 15 * 60 * 1000);
  // First run establishes a baseline, rather than notifying about old history.
  if (options.quotaRenewed && previous.initialized && fresh.length) notices.push({ kind: "quotaRenewed", count: fresh.length });
  const warned = new Set(previous.warnedCredits);
  const hours = Number.isFinite(options.expiryHours) ? Math.min(168, Math.max(1, options.expiryHours)) : 24;
  const expiring = (result.rateLimitResetCredits?.credits || []).filter(credit => credit.status === "available"
    && typeof credit.expiresAt === "number" && Number.isFinite(credit.expiresAt) && credit.expiresAt * 1000 > now
    && credit.expiresAt * 1000 <= now + hours * 3600000 && !warned.has(`${credit.id}:${credit.expiresAt}`));
  if (options.creditExpiring && expiring.length) {
    notices.push({ kind: "creditExpiring", count: expiring.length, expiresAt: Math.min(...expiring.map(credit => credit.expiresAt!)) });
    expiring.forEach(credit => warned.add(`${credit.id}:${credit.expiresAt}`));
  }
  return { notices, state: { version: 1, initialized: true,
    seenEvents: [...new Set([...history.events.map(event => event.id), ...previous.seenEvents])].slice(0, 100),
    warnedCredits: [...warned].slice(-100), lastCheckedAt: history.checkedAt,
  } };
}

export async function collectResetNotifications(account: AccountProfile, history: ResetHistory, result: RateLimits,
  options: ResetNotificationOptions, now = Date.now()): Promise<ResetNotice[]> {
  if (!account.enabled) return [];
  return withAccountResetLock(account, async () => {
    const file = path.join(account.codexHome, "profile-reset-notifications.json");
    let previous = emptyNotificationState();
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (parsed.version === 1 && Array.isArray(parsed.seenEvents) && Array.isArray(parsed.warnedCredits)) previous = parsed;
    } catch { /* First notification check. */ }
    const planned = planResetNotifications(history, result, previous, options, now);
    // Claim notices before rendering so another window cannot display them again.
    await writeJsonAtomic(file, planned.state);
    return planned.notices;
  });
}
