"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmedLimitBoundary = confirmedLimitBoundary;
function confirmedLimitBoundary(trigger, triggerAt, finishedAt, lastDecision) {
    if (!trigger || triggerAt <= 0 || finishedAt < triggerAt || finishedAt <= lastDecision)
        return undefined;
    return finishedAt;
}
//# sourceMappingURL=quotaPolicy.js.map