/**
 * The phone app's settings. Everything comes from the environment, and the app refuses to start
 * without it rather than half-working: a missing value is a mistake to fix on this machine, not
 * something to work around.
 */

export interface AppConfig {
  supabaseUrl: string;
  publishableKey: string;
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
}

const REQUIRED = {
  supabaseUrl: "EXPO_PUBLIC_SUPABASE_URL",
  publishableKey: "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  auth0Domain: "EXPO_PUBLIC_AUTH0_DOMAIN",
  auth0ClientId: "EXPO_PUBLIC_AUTH0_CLIENT_ID",
  auth0Audience: "EXPO_PUBLIC_AUTH0_AUDIENCE",
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function readConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const missing = Object.values(REQUIRED).filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing ${missing.join(", ")}. Copy .env.example to .env and fill it in on this machine.`,
    );
  }
  return {
    supabaseUrl: (env.EXPO_PUBLIC_SUPABASE_URL as string).replace(/\/+$/, ""),
    publishableKey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    auth0Domain: (env.EXPO_PUBLIC_AUTH0_DOMAIN as string).replace(/\/+$/, ""),
    auth0ClientId: env.EXPO_PUBLIC_AUTH0_CLIENT_ID as string,
    auth0Audience: env.EXPO_PUBLIC_AUTH0_AUDIENCE as string,
  };
}
