/**
 * F-79 server configuration. Read inside handlers only (never at module scope).
 * Each deployment environment (dev, staging, prod) supplies its own values.
 */
export const REQUIRED_SERVER_ENV = [
  "APP_ENV",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "EXTERNAL_SUPABASE_SERVICE_ROLE_KEY",
  "AUTH0_DOMAIN",
  "AUTH0_AUDIENCE",
  "SENTRY_DSN",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PUBLIC_KEY",
] as const;

export type AppEnv = "development" | "staging" | "production";

export function missingServerEnv(env: Record<string, string | undefined> = process.env): string[] {
  return REQUIRED_SERVER_ENV.filter((k) => !env[k]?.trim());
}

/** Guards against cross-environment credential mix-ups (e.g. live Paystack key in staging). */
export function checkEnvIsolation(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const appEnv = env["APP_ENV"] as AppEnv | undefined;
  if (!appEnv || !["development", "staging", "production"].includes(appEnv)) problems.push("APP_ENV must be development, staging or production");
  const secret = env["PAYSTACK_SECRET_KEY"] ?? "";
  const pub = env["PAYSTACK_PUBLIC_KEY"] ?? "";
  if (appEnv === "production") {
    if (secret && !secret.startsWith("sk_live_")) problems.push("production must use a live Paystack secret key");
    if (pub && !pub.startsWith("pk_live_")) problems.push("production must use a live Paystack public key");
  } else if (appEnv) {
    if (secret.startsWith("sk_live_")) problems.push(`${appEnv} must not use a live Paystack secret key`);
    if (pub.startsWith("pk_live_")) problems.push(`${appEnv} must not use a live Paystack public key`);
  }
  return problems;
}
