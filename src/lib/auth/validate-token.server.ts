/**
 * F-78 validateToken: verifies an Auth0 access token (signature via JWKS, issuer, audience,
 * expiry) and maps its subject to exactly one active application user.
 * Server-only. The user lookup uses SUPABASE_SERVICE_ROLE_KEY and runs only after the
 * token has been verified.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface ValidatedSession {
  sub: string;
  userId: string;
  status: "active";
}

export class TokenError extends Error {
  constructor(public readonly code: "missing" | "invalid" | "not_configured" | "unknown_user" | "inactive") {
    super(code);
  }
}

export interface ValidateDeps {
  domain: string;
  audience: string;
  /** Injected in tests; defaults to the tenant's JWKS. */
  keys?: JWTVerifyGetKey | CryptoKey | Uint8Array;
  /** Looks up the app user for a verified subject. */
  findUser: (sub: string) => Promise<{ id: string; status: string } | null>;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export async function validateToken(token: string | null | undefined, deps: ValidateDeps): Promise<ValidatedSession> {
  if (!token) throw new TokenError("missing");
  const domain = deps.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain || !deps.audience) throw new TokenError("not_configured");
  const issuer = `https://${domain}/`;
  let keys = deps.keys;
  if (!keys) {
    let cached = jwksCache.get(issuer);
    if (!cached) {
      cached = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
      jwksCache.set(issuer, cached);
    }
    keys = cached;
  }

  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, keys as JWTVerifyGetKey, {
      issuer,
      audience: deps.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"],
    });
    sub = payload.sub;
  } catch {
    throw new TokenError("invalid");
  }
  if (!sub || sub.length < 3) throw new TokenError("invalid");

  const user = await deps.findUser(sub);
  if (!user) throw new TokenError("unknown_user");
  if (user.status !== "active") throw new TokenError("inactive");
  return { sub, userId: user.id, status: "active" };
}

/** Production wiring: env + service-role lookup of public.users by auth0_sub. */
export async function validateRequestToken(authorization: string | null): Promise<ValidatedSession> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const domain = process.env["AUTH0_DOMAIN"] ?? "";
  const audience = process.env["AUTH0_AUDIENCE"] ?? "";
  return validateToken(token, {
    domain,
    audience,
    async findUser(sub) {
      const url = process.env["SUPABASE_URL"];
      const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
      if (!url || !serviceKey) throw new TokenError("not_configured");
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await admin.from("users").select("id, status").eq("auth0_sub", sub).maybeSingle();
      if (error) throw new TokenError("invalid");
      return data;
    },
  });
}
