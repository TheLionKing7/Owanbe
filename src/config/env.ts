/** Runtime configuration. APP_ORIGIN is exposed by Vite via envPrefix (see vite.config.ts). */
function resolveAppOrigin(): string {
  const configured = import.meta.env.APP_ORIGIN as string | undefined;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8080";
}

export const APP_ORIGIN = resolveAppOrigin();

/** Absolute URL on the app origin, for canonical links, share links and auth redirects. */
export function absoluteUrl(path = "/"): string {
  return `${APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
