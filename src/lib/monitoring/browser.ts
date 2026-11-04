import { sanitizeSentryEvent } from "./privacy";
import { getMonitoringConfig } from "./config.functions";

let initialization: Promise<boolean> | undefined;
export function initializeMonitoring(): Promise<boolean> {
  initialization ??= (async () => {
    try {
      const config = await getMonitoringConfig();
      if (!config.dsn) return false;
      const sentry = await import("@sentry/react");
      sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        sendDefaultPii: false,
        defaultIntegrations: false,
        integrations: [sentry.globalHandlersIntegration(), sentry.dedupeIntegration()],
        beforeBreadcrumb: () => null,
        beforeSend: sanitizeSentryEvent,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      });
      return true;
    } catch {
      // Monitoring must not break the page; no raw configuration/error logs.
      return false;
    }
  })();
  return initialization;
}

export async function captureApplicationError(error: unknown): Promise<void> {
  if (!(await initializeMonitoring())) return;
  const sentry = await import("@sentry/react");
  sentry.captureException(error);
}