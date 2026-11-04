/**
 * Server-only. Lovable reserves the SUPABASE_ secret prefix, so the external project's
 * service role key is stored as EXTERNAL_SUPABASE_SERVICE_ROLE_KEY. Read inside handlers only.
 */
export function supabaseServiceRoleKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env["EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"]?.trim() || env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() || undefined;
}

export function supabaseServerUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env["SUPABASE_URL"]?.trim() || env["VITE_SUPABASE_URL"]?.trim() || undefined;
}
