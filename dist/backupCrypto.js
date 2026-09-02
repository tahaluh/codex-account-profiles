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
exports.isEncryptedBackup = isEncryptedBackup;
exports.encryptBackup = encryptBackup;
exports.decryptBackup = decryptBackup;
const crypto = __importStar(require("node:crypto"));
const MAX_CIPHERTEXT_BYTES = 50 * 1024 * 1024;
function isEncryptedBackup(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const record = value;
    return record.version === 2 && record.encrypted === true;
}
async function encryptBackup(value, password) {
    assertPassword(password);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await deriveKey(password, salt);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
        version: 2,
        encrypted: true,
        cipher: "aes-256-gcm",
        kdf: "scrypt",
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    };
}
async function decryptBackup(value, password) {
    assertPassword(password);
    const backup = parseEncryptedBackup(value);
    const salt = decodeBase64(backup.salt, "salt", 16);
    const iv = decodeBase64(backup.iv, "iv", 12);
    const authTag = decodeBase64(backup.authTag, "authTag", 16);
    const ciphertext = decodeBase64(backup.ciphertext, "ciphertext", undefined, MAX_CIPHERTEXT_BYTES);
    try {
        const key = await deriveKey(password, salt);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString("utf8"));
    }
    catch {
        throw new Error("Could not decrypt the backup. Check the password and file integrity.");
    }
}
function parseEncryptedBackup(value) {
    if (!isEncryptedBackup(value))
        throw new Error("Unsupported encrypted backup format.");
    if (value.cipher !== "aes-256-gcm" || value.kdf !== "scrypt")
        throw new Error("Unsupported encrypted backup algorithm.");
    for (const key of ["salt", "iv", "authTag", "ciphertext"]) {
        if (typeof value[key] !== "string" || !value[key])
            throw new Error(`Invalid encrypted backup ${key}.`);
    }
    return value;
}
function decodeBase64(value, label, exactBytes, maximumBytes) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        throw new Error(`Invalid encrypted backup ${label}.`);
    const decoded = Buffer.from(value, "base64");
    if (exactBytes !== undefined && decoded.length !== exactBytes)
        throw new Error(`Invalid encrypted backup ${label}.`);
    if (maximumBytes !== undefined && decoded.length > maximumBytes)
        throw new Error("The encrypted backup is too large.");
    return decoded;
}
async function deriveKey(password, salt) {
    return await new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
            if (error)
                reject(error);
            else
                resolve(key);
        });
    });
}
function assertPassword(password) {
    if (typeof password !== "string" || password.length < 10)
        throw new Error("Backup passwords must contain at least 10 characters.");
}
//# sourceMappingURL=backupCrypto.js.map