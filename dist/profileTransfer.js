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
exports.usableAuth = usableAuth;
exports.credentialFingerprint = credentialFingerprint;
exports.classifyImportFailure = classifyImportFailure;
exports.importProfileEntries = importProfileEntries;
exports.collectExportEntries = collectExportEntries;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const fsUtils_1 = require("./fsUtils");
function usableAuth(auth) {
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim())
        return true;
    const tokens = auth.tokens;
    return Boolean(tokens && typeof tokens.access_token === "string" && tokens.access_token.trim());
}
function credentialFingerprint(auth) {
    const tokens = auth.tokens;
    let subject;
    if (typeof tokens?.id_token === "string") {
        try {
            subject = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")).sub;
        }
        catch { }
    }
    const identity = typeof tokens?.account_id === "string" && typeof subject === "string"
        ? `chatgpt:${tokens.account_id}:${subject}` : typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY
        ? `key:${auth.OPENAI_API_KEY}` : `token:${tokens?.refresh_token || tokens?.access_token || JSON.stringify(auth)}`;
    return (0, node_crypto_1.createHash)("sha256").update(identity).digest("hex");
}
function classifyImportFailure(error) {
    const message = String(error);
    if (/ENOENT|not found on PATH|entrypoint.*missing|spawn.*EINVAL/i.test(message))
        return { status: "unverified", reason: "Codex CLI is missing or cannot start. Install @openai/codex on this computer and reload VS Code." };
    if (/401|403|unauthorized|unauthenticated|refresh.token|token.*(?:expired|revoked|invalid|reused)|login required|not logged|sign.?in|authentication required/i.test(message)) {
        return { status: "needsLogin", reason: "The transferred login could not be validated. Re-authenticate this profile on this computer." };
    }
    return { status: "unverified", reason: "Codex could not verify account access. Check connectivity, then Refresh or Re-authenticate." };
}
// Backup paths, account IDs and workspace settings are never restored onto the
// destination. Existing credentials are never overwritten by an older backup.
async function importProfileEntries(backup, root, existing, save, verify) {
    const report = { imported: [], duplicates: 0, invalid: 0, failed: 0 };
    const fingerprints = new Set();
    for (const account of existing) {
        try {
            fingerprints.add(credentialFingerprint(JSON.parse(await node_fs_1.promises.readFile(path.join(account.codexHome, "auth.json"), "utf8"))));
        }
        catch { }
    }
    let accounts = [...existing];
    for (const entry of [...backup.accounts].sort((a, b) => a.priority - b.priority)) {
        if (!usableAuth(entry.authJson)) {
            report.invalid++;
            continue;
        }
        const fingerprint = credentialFingerprint(entry.authJson);
        if (fingerprints.has(fingerprint)) {
            report.duplicates++;
            continue;
        }
        const id = (0, node_crypto_1.randomUUID)();
        const account = { id, name: entry.name, codexHome: path.join(root, "profiles", id), email: entry.email,
            planType: entry.planType, enabled: entry.enabled, priority: accounts.length };
        let committed = false;
        try {
            await node_fs_1.promises.mkdir(account.codexHome, { recursive: true, mode: 0o700 });
            await (0, fsUtils_1.writeJsonAtomic)(path.join(account.codexHome, "auth.json"), entry.authJson);
            let check;
            try {
                check = await verify(account);
            }
            catch (error) {
                check = classifyImportFailure(error);
            }
            account.email = check.email || entry.email;
            account.planType = check.planType || entry.planType;
            account.importStatus = check.status;
            account.importReason = check.reason;
            await save([...accounts, account]);
            committed = true;
            accounts = [...accounts, account];
            fingerprints.add(fingerprint);
            report.imported.push({ account, status: check.status, reason: check.reason });
        }
        catch {
            report.failed++;
        }
        finally {
            if (!committed)
                await node_fs_1.promises.rm(account.codexHome, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    return report;
}
async function collectExportEntries(accounts) {
    const entries = [], skipped = [];
    for (const account of accounts) {
        try {
            const auth = JSON.parse(await node_fs_1.promises.readFile(path.join(account.codexHome, "auth.json"), "utf8"));
            if (!usableAuth(auth))
                throw new Error("No file credentials");
            entries.push({ name: account.name, email: account.email, planType: account.planType, enabled: account.enabled, priority: account.priority, authJson: auth });
        }
        catch {
            skipped.push(account.name);
        }
    }
    return { entries, skipped };
}
//# sourceMappingURL=profileTransfer.js.map