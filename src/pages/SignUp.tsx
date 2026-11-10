import { useState } from "react";
import { CalendarHeart, Loader2, Store } from "lucide-react";
import { Link, useNavigate } from "@/lib/router";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_COPY, type OnboardingRole } from "@/features/onboarding/contracts";

const ICONS = { host: CalendarHeart, vendor: Store } as const;

/**
 * /sign-up (F-7): the visitor says who they are first, then Auth0 creates the account
 * (email, password or Google stay in Auth0), then /welcome finishes the setup for that role.
 */
export default function SignUp() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<OnboardingRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(role: OnboardingRole) {
    const returnTo = `/welcome?role=${role}`;
    if (status === "signedIn") {
      navigate(returnTo);
      return;
    }
    setBusy(role);
    setError(null);
    try {
      await login({ returnTo, signup: true });
    } catch {
      setError("We couldn't open sign-up. Check your connection and try again.");
      setBusy(null);
    }
  }

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-4 py-10 sm:py-16"
    >
      <Logo showTagline={false} />
      <h1 className="mt-8 text-center font-display text-3xl font-bold text-plum-950 sm:text-4xl">
        Create your account
      </h1>
      <p className="mt-2 text-center text-ink-muted">
        Tell us how you'll use Ówàńbè. You can open the other house later.
      </p>

      {status === "unconfigured" ? (
        <p role="status" className="mt-8 max-w-md text-center text-sm text-ink-muted">
          Sign-up isn't available in this environment yet.
        </p>
      ) : (
        <div
          className="mt-8 grid w-full gap-4 sm:grid-cols-2"
          role="group"
          aria-label="Choose how you'll use Ówàńbè"
        >
          {(Object.keys(ROLE_COPY) as OnboardingRole[]).map((role) => {
            const Icon = ICONS[role];
            return (
              <button
                key={role}
                type="button"
                onClick={() => void choose(role)}
                disabled={busy !== null || status === "loading"}
                data-testid={`signup-${role}`}
                className="flex min-h-[44px] flex-col items-start rounded-3xl border border-plum-900/10 bg-white p-6 text-left shadow-card transition hover:border-plum-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:opacity-60"
              >
                <Icon aria-hidden className="h-8 w-8 text-plum-700" />
                <span className="mt-4 font-display text-xl font-bold text-plum-950">
                  {ROLE_COPY[role].title}
                </span>
                <span className="mt-2 text-sm text-ink-muted">{ROLE_COPY[role].body}</span>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-plum-800">
                  {busy === role && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                  {busy === role ? "Opening sign-up…" : "Continue"}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="mt-8 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link
          to="/sign-in"
          className="font-semibold text-plum-800 underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
