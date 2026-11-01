/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_ORIGIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
