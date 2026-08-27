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
exports.refreshAccountTokensIfNeeded = refreshAccountTokensIfNeeded;
exports.isJwtExpired = isJwtExpired;
exports.decodeJwtPayload = decodeJwtPayload;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const fsUtils_1 = require("./fsUtils");
const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_SKEW_SECONDS = 5 * 60;
async function refreshAccountTokensIfNeeded(account, force = false) {
    const authPath = path.join(account.codexHome, "auth.json");
    let auth;
    try {
        auth = JSON.parse(await node_fs_1.promises.readFile(authPath, "utf8"));
    }
    catch (error) {
        return { checked: false, refreshed: false, error: String(error) };
    }
    const accessToken = auth.tokens?.access_token;
    const refreshToken = auth.tokens?.refresh_token;
    if (!accessToken || !refreshToken)
        return { checked: true, refreshed: false };
    if (!force && !isJwtExpired(accessToken, REFRESH_SKEW_SECONDS))
        return { checked: true, refreshed: false };
    try {
        const refreshed = await refreshTokens(refreshToken, auth.tokens?.id_token);
        auth.tokens = {
            ...auth.tokens,
            id_token: refreshed.idToken,
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            account_id: refreshed.accountId ?? auth.tokens?.account_id,
        };
        auth.last_refresh = new Date().toISOString();
        await (0, fsUtils_1.writeJsonAtomic)(authPath, auth);
        return { checked: true, refreshed: true };
    }
    catch (error) {
        return { checked: true, refreshed: false, error: String(error) };
    }
}
async function refreshTokens(refreshToken, currentIdToken) {
    const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: OAUTH_CLIENT_ID,
        }),
    });
    const raw = await response.text();
    if (!response.ok)
        throw new Error(`Token refresh failed (${response.status}): ${raw.slice(0, 300)}`);
    const payload = JSON.parse(raw);
    const accessToken = readString(payload, "access_token");
    const idToken = readOptionalString(payload, "id_token") ?? currentIdToken;
    if (!idToken)
        throw new Error("Token refresh response did not include id_token.");
    return {
        idToken,
        accessToken,
        refreshToken: readOptionalString(payload, "refresh_token") ?? refreshToken,
        accountId: readOptionalString(payload, "account_id"),
    };
}
function isJwtExpired(token, skewSeconds = 0, nowSeconds = Math.floor(Date.now() / 1000)) {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== "number")
        return true;
    return payload.exp <= nowSeconds + skewSeconds;
}
function decodeJwtPayload(token) {
    const part = token.split(".")[1];
    if (!part)
        return undefined;
    try {
        const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
        return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    }
    catch {
        return undefined;
    }
}
function readString(payload, key) {
    const value = payload[key];
    if (typeof value !== "string" || !value.trim())
        throw new Error(`Token refresh response missing ${key}.`);
    return value;
}
function readOptionalString(payload, key) {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value : undefined;
}
//# sourceMappingURL=authTokens.js.map