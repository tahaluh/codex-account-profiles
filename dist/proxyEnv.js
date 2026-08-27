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
exports.loadCodexProxyEnvironment = loadCodexProxyEnvironment;
exports.readProxyEnvFile = readProxyEnvFile;
exports.parseProxyEnv = parseProxyEnv;
const path = __importStar(require("node:path"));
const node_fs_1 = require("node:fs");
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
async function loadCodexProxyEnvironment(codexHome) {
    const parsed = await readProxyEnvFile(path.join(codexHome, ".env"));
    const applied = {};
    for (const key of PROXY_KEYS) {
        const current = readEnv(process.env, key);
        const next = current ?? readEnv(parsed, key);
        if (next === undefined)
            continue;
        validateProxyValue(key, next);
        process.env[key] = next;
        applied[key] = next;
    }
    return applied;
}
async function readProxyEnvFile(filePath) {
    try {
        return parseProxyEnv(await node_fs_1.promises.readFile(filePath, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return {};
        throw error;
    }
}
function parseProxyEnv(content) {
    const parsed = {};
    for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?$/);
        if (!match)
            continue;
        const normalized = match[1].toUpperCase();
        if (!PROXY_KEYS.includes(normalized))
            continue;
        parsed[normalized] = parseEnvValue(match[2] ?? "");
    }
    return parsed;
}
function parseEnvValue(raw) {
    const value = raw.trim();
    if (value.startsWith("\""))
        return readQuoted(value, "\"").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"");
    if (value.startsWith("'"))
        return readQuoted(value, "'");
    return value.replace(/\s+#.*$/, "").trim();
}
function readQuoted(value, quote) {
    for (let index = 1; index < value.length; index += 1) {
        if (value[index] === quote && value[index - 1] !== "\\")
            return value.slice(1, index);
    }
    return value.slice(1);
}
function readEnv(env, key) {
    const lower = key.toLowerCase();
    const value = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : env[lower];
    const trimmed = value?.trim();
    return trimmed || undefined;
}
function validateProxyValue(key, value) {
    if (key === "NO_PROXY")
        return;
    let protocol;
    try {
        protocol = new URL(value).protocol;
    }
    catch {
        throw new Error(`${key} must be an absolute http:// or https:// URL.`);
    }
    if (protocol !== "http:" && protocol !== "https:") {
        throw new Error(`${key} uses unsupported protocol ${protocol}. Only http:// and https:// are supported.`);
    }
}
//# sourceMappingURL=proxyEnv.js.map