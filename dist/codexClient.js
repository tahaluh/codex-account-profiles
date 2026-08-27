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
exports.readRateLimits = readRateLimits;
exports.readIdentity = readIdentity;
exports.extractLimitBuckets = extractLimitBuckets;
exports.limitBucketLabel = limitBucketLabel;
exports.extractWindows = extractWindows;
exports.bucketRemainingPercent = bucketRemainingPercent;
exports.bestLimitBucket = bestLimitBucket;
exports.remainingPercent = remainingPercent;
exports.resetLabel = resetLabel;
const node_child_process_1 = require("node:child_process");
const readline = __importStar(require("node:readline"));
function readReply(child, id) {
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
            }
            catch {
                // The server may write non-JSON diagnostics to stdout.
            }
        });
        child.once("error", (error) => {
            clearTimeout(timer);
            rl.close();
            reject(error);
        });
        child.once("exit", (code) => {
            if (code !== 0)
                reject(new Error(`Codex app-server exited with code ${code ?? "unknown"}`));
        });
    });
}
async function readRateLimits(profile) {
    const child = (0, node_child_process_1.spawn)("codex", ["app-server"], {
        env: { ...process.env, CODEX_HOME: profile.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
    });
    try {
        child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {
                clientInfo: { name: "codex-account-profiles", title: "Codex Account Profiles", version: "0.1.0" },
            } }) + "\n");
        const initialized = await readReply(child, 1);
        if (initialized.error)
            throw new Error(initialized.error.message ?? "Codex initialization failed");
        child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
        child.stdin.write(JSON.stringify({ id: 2, method: "account/rateLimits/read" }) + "\n");
        const response = await readReply(child, 2);
        if (response.error)
            throw new Error(response.error.message ?? "Unable to read rate limits");
        return response.result ?? {};
    }
    finally {
        child.kill();
    }
}
async function readIdentity(profile) {
    const child = (0, node_child_process_1.spawn)("codex", ["app-server"], {
        env: { ...process.env, CODEX_HOME: profile.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
    });
    try {
        child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {
                clientInfo: { name: "codex-account-profiles", title: "Codex Account Profiles", version: "0.1.0" },
            } }) + "\n");
        const initialized = await readReply(child, 1);
        if (initialized.error)
            throw new Error(initialized.error.message ?? "Codex initialization failed");
        child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
        child.stdin.write(JSON.stringify({ id: 2, method: "account/read", params: {} }) + "\n");
        const response = await readReply(child, 2);
        if (response.error)
            throw new Error(response.error.message ?? "Unable to read Codex account");
        return response.result?.account ?? {};
    }
    finally {
        child.kill();
    }
}
function extractLimitBuckets(result) {
    const byLimitId = result.rateLimitsByLimitId;
    if (byLimitId && Object.keys(byLimitId).length) {
        return Object.entries(byLimitId).map(([limitId, limits]) => ({ limitId, ...limits }));
    }
    if (result.rateLimits)
        return [result.rateLimits];
    return [result];
}
function limitBucketLabel(bucket) {
    const parts = [bucket.limitName, bucket.planType, bucket.limitId].filter((value) => Boolean(value));
    return parts.length ? parts.join(" / ") : "account";
}
function extractWindows(result) {
    const limits = "rateLimitsByLimitId" in result || "rateLimits" in result
        ? bestLimitBucket(result)
        : result;
    return [limits.primary, limits.secondary].filter((window) => Boolean(window));
}
function bucketRemainingPercent(bucket) {
    const windows = [bucket.primary, bucket.secondary].filter((window) => Boolean(window));
    if (!windows.length)
        return 0;
    return Math.min(...windows.map((window) => Math.max(0, 100 - (window.usedPercent ?? 100))));
}
function bestLimitBucket(result) {
    const buckets = extractLimitBuckets(result);
    return buckets.sort((a, b) => bucketRemainingPercent(b) - bucketRemainingPercent(a))[0] ?? result;
}
function remainingPercent(result) {
    const buckets = extractLimitBuckets(result);
    if (!buckets.length)
        return 0;
    return Math.max(...buckets.map(bucketRemainingPercent));
}
function resetLabel(result) {
    const reset = extractWindows(result).map((window) => window.resetsAt).filter((value) => Boolean(value)).sort()[0];
    return reset ? new Date(reset * 1000).toLocaleString() : "unknown";
}
//# sourceMappingURL=codexClient.js.map