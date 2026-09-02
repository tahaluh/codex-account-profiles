import {
  bucketRemainingPercent,
  extractLimitBuckets,
  extractWindows,
  limitBucketLabel,
  RateLimitBucket,
  RateLimits,
  RateWindow,
} from "./codexClient";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

export function formatAge(timestamp?: number): string {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function quotaTone(remaining: number): string {
  if (remaining <= 10) return "bad";
  if (remaining <= 30) return "warn";
  return "good";
}

function windowName(window: RateWindow): string {
  if (window.windowDurationMins === 300) return "5h";
  if (window.windowDurationMins === 10080) return "weekly";
  return window.windowDurationMins ? `${window.windowDurationMins}m` : "limit";
}

function formatRelativeTime(targetSeconds: number): string {
  const diffSeconds = Math.max(0, targetSeconds - Math.floor(Date.now() / 1000));
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "less than 1m";
}

function formatResetText(resetSeconds?: number): string {
  if (!resetSeconds) return "Reset unknown";
  return `Reset in ${formatRelativeTime(resetSeconds)} (${new Date(resetSeconds * 1000).toLocaleString()})`;
}

function formatResetHtml(resetSeconds?: number): string {
  if (!resetSeconds) return "<small>Reset unknown</small>";
  const date = new Date(resetSeconds * 1000).toLocaleString();
  return `<small><span class="reset-relative">Reset in ${escapeHtml(formatRelativeTime(resetSeconds))}</span><span class="reset-date">${escapeHtml(date)}</span></small>`;
}

export function formatLimits(result: RateLimits): string {
  return extractWindows(result).map((window) => {
    const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
    return `${windowName(window)}: ${remaining.toFixed(1)}% remaining, ${formatResetText(window.resetsAt)}`;
  }).join(" | ");
}

function formatBucketHtml(bucket: RateLimitBucket, showBucketLabel: boolean): string {
  const bucketLabel = showBucketLabel ? `<div class="bucket-label">${escapeHtml(limitBucketLabel(bucket))}</div>` : "";
  const windows = extractWindows(bucket).map((window) => {
    const remaining = Math.max(0, 100 - (window.usedPercent ?? 100));
    return `<div class="limit"><div class="limit-head"><strong>${escapeHtml(windowName(window))}</strong><span>${remaining.toFixed(1)}% remaining</span></div><div class="bar" role="progressbar" aria-valuenow="${remaining.toFixed(1)}"><i style="width:${remaining.toFixed(1)}%"></i></div>${formatResetHtml(window.resetsAt)}</div>`;
  }).join("");
  const reachedType = bucket.rateLimitReachedType ? `<small class="limit-reason">${escapeHtml(bucket.rateLimitReachedType)}</small>` : "";
  return `<section class="bucket ${bucketRemainingPercent(bucket) <= 0 ? "depleted" : ""}">${bucketLabel}${windows}${reachedType}</section>`;
}

export function formatLimitHtml(result: RateLimits): string {
  const availableResets = result.rateLimitResetCredits?.availableCount;
  const summaryParts = [];
  if (typeof availableResets === "number") summaryParts.push(`${availableResets} reset${availableResets === 1 ? "" : "s"} available`);
  const summary = summaryParts.length ? `<div class="reset-summary">${escapeHtml(summaryParts.join(" | "))}</div>` : "";
  const buckets = extractLimitBuckets(result);
  const showBucketLabels = buckets.length > 1 || buckets.some((bucket) => bucket.planType || bucket.limitName);
  return summary + buckets.map((bucket) => formatBucketHtml(bucket, showBucketLabels)).join("");
}
