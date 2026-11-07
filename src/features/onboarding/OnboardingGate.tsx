import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "@/lib/router";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { HouseId } from "@/lib/houses";
import { OnboardingError, onboardingApi, type OnboardingApi } from "./api";
import { onboardingFinishedFor, rememberOnboardingFinished } from "./gate-cache";

/**
 * F-7: a house opens only after its account finished onboarding (name, phone, city, and the
 * host's intent or the vendor's business). The answer is remembered for this page load, so
 * moving between sections doesn't ask the database again.
 */
type Verdict = "checking" | "open" | "onboard";

export function OnboardingGate({
  houseId,
  children,
  api: injected,
}: {
  houseId: HouseId;
  children: ReactNode;
  api?: OnboardingApi | undefined;
}) {
  const { rpc, user, houses } = useAuth();
  const { pathname, search } = useLocation();
  const api = useMemo(() => injected ?? onboardingApi(rpc), [injected, rpc]);
  // Staff invited into someone else's Vendor house have no business of their own to set up.
  const staffHere = houses.some((h) => h.kind === houseId && h.role === "staff");
  const [verdict, setVerdict] = useState<Verdict>(
    staffHere || (user && onboardingFinishedFor(user.id)) ? "open" : "checking",
  );

  useEffect(() => {
    if (verdict !== "checking" || !user) return;
    let active = true;
    api
      .load()
      .then((state) => {
        if (!active) return;
        if (state?.completed_at) {
          rememberOnboardingFinished(user.id);
          setVerdict("open");
        } else setVerdict("onboard");
      })
      .catch((err: unknown) => {
        // Before the migration runs (or if the check fails), never lock people out of their house.
        if (!active) return;
        if (!(err instanceof OnboardingError) || err.code !== "unavailable")
          console.warn("[onboarding] check failed; opening the house", err);
        setVerdict("open");
      });
    return () => {
      active = false;
    };
  }, [api, user, verdict]);

  if (verdict === "open") return <>{children}</>;
  if (verdict === "onboard")
    return (
      <Navigate
        to={`/welcome?role=${houseId}&next=${encodeURIComponent(pathname + search)}`}
        replace
      />
    );
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[30vh] place-items-center text-sm text-ink-muted"
    >
      Checking your account…
    </div>
  );
}
