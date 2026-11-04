import type { ErrorEvent } from "@sentry/react";

/** Strict allowlist: never transmit arbitrary exception messages or application data. */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: "javascript",
    level: "error",
    environment: event.environment,
    release: event.release,
    exception: {
      values: (event.exception?.values ?? []).map((exception) => ({
        type: "ApplicationError",
        value: "Redacted application error",
        stacktrace: {
          frames: (exception.stacktrace?.frames ?? []).map((frame) => ({
            filename: safeScriptUrl(frame.filename),
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        },
      })),
    },
  };
}

function safeScriptUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (!url.pathname.endsWith('.js') && !url.pathname.endsWith('.tsx') && !url.pathname.endsWith('.ts')) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function monitoringEnvironment(value: string | undefined): "development" | "staging" | "production" {
  return value === "production" || value === "staging" ? value : "development";
}