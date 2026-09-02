const RATE_LIMIT_REACHED_TYPES = new Set([
  "rate_limit_reached",
  "workspace_owner_credits_depleted",
  "workspace_member_credits_depleted",
  "workspace_owner_usage_limit_reached",
  "workspace_member_usage_limit_reached",
]);

function hasHttp429(value) {
  if (!value || typeof value !== "object") return false;
  if (value.httpStatusCode === 429 || value.code === 429 || value.status === 429) return true;
  return Object.values(value).some(hasHttp429);
}

function isConfirmedRateLimitMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.error && hasHttp429(message.error)) return true;

  if (message.method === "turn/completed") {
    const info = message.params?.turn?.error?.codexErrorInfo;
    return info === "usageLimitExceeded" || hasHttp429(info);
  }

  if (message.method === "account/rateLimits/updated") {
    const limits = message.params?.rateLimits ?? message.params;
    const buckets = limits?.rateLimitsByLimitId
      ? Object.values(limits.rateLimitsByLimitId)
      : [limits];
    return buckets.some((bucket) =>
      RATE_LIMIT_REACHED_TYPES.has(bucket?.rateLimitReachedType)
      || bucket?.spendControlReached === true,
    );
  }

  return false;
}

function isConfirmedRateLimitDiagnostic(value) {
  return /\b(?:http(?: status)?\s*[:=]?\s*429|status(?: code)?\s*[:=]\s*429|too many requests)\b/i.test(String(value));
}

module.exports = { isConfirmedRateLimitDiagnostic, isConfirmedRateLimitMessage };
