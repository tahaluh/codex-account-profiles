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
exports.readPendingRedemption = readPendingRedemption;
exports.redeemAccountReset = redeemAccountReset;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const codexClient_1 = require("./codexClient");
const fsUtils_1 = require("./fsUtils");
const resetTracker_1 = require("./resetTracker");
async function readPendingRedemption(account) {
    try {
        const attempt = JSON.parse(await node_fs_1.promises.readFile(path.join(account.codexHome, "profile-reset-attempt.json"), "utf8"));
        return typeof attempt.idempotencyKey === "string" && !attempt.outcome ? attempt : undefined;
    }
    catch {
        return undefined;
    }
}
// A failed/uncertain network response retains its key on disk. Retrying that
// attempt must never spend a second credit, including after restarting VS Code.
async function redeemAccountReset(account, creditId, consume = codexClient_1.consumeResetCredit) {
    const result = await (0, resetTracker_1.withAccountResetLock)(account, async () => {
        const pending = await readPendingRedemption(account);
        if (pending && pending.creditId !== creditId)
            throw new Error("An unresolved reset attempt exists. Retry that attempt before selecting a different reset.");
        const attempt = pending || { idempotencyKey: (0, node_crypto_1.randomUUID)(), creditId, createdAt: Date.now() };
        const file = path.join(account.codexHome, "profile-reset-attempt.json");
        await (0, fsUtils_1.writeJsonAtomic)(file, attempt);
        const reply = await consume(account, attempt.idempotencyKey, attempt.creditId);
        if (!["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(reply.outcome))
            throw new Error("Codex returned an unknown reset outcome. Retry to check the same attempt.");
        if (["reset", "alreadyRedeemed"].includes(reply.outcome)) {
            const history = await (0, resetTracker_1.readResetHistory)(account);
            if (!history.events.some(event => event.id === attempt.idempotencyKey)) {
                history.events.unshift({ id: attempt.idempotencyKey, kind: "creditApplied", observedAt: Date.now() });
                history.events = history.events.slice(0, 50);
                await (0, fsUtils_1.writeJsonAtomic)(path.join(account.codexHome, "profile-reset-history.json"), history);
            }
        }
        await (0, fsUtils_1.writeJsonAtomic)(file, { ...attempt, outcome: reply.outcome });
        return { outcome: reply.outcome, attemptId: attempt.idempotencyKey };
    });
    return result;
}
//# sourceMappingURL=resetRedemption.js.map