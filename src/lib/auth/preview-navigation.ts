import type { LoginOptions } from "./types";

export function standaloneAuthPath(options: LoginOptions = {}): string {
  const next = options.returnTo;
  const safe = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next : "/host";
  return `${options.signup ? "/sign-up" : "/sign-in"}?next=${encodeURIComponent(safe)}`;
}

/**
 * Leave the iframe before creating a PKCE transaction: it must start and finish in one
 * top-level browsing context, because Auth0 refuses to render inside frames.
 * Tries a top-level redirect first; if the frame may not navigate its parent, opens a new tab.
 */
export function openStandaloneAuth(options: LoginOptions = {}): boolean {
  if (window.self === window.top) return false;
  const url = new URL(standaloneAuthPath(options), window.location.origin).href;
  try {
    if (!window.top) throw new Error("no_top_window");
    window.top.location.href = url;
    return true;
  } catch {
    const opened = window.open(url, "_blank");
    if (!opened) throw new Error("auth_open_page_blocked");
    opened.opener = null;
    return true;
  }
}
