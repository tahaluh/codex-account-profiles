import * as path from "node:path";
import { promises as fs } from "node:fs";

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const;

export type ProxyKey = typeof PROXY_KEYS[number];

export async function loadCodexProxyEnvironment(codexHome: string): Promise<Record<string, string>> {
  const parsed = await readProxyEnvFile(path.join(codexHome, ".env"));
  const applied: Record<string, string> = {};
  for (const key of PROXY_KEYS) {
    const current = readEnv(process.env, key);
    const next = current ?? readEnv(parsed, key);
    if (next === undefined) continue;
    validateProxyValue(key, next);
    process.env[key] = next;
    applied[key] = next;
  }
  return applied;
}

export async function readProxyEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    return parseProxyEnv(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function parseProxyEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?$/);
    if (!match) continue;
    const normalized = match[1]!.toUpperCase();
    if (!PROXY_KEYS.includes(normalized as ProxyKey)) continue;
    parsed[normalized] = parseEnvValue(match[2] ?? "");
  }
  return parsed;
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("\"")) return readQuoted(value, "\"").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"");
  if (value.startsWith("'")) return readQuoted(value, "'");
  return value.replace(/\s+#.*$/, "").trim();
}

function readQuoted(value: string, quote: string): string {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === quote && value[index - 1] !== "\\") return value.slice(1, index);
  }
  return value.slice(1);
}

function readEnv(env: NodeJS.ProcessEnv | Record<string, string>, key: ProxyKey): string | undefined {
  const lower = key.toLowerCase();
  const value = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : env[lower];
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function validateProxyValue(key: ProxyKey, value: string): void {
  if (key === "NO_PROXY") return;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error(`${key} must be an absolute http:// or https:// URL.`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${key} uses unsupported protocol ${protocol}. Only http:// and https:// are supported.`);
  }
}
