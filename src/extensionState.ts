import { RateLimits } from "./codexClient";

export interface LimitCacheEntry {
  result?: RateLimits;
  checkedAt: number;
  error?: string;
}

export type LimitCache = Record<string, LimitCacheEntry>;

export type TokenRefreshState = Record<string, { checkedAt: number; refreshedAt?: number; error?: string }>;
