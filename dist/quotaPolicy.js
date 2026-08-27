"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remainingForWindow = remainingForWindow;
exports.shouldSwitchForThresholds = shouldSwitchForThresholds;
const codexClient_1 = require("./codexClient");
function remainingForWindow(result, targetMinutes) {
    const values = (0, codexClient_1.extractLimitBuckets)(result)
        .flatMap((bucket) => [bucket.primary, bucket.secondary])
        .filter((window) => Boolean(window))
        .filter((window) => window.windowDurationMins === targetMinutes)
        .map((window) => Math.max(0, 100 - (window.usedPercent ?? 100)));
    return values.length ? Math.max(...values) : undefined;
}
function shouldSwitchForThresholds(result, hourlyThreshold, weeklyThreshold) {
    const hourly = remainingForWindow(result, 300);
    const weekly = remainingForWindow(result, 10080);
    return (hourly !== undefined && hourly <= hourlyThreshold) || (weekly !== undefined && weekly <= weeklyThreshold);
}
//# sourceMappingURL=quotaPolicy.js.map