import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { AccountProfile } from "./accountStore";
import { consumeResetCredit, ResetOutcome } from "./codexClient";
import { writeJsonAtomic } from "./fsUtils";
import { readResetHistory, withAccountResetLock } from "./resetTracker";

export interface ResetAttempt { idempotencyKey: string; creditId?: string; createdAt: number; outcome?: ResetOutcome }
export async function readPendingRedemption(account: AccountProfile): Promise<ResetAttempt | undefined> {
  try {
    const attempt = JSON.parse(await fs.readFile(path.join(account.codexHome, "profile-reset-attempt.json"), "utf8")) as ResetAttempt;
    return typeof attempt.idempotencyKey === "string" && !attempt.outcome ? attempt : undefined;
  } catch { return undefined; }
}

// A failed/uncertain network response retains its key on disk. Retrying that
// attempt must never spend a second credit, including after restarting VS Code.
export async function redeemAccountReset(account: AccountProfile, creditId?: string,
  consume = consumeResetCredit): Promise<{ outcome: ResetOutcome; attemptId: string }> {
  const result = await withAccountResetLock(account, async () => {
    const pending = await readPendingRedemption(account);
    if (pending && pending.creditId !== creditId) throw new Error("An unresolved reset attempt exists. Retry that attempt before selecting a different reset.");
    const attempt: ResetAttempt = pending || { idempotencyKey: randomUUID(), creditId, createdAt: Date.now() };
    const file = path.join(account.codexHome, "profile-reset-attempt.json");
    await writeJsonAtomic(file, attempt);
    const reply = await consume(account, attempt.idempotencyKey, attempt.creditId);
    if (!["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(reply.outcome)) throw new Error("Codex returned an unknown reset outcome. Retry to check the same attempt.");
    if (["reset", "alreadyRedeemed"].includes(reply.outcome)) {
      const history = await readResetHistory(account);
      if (!history.events.some(event => event.id === attempt.idempotencyKey)) {
        history.events.unshift({ id: attempt.idempotencyKey, kind: "creditApplied", observedAt: Date.now() });
        history.events = history.events.slice(0, 50);
        await writeJsonAtomic(path.join(account.codexHome, "profile-reset-history.json"), history);
      }
    }
    await writeJsonAtomic(file, { ...attempt, outcome: reply.outcome });
    return { outcome: reply.outcome, attemptId: attempt.idempotencyKey };
  });
  return result;
}
