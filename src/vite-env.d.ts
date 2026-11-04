/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_ORIGIN?: string;
  readonly AUTH0_DOMAIN?: string;
  readonly AUTH0_CLIENT_ID?: string;
  readonly AUTH0_AUDIENCE?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLIC_KEY?: string;
  readonly VITE_APP_ORIGIN?: string;
  readonly VITE_AUTH0_DOMAIN?: string;
  readonly VITE_AUTH0_CLIENT_ID?: string;
  readonly VITE_AUTH0_AUDIENCE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLIC_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
