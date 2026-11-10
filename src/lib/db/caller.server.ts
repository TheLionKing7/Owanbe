/**
 * The one way the app asks the database something as the caller.
 *
 * The caller's own token is forwarded to PostgREST, so the database decides what they may read
 * and write. A secret key is refused here: it would answer as the server rather than as the
 * person, and a route that acts as the server is a route that can be walked around.
 */

/** The caller's token, when the request carries one that could be a JWT. */
export function callerToken(request: Request): string | null {
  return bearerToken(request.headers.get("authorization"));
}

/** The token in an authorization header, when it is shaped like a JWT. */
export function bearerToken(header: string | null): string | null {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.split(".").length === 3 ? token : null;
}

/** The publishable key only: a secret key would answer as the server, not as the caller. */
export function callerCredentials(): { url: string; key: string } | null {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** Calls one database function as the caller. The database, not this app, decides the outcome. */
export async function callAsCaller(
  rpc: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const credentials = callerCredentials();
  if (!credentials) throw new Error("unconfigured");
  return fetch(`${credentials.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
