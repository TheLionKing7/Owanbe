import { useEffect } from "react";
import { useNavigate } from "@/lib/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";

/** Auth0 redirects here (APP_ORIGIN/auth/callback) with a one-time code. */
export default function AuthCallback() {
  const { completeLogin, status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    completeLogin(window.location.href).then((returnTo) => {
      if (active && returnTo) navigate(returnTo, { replace: true });
    });
    return () => {
      active = false;
    };
  }, [completeLogin, navigate]);

  if (status === "blocked" || status === "error" || status === "unconfigured") return <RequireAuth>{null}</RequireAuth>;
  return (
    <div role="status" aria-live="polite" className="grid min-h-[50vh] place-items-center text-sm text-ink-muted">
      Signing you in…
    </div>
  );
}
