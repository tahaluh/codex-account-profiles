import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AccountProfile } from "./accountStore";
import { AccountBackupFile, AccountBackupEntry } from "./accountBackup";
import { writeJsonAtomic } from "./fsUtils";

export type ImportStatus = "ready" | "needsLogin" | "unverified";
export interface ImportCheck { status: ImportStatus; email?: string; planType?: string; reason?: string }
export interface TransferReport { imported: { account: AccountProfile; status: ImportStatus; reason?: string }[]; duplicates: number; invalid: number; failed: number }

export function usableAuth(auth: Record<string, unknown>): boolean {
  if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim()) return true;
  const tokens = auth.tokens as Record<string, unknown> | undefined;
  return Boolean(tokens && typeof tokens.access_token === "string" && tokens.access_token.trim());
}
export function credentialFingerprint(auth: Record<string, unknown>): string {
  const tokens = auth.tokens as Record<string, unknown> | undefined;
  let subject: string | undefined;
  if (typeof tokens?.id_token === "string") {
    try { subject = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")).sub; } catch {}
  }
  const identity = typeof tokens?.account_id === "string" && typeof subject === "string"
    ? `chatgpt:${tokens.account_id}:${subject}` : typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY
      ? `key:${auth.OPENAI_API_KEY}` : `token:${tokens?.refresh_token || tokens?.access_token || JSON.stringify(auth)}`;
  return createHash("sha256").update(identity).digest("hex");
}
export function classifyImportFailure(error: unknown): ImportCheck {
  const message = String(error);
  if (/ENOENT|not found on PATH|entrypoint.*missing|spawn.*EINVAL/i.test(message)) return { status: "unverified", reason: "Codex CLI is missing or cannot start. Install @openai/codex on this computer and reload VS Code." };
  if (/401|403|unauthorized|unauthenticated|refresh.token|token.*(?:expired|revoked|invalid|reused)|login required|not logged|sign.?in|authentication required/i.test(message)) {
    return { status: "needsLogin", reason: "The transferred login could not be validated. Re-authenticate this profile on this computer." };
  }
  return { status: "unverified", reason: "Codex could not verify account access. Check connectivity, then Refresh or Re-authenticate." };
}

// Backup paths, account IDs and workspace settings are never restored onto the
// destination. Existing credentials are never overwritten by an older backup.
export async function importProfileEntries(backup: AccountBackupFile, root: string, existing: AccountProfile[],
  save: (accounts: AccountProfile[]) => Promise<void>, verify: (account: AccountProfile) => Promise<ImportCheck>): Promise<TransferReport> {
  const report: TransferReport = { imported: [], duplicates: 0, invalid: 0, failed: 0 };
  const fingerprints = new Set<string>();
  for (const account of existing) {
    try { fingerprints.add(credentialFingerprint(JSON.parse(await fs.readFile(path.join(account.codexHome, "auth.json"), "utf8")))); } catch {}
  }
  let accounts = [...existing];
  for (const entry of [...backup.accounts].sort((a, b) => a.priority - b.priority)) {
    if (!usableAuth(entry.authJson)) { report.invalid++; continue; }
    const fingerprint = credentialFingerprint(entry.authJson);
    if (fingerprints.has(fingerprint)) { report.duplicates++; continue; }
    const id = randomUUID();
    const account: AccountProfile = { id, name: entry.name, codexHome: path.join(root, "profiles", id), email: entry.email,
      planType: entry.planType, enabled: entry.enabled, priority: accounts.length };
    let committed = false;
    try {
      await fs.mkdir(account.codexHome, { recursive: true, mode: 0o700 });
      await writeJsonAtomic(path.join(account.codexHome, "auth.json"), entry.authJson);
      let check: ImportCheck;
      try { check = await verify(account); } catch (error) { check = classifyImportFailure(error); }
      account.email = check.email || entry.email;
      account.planType = check.planType || entry.planType;
      account.importStatus = check.status;
      account.importReason = check.reason;
      await save([...accounts, account]);
      committed = true;
      accounts = [...accounts, account];
      fingerprints.add(fingerprint);
      report.imported.push({ account, status: check.status, reason: check.reason });
    } catch { report.failed++; }
    finally { if (!committed) await fs.rm(account.codexHome, { recursive: true, force: true }).catch(() => undefined); }
  }
  return report;
}

export async function collectExportEntries(accounts: AccountProfile[]): Promise<{ entries: AccountBackupEntry[]; skipped: string[] }> {
  const entries: AccountBackupEntry[] = [], skipped: string[] = [];
  for (const account of accounts) {
    try {
      const auth = JSON.parse(await fs.readFile(path.join(account.codexHome, "auth.json"), "utf8"));
      if (!usableAuth(auth)) throw new Error("No file credentials");
      entries.push({ name: account.name, email: account.email, planType: account.planType, enabled: account.enabled, priority: account.priority, authJson: auth });
    } catch { skipped.push(account.name); }
  }
  return { entries, skipped };
}
