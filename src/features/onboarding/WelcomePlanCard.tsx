import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Link } from "@/lib/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import { onboardingApi, type OnboardingApi } from "./api";
import { plannerPrompt, type OnboardingState } from "./contracts";

/**
 * F-7: on the Host overview, what the host told us at sign-up, with a one-click hand-off to the
 * AI Planner carrying that context. Shows nothing when there is no intent to show.
 */
export function WelcomePlanCard({ api: injected }: { api?: OnboardingApi | undefined }) {
  const { rpc } = useAuth();
  const api = useMemo(() => injected ?? onboardingApi(rpc), [injected, rpc]);
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    let active = true;
    api
      .load()
      .then((s) => active && setState(s))
      .catch(() => active && setState(null));
    return () => {
      active = false;
    };
  }, [api]);

  if (!state || state.role !== "host" || !state.host_intent) return null;
  const prompt = plannerPrompt(state);
  const when = state.event_date
    ? new Date(`${state.event_date}T00:00:00`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "date not set yet";
  return (
    <section
      aria-label="Your celebration"
      className="mt-6 rounded-3xl bg-white p-6 shadow-card"
      data-testid="welcome-plan"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
        {state.host_intent === "arranging" ? "You're planning for a client" : "You're hosting"}
      </p>
      <h2 className="mt-1 font-display text-2xl font-bold text-plum-950">
        {state.event_type ?? "A celebration"}
      </h2>
      <p className="mt-1 text-ink-muted">
        {state.city ?? "City not set"} · {when}
      </p>
      <Link
        to={`/host/plan?q=${encodeURIComponent(prompt)}`}
        className="btn-primary mt-5 h-12 px-6"
      >
        <Sparkles aria-hidden className="h-4 w-4" /> Plan it with OwanbePlanner
      </Link>
    </section>
  );
}
