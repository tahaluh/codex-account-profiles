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

export interface RateLimits extends RateLimitBucket {
  rateLimits?: RateLimitBucket;
  rateLimitsByLimitId?: Record<string, RateLimitBucket>;
  rateLimitResetCredits?: { availableCount?: number };
}

export interface CodexIdentity {
  email?: string;
  planType?: string;
}

function readReply(child: ChildProcessWithoutNullStreams, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error("Timed out while reading Codex app-server response"));
    }, 10000);
    rl.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === id) {
          clearTimeout(timer);
          rl.close();
          resolve(message);
        }
      } catch {
        // The server may write non-JSON diagnostics to stdout.
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rl.close();
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Codex app-server exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function readRateLimits(profile: AccountProfile): Promise<RateLimits> {
  const child = spawn("codex", ["app-server"], {
    env: { ...process.env, CODEX_HOME: profile.codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {
      clientInfo: { name: "codex-account-profiles", title: "Codex Account Profiles", version: "0.1.0" },
    } }) + "\n");
    const initialized = await readReply(child, 1);
    if (initialized.error) throw new Error(initialized.error.message ?? "Codex initialization failed");
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ id: 2, method: "account/rateLimits/read" }) + "\n");
    const response = await readReply(child, 2);
    if (response.error) throw new Error(response.error.message ?? "Unable to read rate limits");
    return response.result ?? {};
  } finally {
    child.kill();
  }
}

export async function readIdentity(profile: AccountProfile): Promise<CodexIdentity> {
  const child = spawn("codex", ["app-server"], {
    env: { ...process.env, CODEX_HOME: profile.codexHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {
      clientInfo: { name: "codex-account-profiles", title: "Codex Account Profiles", version: "0.1.0" },
    } }) + "\n");
    const initialized = await readReply(child, 1);
    if (initialized.error) throw new Error(initialized.error.message ?? "Codex initialization failed");
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ id: 2, method: "account/read", params: {} }) + "\n");
    const response = await readReply(child, 2);
    if (response.error) throw new Error(response.error.message ?? "Unable to read Codex account");
    return response.result?.account ?? {};
  } finally {
    child.kill();
  }
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
