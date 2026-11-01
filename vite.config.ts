/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// APP_ORIGIN is the canonical public origin of the web app (e.g. https://owanbe.app).
// It is exposed to client code through envPrefix and read in src/config/env.ts.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "APP_"]);
  if (mode === "production" && !env.APP_ORIGIN) {
    console.warn("[owanbe] APP_ORIGIN is not set; falling back to window.location.origin at runtime.");
  }

  return {
    plugins: [react()],
    envPrefix: ["VITE_", "APP_"],
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
