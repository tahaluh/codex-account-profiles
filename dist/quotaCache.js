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
exports.readSharedQuotaCache = readSharedQuotaCache;
exports.writeSharedQuotaCache = writeSharedQuotaCache;
const crypto = __importStar(require("node:crypto"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const fsUtils_1 = require("./fsUtils");
const CACHE_VERSION = 1;
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function cacheFilePath() {
    return path.join(os.tmpdir(), "codex-account-profiles", "quota-cache-v1.json");
}
function accountCacheKey(account) {
    return crypto.createHash("sha1").update(`${account.id}|${account.codexHome}`).digest("hex");
}
function emptyCache() {
    return { version: CACHE_VERSION, entries: {} };
}
async function readCache() {
    try {
        const parsed = JSON.parse(await node_fs_1.promises.readFile(cacheFilePath(), "utf8"));
        if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object")
            return emptyCache();
        const now = Date.now();
        parsed.entries = Object.fromEntries(Object.entries(parsed.entries).filter(([, entry]) => now - entry.checkedAt <= CACHE_RETENTION_MS));
        return parsed;
    }
    catch {
        return emptyCache();
    }
}
async function readSharedQuotaCache(account, ttlMs) {
    const entry = (await readCache()).entries[accountCacheKey(account)];
    if (!entry || Date.now() - entry.checkedAt > ttlMs)
        return undefined;
    return { result: entry.result, checkedAt: entry.checkedAt };
}
async function writeSharedQuotaCache(account, result) {
    const cache = await readCache();
    const key = accountCacheKey(account);
    cache.entries[key] = {
        version: CACHE_VERSION,
        accountKey: key,
        accountName: account.name,
        checkedAt: Date.now(),
        result,
    };
    await (0, fsUtils_1.writeJsonAtomic)(cacheFilePath(), cache);
}
//# sourceMappingURL=quotaCache.js.map