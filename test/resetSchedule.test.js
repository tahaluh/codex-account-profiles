const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResetSchedule, exportResetCalendar, resetScheduleText, renderResetAgenda } = require("../dist/resetSchedule");
const { emptyHistory } = require("../dist/resetTracker");
const now = 1700000000000;
const row = (name = "Work") => ({ account: { id: "private-account-id", name, enabled: true }, checkedAt: now, history: emptyHistory(), result: {
  primary: { resetsAt: now / 1000 + 3600, windowDurationMins: 300 }, secondary: { resetsAt: now / 1000 + 10000, windowDurationMins: 10080 },
  rateLimitResetCredits: { availableCount: 1, credits: [{ id: "private-credit-id", status: "available", title: "Banked", expiresAt: now / 1000 + 2000 }] },
} });

test("schedule combines all windows and banked expiries in chronological order", () => {
  const events = buildResetSchedule([row()], now);
  assert.deepEqual(events.map(event => event.kind), ["creditExpiry", "windowReset", "windowReset"]);
  assert.ok(events[0].at < events[1].at);
  assert.equal(buildResetSchedule([{ ...row(), account: { ...row().account, enabled: false } }], now).length, 0);
});
test("calendar includes only future fresh dates with stable IDs, UTC timestamps, and no raw private IDs", () => {
  const events = buildResetSchedule([row()], now);
  const calendar = exportResetCalendar(events, now);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(calendar, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(calendar, /STATUS:TENTATIVE/);
  assert.doesNotMatch(calendar, /private-account-id|private-credit-id/);
  assert.equal(exportResetCalendar(events.map(event => ({ ...event, stale: true })), now).includes("BEGIN:VEVENT"), false);
  assert.equal(exportResetCalendar(events, now + 20000000).includes("BEGIN:VEVENT"), false);
  const first = calendar.match(/UID:([^\r]+)/)[1];
  assert.ok(exportResetCalendar(events, now + 1000).includes(first));
});
test("calendar escapes property injection and folds UTF-8 without corrupting characters", () => {
  const name = "漢字🎮".repeat(40) + '\nATTENDEE:mailto:bad@example.com;\\,';
  const calendar = exportResetCalendar(buildResetSchedule([row(name)], now), now);
  for (const line of calendar.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  assert.doesNotMatch(calendar, /\r\nATTENDEE:/);
  const unfolded = calendar.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("漢字🎮".repeat(40)));
  assert.match(unfolded, /\\nATTENDEE/);
});
test("stale schedule entries remain visible and marked, but are excluded from calendar export", () => {
  const stale = { ...row('<img src=x>'), checkedAt: now - 3600000 };
  const events = buildResetSchedule([stale], now);
  assert.equal(events.every(event => event.stale), true);
  assert.match(resetScheduleText(events), /\(cached\)/);
  const html = renderResetAgenda([stale], now);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Cached/);
  assert.match(html, /exportResetCalendar/);
});
