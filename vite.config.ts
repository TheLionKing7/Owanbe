/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Public, non-secret configuration exposed to the browser bundle. Each entry is an exact
// variable name (Vite matches by prefix), so secrets such as AUTH0_CLIENT_SECRET or
// SUPABASE_SERVICE_ROLE_KEY can never leak into client code. Read in src/config/env.ts.
const PUBLIC_ENV = [
  "VITE_",
  "APP_ORIGIN",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_AUDIENCE",
  "SUPABASE_URL",
  "SUPABASE_PUBLIC_KEY",
];
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), PUBLIC_ENV);
  if (mode === "production" && !env.APP_ORIGIN) {
    console.warn("[owanbe] APP_ORIGIN is not set; falling back to window.location.origin at runtime.");
  }

  return {
    plugins: [react()],
    envPrefix: PUBLIC_ENV,
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    server: { port: 8080, host: true },
    build: {
      target: "es2020",
      // Keep the initial download small for mid-range phones: React core in its own
      // long-cached chunk, everything route-specific split by React.lazy.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
          },
        },
      },
      chunkSizeWarningLimit: 250,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
