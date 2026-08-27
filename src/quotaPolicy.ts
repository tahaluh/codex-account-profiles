import { extractLimitBuckets, RateLimits, RateWindow } from "./codexClient";

export function remainingForWindow(result: RateLimits, targetMinutes: number): number | undefined {
  const values = extractLimitBuckets(result)
    .flatMap((bucket) => [bucket.primary, bucket.secondary])
    .filter((window): window is RateWindow => Boolean(window))
    .filter((window) => window.windowDurationMins === targetMinutes)
    .map((window) => Math.max(0, 100 - (window.usedPercent ?? 100)));
  return values.length ? Math.max(...values) : undefined;
}

export function shouldSwitchForThresholds(result: RateLimits, hourlyThreshold: number, weeklyThreshold: number): boolean {
  const hourly = remainingForWindow(result, 300);
  const weekly = remainingForWindow(result, 10080);
  return (hourly !== undefined && hourly <= hourlyThreshold) || (weekly !== undefined && weekly <= weeklyThreshold);
}
