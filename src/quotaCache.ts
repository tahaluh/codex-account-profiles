import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { AccountProfile } from "./accountStore";
import { RateLimits } from "./codexClient";
import { writeJsonAtomic } from "./fsUtils";

const CACHE_VERSION = 1;
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface SharedQuotaCacheEntry {
  version: typeof CACHE_VERSION;
  accountKey: string;
  accountName: string;
  checkedAt: number;
  result: RateLimits;
}

interface SharedQuotaCacheFile {
  version: typeof CACHE_VERSION;
  entries: Record<string, SharedQuotaCacheEntry>;
}

export interface SharedQuotaCacheHit {
  result: RateLimits;
  checkedAt: number;
}

function cacheFilePath(): string {
  return path.join(os.tmpdir(), "codex-account-profiles", "quota-cache-v1.json");
}

function accountCacheKey(account: AccountProfile): string {
  return crypto.createHash("sha1").update(`${account.id}|${account.codexHome}`).digest("hex");
}

function emptyCache(): SharedQuotaCacheFile {
  return { version: CACHE_VERSION, entries: {} };
}

async function readCache(): Promise<SharedQuotaCacheFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFilePath(), "utf8")) as SharedQuotaCacheFile;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") return emptyCache();
    const now = Date.now();
    parsed.entries = Object.fromEntries(
      Object.entries(parsed.entries).filter(([, entry]) => now - entry.checkedAt <= CACHE_RETENTION_MS),
    );
    return parsed;
  } catch {
    return emptyCache();
  }
}

export async function readSharedQuotaCache(account: AccountProfile, ttlMs: number): Promise<SharedQuotaCacheHit | undefined> {
  const entry = (await readCache()).entries[accountCacheKey(account)];
  if (!entry || Date.now() - entry.checkedAt > ttlMs) return undefined;
  return { result: entry.result, checkedAt: entry.checkedAt };
}

export async function writeSharedQuotaCache(account: AccountProfile, result: RateLimits): Promise<void> {
  const cache = await readCache();
  const key = accountCacheKey(account);
  cache.entries[key] = {
    version: CACHE_VERSION,
    accountKey: key,
    accountName: account.name,
    checkedAt: Date.now(),
    result,
  };
  await writeJsonAtomic(cacheFilePath(), cache);
}
