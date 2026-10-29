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
exports.emptyHistory = void 0;
exports.quotaWindows = quotaWindows;
exports.nextResetAt = nextResetAt;
exports.observeQuota = observeQuota;
exports.readResetHistory = readResetHistory;
exports.withAccountResetLock = withAccountResetLock;
exports.recordQuotaObservation = recordQuotaObservation;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const codexClient_1 = require("./codexClient");
const fsUtils_1 = require("./fsUtils");
const emptyHistory = () => ({ version: 1, checkedAt: 0, windows: [], events: [] });
exports.emptyHistory = emptyHistory;
function quotaWindows(result) {
    return (0, codexClient_1.extractLimitBuckets)(result).flatMap((bucket) => ["primary", "secondary"].flatMap((slot) => {
        const window = bucket[slot];
        if (!window)
            return [];
        const duration = window.windowDurationMins;
        const name = duration === 300 ? "5h" : duration === 10080 ? "Weekly" : duration ? `${duration}m` : slot;
        return [{ ...window, key: `${bucket.limitId || "default"}:${slot}:${duration || 0}`, label: `${(0, codexClient_1.limitBucketLabel)(bucket)} · ${name}` }];
    }));
}
function nextResetAt(result, now = Date.now()) {
    const dates = result ? quotaWindows(result).map(window => window.resetsAt).filter((date) => typeof date === "number" && Number.isFinite(date) && date * 1000 > now && date < 8640000000000) : [];
    return dates.length ? Math.min(...dates) : undefined;
}
function observeQuota(previous, result, checkedAt = Date.now()) {
    if (checkedAt <= previous.checkedAt)
        return previous;
    const windows = quotaWindows(result);
    const events = [...previous.events];
    for (const current of windows) {
        const old = previous.windows.find(window => window.key === current.key);
        const before = old?.usedPercent, after = current.usedPercent;
        // A first sample or a timer crossing alone cannot establish a historical reset.
        // Require restored quota plus a changed/elapsed window boundary.
        const validUsage = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
        const boundaryChanged = old?.resetsAt && current.resetsAt && current.resetsAt > old.resetsAt;
        if (old && validUsage(before) && validUsage(after) && before - after >= 1 && boundaryChanged) {
            const id = `${current.key}:${old.resetsAt}:${current.resetsAt}`;
            if (!events.some(event => event.id === id))
                events.push({ id, kind: "quotaRenewed", observedAt: checkedAt,
                    since: previous.checkedAt, window: current.label, beforeUsed: before, afterUsed: after });
        }
    }
    return { version: 1, checkedAt, windows, events: events.sort((a, b) => b.observedAt - a.observedAt).slice(0, 50) };
}
async function readResetHistory(account) {
    try {
        const value = JSON.parse(await node_fs_1.promises.readFile(path.join(account.codexHome, "profile-reset-history.json"), "utf8"));
        return value.version === 1 && Array.isArray(value.windows) && Array.isArray(value.events) ? value : (0, exports.emptyHistory)();
    }
    catch {
        return (0, exports.emptyHistory)();
    }
}
// Account-specific locks avoid lost history when several VS Code windows poll at once.
async function withAccountResetLock(account, action) {
    await node_fs_1.promises.mkdir(account.codexHome, { recursive: true, mode: 0o700 });
    const lock = path.join(account.codexHome, ".profile-reset-history.lock");
    const deadline = Date.now() + 3000;
    while (true) {
        try {
            const fd = await node_fs_1.promises.open(lock, "wx", 0o600);
            try {
                await fd.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
            }
            catch (error) {
                await node_fs_1.promises.unlink(lock).catch(() => undefined);
                throw error;
            }
            finally {
                await fd.close();
            }
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            try {
                const owner = JSON.parse(await node_fs_1.promises.readFile(lock, "utf8"));
                if (Number.isInteger(owner.pid) && owner.pid > 0) {
                    try {
                        process.kill(owner.pid, 0);
                    }
                    catch (probe) {
                        if (probe.code === "ESRCH") {
                            await node_fs_1.promises.unlink(lock).catch(() => undefined);
                            continue;
                        }
                    }
                }
            }
            catch { /* Another writer may still be creating its lock. */ }
            if (Date.now() >= deadline)
                throw new Error("Reset history is busy in another window. Retry shortly.");
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    try {
        return await action();
    }
    finally {
        await node_fs_1.promises.unlink(lock).catch(() => undefined);
    }
}
async function recordQuotaObservation(account, result, checkedAt = Date.now()) {
    return withAccountResetLock(account, async () => {
        const previous = await readResetHistory(account);
        const history = observeQuota(previous, result, checkedAt);
        if (history !== previous)
            await (0, fsUtils_1.writeJsonAtomic)(path.join(account.codexHome, "profile-reset-history.json"), history);
        return history;
    });
}
//# sourceMappingURL=resetTracker.js.map