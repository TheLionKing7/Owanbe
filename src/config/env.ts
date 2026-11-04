/** Runtime configuration. Public values only; see PUBLIC_ENV in vite.config.ts. */
const read = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);

function resolveAppOrigin(): string {
  const configured = read((import.meta.env.VITE_APP_ORIGIN ?? import.meta.env.APP_ORIGIN));
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8080";
}

export const APP_ORIGIN = resolveAppOrigin();

/** Absolute URL on the app origin, for canonical links, share links and auth redirects. */
export function absoluteUrl(path = "/"): string {
  return `${APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface AuthEnv {
  domain: string;
  clientId: string;
  audience: string;
  supabaseUrl: string;
  supabasePublicKey: string;
}

/** Auth0 + Supabase settings, or null when any is missing (sign-in then fails closed). */
export function readAuthEnv(): AuthEnv | null {
  const domain = read((import.meta.env.VITE_AUTH0_DOMAIN ?? import.meta.env.AUTH0_DOMAIN))?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const clientId = read((import.meta.env.VITE_AUTH0_CLIENT_ID ?? import.meta.env.AUTH0_CLIENT_ID));
  const audience = read((import.meta.env.VITE_AUTH0_AUDIENCE ?? import.meta.env.AUTH0_AUDIENCE));
  const supabaseUrl = read((import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.SUPABASE_URL));
  const supabasePublicKey = read((import.meta.env.VITE_SUPABASE_PUBLIC_KEY ?? import.meta.env.SUPABASE_PUBLIC_KEY));
  if (!domain || !clientId || !audience || !supabaseUrl || !supabasePublicKey) return null;
  return { domain, clientId, audience, supabaseUrl, supabasePublicKey };
}
