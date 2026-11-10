import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "@/lib/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AuthNotice } from "./AuthNotice";
import { Button } from "@/components/ui/button";
import { standaloneAuthPath } from "@/lib/auth/preview-navigation";

/** Grants access only after the server-side session gate (ensure_user) admitted the user. */
export function RequireAuth({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  const { status, login, retry, blockedReason } = useAuth();
  const location = useLocation();
  const redirected = useRef(false);
  const [redirectError, setRedirectError] = useState(false);
  const [standaloneOpened, setStandaloneOpened] = useState(false);
  const options = { returnTo: location.pathname + location.search, signup };

  async function beginLogin() {
    setRedirectError(false);
    try {
      await login(options);
      setStandaloneOpened(true);
    } catch {
      setRedirectError(true);
    }
  }

  useEffect(() => {
    if (status === "signedOut" && !redirected.current) {
      redirected.current = true;
      void login({ returnTo: location.pathname + location.search, signup })
        .then(() => setStandaloneOpened(true))
        .catch(() => setRedirectError(true));
    }
  }, [status, login, location.pathname, location.search, signup]);

  if (status !== "signedIn" && (redirectError || standaloneOpened)) {
    return (
      <AuthNotice title={redirectError ? "Open sign-in to continue" : "Continue in the sign-in tab"} action={
        <Button asChild variant="outline" className="h-12 px-6">
          <a href={standaloneAuthPath(options)} target="_blank" rel="noopener noreferrer">Open sign-in</a>
        </Button>
      }>
        {redirectError ? "Your browser couldn't open sign-in. Try opening it in a new tab." : "Return here when you're finished, or continue using the new tab."}
        {redirectError && <Button onClick={() => void beginLogin()} variant="link">Try again</Button>}
      </AuthNotice>
    );
  }

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
        <AuthNotice title="We couldn't sign you in" action={<Button type="button" onClick={retry} className="h-12 px-6">Try again</Button>}>
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
