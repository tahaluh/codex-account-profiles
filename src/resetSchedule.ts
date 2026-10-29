import { createHash } from "node:crypto";
import { ResetDashboardAccount, renderDate, validEpoch } from "./resetPresentation";
import { escapeHtml } from "./quotaPresentation";
import { quotaWindows } from "./resetTracker";

export interface ScheduledReset {
  key: string;
  accountId: string;
  accountName: string;
  label: string;
  kind: "windowReset" | "creditExpiry";
  at: number;
  checkedAt?: number;
  stale: boolean;
}

export function buildResetSchedule(rows: ResetDashboardAccount[], now = Date.now()): ScheduledReset[] {
  const events: ScheduledReset[] = [];
  for (const { account, result, checkedAt, error } of rows) {
    if (!result || account.enabled === false) continue;
    const stale = Boolean(error) || !checkedAt || now - checkedAt > 15 * 60 * 1000 || checkedAt > now + 60000;
    for (const window of quotaWindows(result)) {
      if (validEpoch(window.resetsAt) && window.resetsAt * 1000 > now) events.push({
        key: `${account.id}:window:${window.key}:${window.resetsAt}`, accountId: account.id, accountName: account.name,
        label: window.label, kind: "windowReset", at: window.resetsAt, checkedAt, stale,
      });
    }
    for (const credit of result.rateLimitResetCredits?.credits || []) {
      if (credit.status === "available" && validEpoch(credit.expiresAt) && credit.expiresAt * 1000 > now) events.push({
        key: `${account.id}:credit:${credit.id}:${credit.expiresAt}`, accountId: account.id, accountName: account.name,
        label: credit.title || "Banked reset", kind: "creditExpiry", at: credit.expiresAt, checkedAt, stale,
      });
    }
  }
  return [...new Map(events.map(event => [event.key, event])).values()].sort((a, b) => a.at - b.at || a.accountName.localeCompare(b.accountName));
}

export function renderResetAgenda(rows: ResetDashboardAccount[], now = Date.now()): string {
  const events = buildResetSchedule(rows, now);
  if (!rows.length) return "";
  return `<details class="reset-agenda" data-persist="agenda"><summary>Upcoming resets & expiries (${events.length})</summary><p>Reported account dates; window resets may change.</p>${events.length
    ? `<ol>${events.slice(0, 12).map(event => `<li><strong>${escapeHtml(event.accountName)} · ${escapeHtml(event.label)}</strong><span>${event.kind === "creditExpiry" ? "Banked reset expires" : "Window reset"} · ${renderDate(event.at)}${event.stale ? ' <em class="stale">Cached — refresh before planning</em>' : ""}</span></li>`).join("")}</ol>`
    : '<p>No upcoming dates reported for enabled accounts.</p>'}<button class="secondary" id="exportResetCalendar">Export calendar (.ics)</button><button class="secondary" id="copyResetSchedule">Copy schedule</button><small>Calendar export includes recent successful quota reads only. No automatic calendar sync.</small></details>`;
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function stamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
// RFC 5545 lines are folded by UTF-8 octets without splitting a code point.
function foldLine(line: string): string {
  const lines: string[] = [];
  let part = "", bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 75) { lines.push(part); part = " "; bytes = 1; }
    part += character; bytes += size;
  }
  lines.push(part);
  return lines.join("\r\n");
}

export function exportResetCalendar(events: ScheduledReset[], now = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Codex Account Profiles//Reset Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events.filter(event => !event.stale && validEpoch(event.at) && event.at <= 253402300799 && event.at * 1000 > now)) {
    const uid = createHash("sha256").update(event.key).digest("hex");
    const title = `Codex · ${event.accountName} · ${event.kind === "creditExpiry" ? "banked reset expires" : event.label + " reset"}`;
    const description = event.kind === "creditExpiry"
      ? "Reported banked reset expiry. Credits are never redeemed automatically."
      : "Reported quota-window reset, not a guarantee of full account availability. Dates can change; refresh in Codex Account Profiles.";
    lines.push("BEGIN:VEVENT", `UID:${uid}@codex-account-profiles`, `DTSTAMP:${stamp(now / 1000)}`,
      `DTSTART:${stamp(event.at)}`, `DTEND:${stamp(event.at + 60)}`, `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText(description + (event.checkedAt ? " Last checked: " + new Date(event.checkedAt).toISOString() : ""))}`,
      "STATUS:TENTATIVE", "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function resetScheduleText(events: ScheduledReset[]): string {
  return events.map(event => `${event.accountName} · ${event.label} · ${event.kind === "creditExpiry" ? "expires" : "window reset"}: ${new Date(event.at * 1000).toLocaleString()}${event.stale ? " (cached)" : ""}`).join("\n");
}
