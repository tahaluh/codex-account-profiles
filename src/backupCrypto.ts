import * as crypto from "node:crypto";
const MAX_CIPHERTEXT_BYTES = 50 * 1024 * 1024;

export interface EncryptedBackupFile {
  version: 2;
  encrypted: true;
  cipher: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function isEncryptedBackup(value: unknown): value is EncryptedBackupFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 2 && record.encrypted === true;
}

export async function encryptBackup(value: unknown, password: string): Promise<EncryptedBackupFile> {
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

export async function decryptBackup(value: unknown, password: string): Promise<unknown> {
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
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    throw new Error("Could not decrypt the backup. Check the password and file integrity.");
  }
}

function parseEncryptedBackup(value: unknown): EncryptedBackupFile {
  if (!isEncryptedBackup(value)) throw new Error("Unsupported encrypted backup format.");
  if (value.cipher !== "aes-256-gcm" || value.kdf !== "scrypt") throw new Error("Unsupported encrypted backup algorithm.");
  for (const key of ["salt", "iv", "authTag", "ciphertext"] as const) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`Invalid encrypted backup ${key}.`);
  }
  return value;
}

function decodeBase64(value: string, label: string, exactBytes?: number, maximumBytes?: number): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`Invalid encrypted backup ${label}.`);
  const decoded = Buffer.from(value, "base64");
  if (exactBytes !== undefined && decoded.length !== exactBytes) throw new Error(`Invalid encrypted backup ${label}.`);
  if (maximumBytes !== undefined && decoded.length > maximumBytes) throw new Error("The encrypted backup is too large.");
  return decoded;
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 10) throw new Error("Backup passwords must contain at least 10 characters.");
}
