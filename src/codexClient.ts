import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as readline from "node:readline";
import { AccountProfile } from "./accountStore";

export interface RateWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface RateLimitBucket {
  limitId?: string;
  limitName?: string | null;
  primary?: RateWindow;
  secondary?: RateWindow;
  planType?: string;
  rateLimitReachedType?: string | null;
}

export interface ResetCredit {
  id: string;
  resetType: string;
  status: string;
  grantedAt: number;
  expiresAt?: number | null;
  title?: string | null;
  description?: string | null;
}

export interface RateLimits extends RateLimitBucket {
  rateLimits?: RateLimitBucket;
  rateLimitsByLimitId?: Record<string, RateLimitBucket>;
  rateLimitResetCredits?: { availableCount?: number; credits?: ResetCredit[] | null };
}

export interface CodexIdentity {
  email?: string;
  planType?: string;
}

function readReply(child: ChildProcessWithoutNullStreams, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout });
    const cleanup = () => {
      clearTimeout(timer);
      rl.close();
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`Codex app-server exited before responding (${code ?? "unknown"})`)); };
    const timer = setTimeout(() => onError(new Error("Timed out while reading Codex app-server response")), 10000);
    rl.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message.method && message.id === id) { cleanup(); resolve(message); }
    });
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function accountRequest<T>(profile: AccountProfile, method: string, params?: unknown): Promise<T> {
  const child = spawn("codex", ["-c", 'cli_auth_credentials_store="file"', "app-server"], {
    env: { ...process.env, CODEX_HOME: profile.codexHome }, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  child.stdin.on("error", () => { /* RPC timeout/process exit reports transport failures. */ });
  try {
    const initializedReply = readReply(child, 1);
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {
      clientInfo: { name: "codex-account-profiles", title: "Codex Account Profiles", version: "0.4.0" },
    } }) + "\n");
    const initialized = await initializedReply;
    if (initialized.error) throw new Error(initialized.error.message ?? "Codex initialization failed");
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const reply = readReply(child, 2);
    child.stdin.write(JSON.stringify({ id: 2, method, ...(params !== undefined ? { params } : {}) }) + "\n");
    const response = await reply;
    if (response.error) throw new Error(response.error.message ?? "Codex account request failed");
    return response.result ?? {};
  } finally { child.kill(); }
}

export function readRateLimits(profile: AccountProfile): Promise<RateLimits> {
  return accountRequest(profile, "account/rateLimits/read");
}
export async function readIdentity(profile: AccountProfile): Promise<CodexIdentity> {
  const result = await accountRequest<{ account?: CodexIdentity }>(profile, "account/read", {});
  return result.account ?? {};
}
export type ResetOutcome = "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit";
export function consumeResetCredit(profile: AccountProfile, idempotencyKey: string, creditId?: string): Promise<{ outcome: ResetOutcome }> {
  if (!idempotencyKey.trim()) return Promise.reject(new Error("A reset attempt ID is required"));
  return accountRequest(profile, "account/rateLimitResetCredit/consume", { idempotencyKey, ...(creditId ? { creditId } : {}) });
}

export function extractLimitBuckets(result: RateLimits): RateLimitBucket[] {
  const byLimitId = result.rateLimitsByLimitId;
  if (byLimitId && Object.keys(byLimitId).length) {
    return Object.entries(byLimitId).map(([limitId, limits]) => ({ limitId, ...limits }));
  }
  if (result.rateLimits) return [result.rateLimits];
  return [result];
}

export function limitBucketLabel(bucket: RateLimitBucket): string {
  const parts = [bucket.limitName, bucket.planType, bucket.limitId].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" / ") : "account";
}

export function extractWindows(result: RateLimits | RateLimitBucket): RateWindow[] {
  const limits = "rateLimitsByLimitId" in result || "rateLimits" in result
    ? bestLimitBucket(result)
    : result;
  return [limits.primary, limits.secondary].filter((window): window is RateWindow => Boolean(window));
}

export function bucketRemainingPercent(bucket: RateLimitBucket): number {
  const windows = [bucket.primary, bucket.secondary].filter((window): window is RateWindow => Boolean(window));
  if (!windows.length) return 0;
  return Math.min(...windows.map((window) => Math.max(0, 100 - (window.usedPercent ?? 100))));
}

export function bestLimitBucket(result: RateLimits): RateLimitBucket {
  const buckets = extractLimitBuckets(result);
  return buckets.sort((a, b) => bucketRemainingPercent(b) - bucketRemainingPercent(a))[0] ?? result;
}

export function remainingPercent(result: RateLimits): number {
  const buckets = extractLimitBuckets(result);
  if (!buckets.length) return 0;
  // An account is fully available only when every reported limit window is full.
  // Using the best bucket here can make us switch to an account that is already
  // exhausted on another limit.
  return Math.min(...buckets.map(bucketRemainingPercent));
}

export function resetLabel(result: RateLimits): string {
  const reset = extractWindows(result).map((window) => window.resetsAt).filter((value): value is number => Boolean(value)).sort()[0];
  return reset ? new Date(reset * 1000).toLocaleString() : "unknown";
}
