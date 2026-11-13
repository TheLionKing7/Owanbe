/**
 * The door operator signs in with the same Auth0 account they use on the web. The phone app uses
 * the authorization code flow with PKCE: no client secret ever exists on the device, and the
 * tokens live in the device's locked drawer.
 */
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { readConfig } from "./config";
import { clearSecret, readSecret, writeSecret } from "./secure";

WebBrowser.maybeCompleteAuthSession();

const ACCESS_KEY = "owanbe.auth.access";
const REFRESH_KEY = "owanbe.auth.refresh";
const EXPIRES_KEY = "owanbe.auth.expires";

export interface Session {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function signIn(): Promise<Session> {
  const config = readConfig();
  const redirectUri = AuthSession.makeRedirectUri({ scheme: "owanbe" });
  const request = new AuthSession.AuthRequest({
    clientId: config.auth0ClientId,
    redirectUri,
    scopes: ["openid", "profile", "email"],
    usePKCE: true,
    extraParams: { audience: config.auth0Audience },
  });
  await AuthSession.promptAsync(request);
  const code = request.urlParams?.code;
  if (!code) throw new AuthError("sign_in_cancelled");
  const result = await AuthSession.exchangeCodeAsync({
    clientId: config.auth0ClientId,
    code,
    redirectUri,
    extraParams: { code_verifier: request.codeVerifier ?? "" },
  });
  if (!result.accessToken) throw new AuthError("no_access_token");
  const session: Session = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken ?? null,
    expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000,
  };
  await saveSession(session);
  return session;
}

export async function refreshSession(session: Session): Promise<Session> {
  if (!session.refreshToken) throw new AuthError("no_refresh_token");
  const config = readConfig();
  const body = [
    "grant_type=refresh_token",
    `client_id=${encodeURIComponent(config.auth0ClientId)}`,
    `refresh_token=${encodeURIComponent(session.refreshToken)}`,
  ].join("&");
  const response = await fetch(`https://${config.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new AuthError("token_refresh_failed");
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) throw new AuthError("no_access_token");
  const next: Session = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  await saveSession(next);
  return next;
}

/** The session this device already has, renewed if it has expired. */
export async function restoreSession(): Promise<Session | null> {
  const accessToken = await readSecret(ACCESS_KEY);
  if (!accessToken) return null;
  const refreshToken = await readSecret(REFRESH_KEY);
  const expiresAt = Number((await readSecret(EXPIRES_KEY)) ?? "0");
  const session: Session = { accessToken, refreshToken, expiresAt };
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!refreshToken) return null;
  try {
    return await refreshSession(session);
  } catch {
    return null;
  }
}

/** The token to use now: the one we have, or a fresh one if it has run out. */
export async function currentToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  await clearSecret(ACCESS_KEY);
  await clearSecret(REFRESH_KEY);
  await clearSecret(EXPIRES_KEY);
}

async function saveSession(session: Session): Promise<void> {
  await writeSecret(ACCESS_KEY, session.accessToken);
  if (session.refreshToken) await writeSecret(REFRESH_KEY, session.refreshToken);
  await writeSecret(EXPIRES_KEY, String(session.expiresAt));
}
