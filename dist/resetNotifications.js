"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyNotificationState = void 0;
exports.planResetNotifications = planResetNotifications;
exports.collectResetNotifications = collectResetNotifications;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const resetTracker_1 = require("./resetTracker");
const fsUtils_1 = require("./fsUtils");
const emptyNotificationState = () => ({ version: 1, initialized: false, seenEvents: [], warnedCredits: [] });
exports.emptyNotificationState = emptyNotificationState;
function planResetNotifications(history, result, previous, options, now = Date.now()) {
    const notices = [];
    if (history.checkedAt < (previous.lastCheckedAt || 0))
        return { state: previous, notices };
    const fresh = history.events.filter(event => event.kind === "quotaRenewed" && !previous.seenEvents.includes(event.id)
        && event.observedAt <= now && now - event.observedAt <= 15 * 60 * 1000);
    // First run establishes a baseline, rather than notifying about old history.
    if (options.quotaRenewed && previous.initialized && fresh.length)
        notices.push({ kind: "quotaRenewed", count: fresh.length });
    const warned = new Set(previous.warnedCredits);
    const hours = Number.isFinite(options.expiryHours) ? Math.min(168, Math.max(1, options.expiryHours)) : 24;
    const expiring = (result.rateLimitResetCredits?.credits || []).filter(credit => credit.status === "available"
        && typeof credit.expiresAt === "number" && Number.isFinite(credit.expiresAt) && credit.expiresAt * 1000 > now
        && credit.expiresAt * 1000 <= now + hours * 3600000 && !warned.has(`${credit.id}:${credit.expiresAt}`));
    if (options.creditExpiring && expiring.length) {
        notices.push({ kind: "creditExpiring", count: expiring.length, expiresAt: Math.min(...expiring.map(credit => credit.expiresAt)) });
        expiring.forEach(credit => warned.add(`${credit.id}:${credit.expiresAt}`));
    }
    return { notices, state: { version: 1, initialized: true,
            seenEvents: [...new Set([...history.events.map(event => event.id), ...previous.seenEvents])].slice(0, 100),
            warnedCredits: [...warned].slice(-100), lastCheckedAt: history.checkedAt,
        } };
}
async function collectResetNotifications(account, history, result, options, now = Date.now()) {
    if (!account.enabled)
        return [];
    return (0, resetTracker_1.withAccountResetLock)(account, async () => {
        const file = path.join(account.codexHome, "profile-reset-notifications.json");
        let previous = (0, exports.emptyNotificationState)();
        try {
            const parsed = JSON.parse(await node_fs_1.promises.readFile(file, "utf8"));
            if (parsed.version === 1 && Array.isArray(parsed.seenEvents) && Array.isArray(parsed.warnedCredits))
                previous = parsed;
        }
        catch { /* First notification check. */ }
        const planned = planResetNotifications(history, result, previous, options, now);
        // Claim notices before rendering so another window cannot display them again.
        await (0, fsUtils_1.writeJsonAtomic)(file, planned.state);
        return planned.notices;
    });
}
//# sourceMappingURL=resetNotifications.js.map