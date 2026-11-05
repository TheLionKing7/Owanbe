import type { AuthEnv } from "./env";

/** Deliberate allowlist: never project an environment object into browser data. */
export function publicAuthConfig(values: Record<string, string | undefined>): AuthEnv | null {
  const read = (name: string) => values[name]?.trim() || undefined;
  const domain = read("AUTH0_DOMAIN")?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const clientId = read("AUTH0_CLIENT_ID");
  const audience = read("AUTH0_AUDIENCE");
  // External settings must win over any Lovable-managed database settings.
  const supabaseUrl = read("EXTERNAL_SUPABASE_URL") ?? read("SUPABASE_URL");
  const supabasePublicKey = read("EXTERNAL_SUPABASE_PUBLISHABLE_KEY")
    ?? read("EXTERNAL_SUPABASE_ANON_KEY")
    ?? read("EXTERNAL_SUPABASE_PUBLIC_KEY")
    ?? read("SUPABASE_PUBLISHABLE_KEY")
    ?? read("SUPABASE_PUBLIC_KEY")
    ?? read("SUPABASE_ANON_KEY");
  if (!domain || !clientId || !audience || !supabaseUrl || !supabasePublicKey) return null;
  // Opaque private keys cannot ever be used as a browser credential.
  if (supabasePublicKey.startsWith("sb_secret_")) return null;
  if (supabasePublicKey.split(".").length === 3) {
    try {
      const payload = supabasePublicKey.split(".")[1];
      if (!payload) return null;
      const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      if (claims.role !== "anon") return null;
    } catch {
      return null;
    }
  }
  return { domain, clientId, audience, supabaseUrl, supabasePublicKey };
}