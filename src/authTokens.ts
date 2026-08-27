import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AccountProfile } from "./accountStore";
import { writeJsonAtomic } from "./fsUtils";

const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_SKEW_SECONDS = 5 * 60;

interface AuthJson {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  [key: string]: unknown;
}

export interface TokenRefreshResult {
  checked: boolean;
  refreshed: boolean;
  error?: string;
}

export async function refreshAccountTokensIfNeeded(account: AccountProfile, force = false): Promise<TokenRefreshResult> {
  const authPath = path.join(account.codexHome, "auth.json");
  let auth: AuthJson;
  try {
    auth = JSON.parse(await fs.readFile(authPath, "utf8")) as AuthJson;
  } catch (error) {
    return { checked: false, refreshed: false, error: String(error) };
  }
  const accessToken = auth.tokens?.access_token;
  const refreshToken = auth.tokens?.refresh_token;
  if (!accessToken || !refreshToken) return { checked: true, refreshed: false };
  if (!force && !isJwtExpired(accessToken, REFRESH_SKEW_SECONDS)) return { checked: true, refreshed: false };

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
    await writeJsonAtomic(authPath, auth);
    return { checked: true, refreshed: true };
  } catch (error) {
    return { checked: true, refreshed: false, error: String(error) };
  }
}

async function refreshTokens(refreshToken: string, currentIdToken?: string): Promise<{ idToken: string; accessToken: string; refreshToken: string; accountId?: string }> {
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
  if (!response.ok) throw new Error(`Token refresh failed (${response.status}): ${raw.slice(0, 300)}`);
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const accessToken = readString(payload, "access_token");
  const idToken = readOptionalString(payload, "id_token") ?? currentIdToken;
  if (!idToken) throw new Error("Token refresh response did not include id_token.");
  return {
    idToken,
    accessToken,
    refreshToken: readOptionalString(payload, "refresh_token") ?? refreshToken,
    accountId: readOptionalString(payload, "account_id"),
  };
}

export function isJwtExpired(token: string, skewSeconds = 0, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp <= nowSeconds + skewSeconds;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Token refresh response missing ${key}.`);
  return value;
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
