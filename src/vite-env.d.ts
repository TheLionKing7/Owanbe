/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_ORIGIN?: string;
  readonly AUTH0_DOMAIN?: string;
  readonly AUTH0_CLIENT_ID?: string;
  readonly AUTH0_AUDIENCE?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLIC_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
