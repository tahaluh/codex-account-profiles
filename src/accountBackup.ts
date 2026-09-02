export interface AccountBackupFile {
  version: 1;
  exportedAt: string;
  accounts: AccountBackupEntry[];
}

export interface AccountBackupEntry {
  name: string;
  email?: string;
  planType?: string;
  enabled: boolean;
  priority: number;
  authJson: Record<string, unknown>;
}

export function parseAccountBackup(value: unknown): AccountBackupFile {
  const backup = asRecord(value, "backup");
  if (backup.version !== 1 || !Array.isArray(backup.accounts)) {
    throw new Error("Unsupported Codex account backup format.");
  }
  if (backup.accounts.length > 500) throw new Error("The backup contains too many accounts.");
  const accounts = backup.accounts.map((value, index): AccountBackupEntry => {
    const entry = asRecord(value, `account ${index + 1}`);
    const authJson = asRecord(entry.authJson, `account ${index + 1} authJson`);
    return {
      name: requiredString(entry.name, `account ${index + 1} name`, 200),
      email: optionalString(entry.email, `account ${index + 1} email`, 320),
      planType: optionalString(entry.planType, `account ${index + 1} planType`, 100),
      enabled: entry.enabled !== false,
      priority: typeof entry.priority === "number" && Number.isFinite(entry.priority) ? entry.priority : index,
      authJson,
    };
  });
  return {
    version: 1,
    exportedAt: optionalString(backup.exportedAt, "exportedAt", 100) ?? new Date(0).toISOString(),
    accounts,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const normalized = optionalString(value, label, maxLength);
  if (!normalized) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${label}.`);
  return normalized;
}
