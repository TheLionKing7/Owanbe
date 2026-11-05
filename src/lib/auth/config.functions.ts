import { createServerFn } from "@tanstack/react-start";
import { publicAuthConfig } from "@/config/public-auth-config";

/** Public identifiers only. Service-role, Paystack and management secrets stay server-side. */
export const getPublicClientConfig = createServerFn({ method: "GET" }).handler(() =>
  publicAuthConfig({
    AUTH0_DOMAIN: process.env["AUTH0_DOMAIN"],
    AUTH0_CLIENT_ID: process.env["AUTH0_CLIENT_ID"],
    AUTH0_AUDIENCE: process.env["AUTH0_AUDIENCE"],
    EXTERNAL_SUPABASE_URL: process.env["EXTERNAL_SUPABASE_URL"],
    EXTERNAL_SUPABASE_PUBLISHABLE_KEY: process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"],
    EXTERNAL_SUPABASE_ANON_KEY: process.env["EXTERNAL_SUPABASE_ANON_KEY"],
    EXTERNAL_SUPABASE_PUBLIC_KEY: process.env["EXTERNAL_SUPABASE_PUBLIC_KEY"],
    SUPABASE_URL: process.env["SUPABASE_URL"],
    SUPABASE_PUBLISHABLE_KEY: process.env["SUPABASE_PUBLISHABLE_KEY"],
    SUPABASE_PUBLIC_KEY: process.env["SUPABASE_PUBLIC_KEY"],
    SUPABASE_ANON_KEY: process.env["SUPABASE_ANON_KEY"],
  }),
);