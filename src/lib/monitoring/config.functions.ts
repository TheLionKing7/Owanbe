import { createServerFn } from "@tanstack/react-start";
import { monitoringEnvironment } from "./privacy";

/** DSN is a public ingestion identifier, not a Sentry management token. */
export const getMonitoringConfig = createServerFn({ method: "GET" }).handler(() => ({
  dsn: process.env["SENTRY_DSN"] ?? null,
  environment: monitoringEnvironment(process.env["APP_ENV"]),
}));