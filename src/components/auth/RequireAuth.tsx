import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "@/lib/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AuthNotice } from "./AuthNotice";

/** Grants access only after the server-side session gate (ensure_user) admitted the user. */
export function RequireAuth({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  const { status, login, retry, blockedReason } = useAuth();
  const location = useLocation();
  const redirected = useRef(false);

  useEffect(() => {
    if (status === "signedOut" && !redirected.current) {
      redirected.current = true;
      void login({ returnTo: location.pathname + location.search, signup });
    }
  }, [status, login, location.pathname, location.search, signup]);

  switch (status) {
    case "signedIn":
      return <>{children}</>;
    case "unconfigured":
      return (
        <AuthNotice title="Sign-in isn't available yet">
          This environment has no Auth0 or Supabase settings, so private areas stay locked. Add them to <code>.env.local</code> (see <code>docs/auth0-setup.md</code>).
        </AuthNotice>
      );
    case "blocked":
      return (
        <AuthNotice title="Your account is not active">
          This account is {blockedReason ?? "unavailable"}. Contact Ówàńbè support if you think this is a mistake.
        </AuthNotice>
      );
    case "error":
      return (
        <AuthNotice title="We couldn't sign you in" action={<button type="button" onClick={retry} className="btn-primary h-12 px-6">Try again</button>}>
          Something went wrong while checking your session.
        </AuthNotice>
      );
    default:
      return (
        <div role="status" aria-live="polite" className="grid min-h-[50vh] place-items-center text-sm text-ink-muted">
          {status === "signedOut" ? "Redirecting to sign in…" : "Checking your session…"}
        </div>
      );
  }
}
