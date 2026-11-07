import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "@/lib/router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  BUSINESS_CATEGORIES,
  EVENT_TYPES,
  ROLE_COPY,
  normalizePhone,
  resumeStep,
  safeNext,
  stepsFor,
  validateAbout,
  validateBusiness,
  validatePlans,
  type HostIntent,
  type OnboardingRole,
  type OnboardingState,
  type OnboardingStep,
} from "@/features/onboarding/contracts";
import {
  ONBOARDING_ERROR_COPY,
  OnboardingError,
  onboardingApi,
  type OnboardingApi,
} from "@/features/onboarding/api";
import { forgetOnboarding } from "@/features/onboarding/gate-cache";

type FieldErrors = {
  name?: string | undefined;
  phone?: string | undefined;
  city?: string | undefined;
  intent?: string | undefined;
  eventType?: string | undefined;
  eventDate?: string | undefined;
  businessName?: string | undefined;
  category?: string | undefined;
};

const HOME: Record<OnboardingRole, string> = {
  host: "/host?welcome=1",
  vendor: "/vendor/profile?welcome=1",
};
const STEP_TITLE: Record<OnboardingStep, string> = {
  role: "How will you use Ówàńbè?",
  about: "About you",
  plans: "What are you planning?",
  business: "Your business",
  done: "You're all set",
};

/** /welcome (F-7): finishes a new account in a few short steps, then opens the right house. */
export default function Welcome({ api }: { api?: OnboardingApi }) {
  return (
    <RequireAuth>
      <WelcomeFlow api={api} />
    </RequireAuth>
  );
}

function asRole(value: string | null): OnboardingRole | null {
  return value === "host" || value === "vendor" ? value : null;
}

export function WelcomeFlow({ api: injected }: { api?: OnboardingApi | undefined }) {
  const { rpc, user, houses, refreshHouses } = useAuth();
  const api = useMemo(() => injected ?? onboardingApi(rpc), [injected, rpc]);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");

  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable" | "failed">("loading");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [role, setRole] = useState<OnboardingRole | null>(asRole(params.get("role")));
  const [step, setStep] = useState<OnboardingStep>("role");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const [name, setName] = useState(user?.display_name ?? "");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [intent, setIntent] = useState<HostIntent | "">("");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [businessName, setBusinessName] = useState(
    houses.find((h) => h.kind === "vendor")?.display_name ?? "",
  );
  const [category, setCategory] = useState("");

  async function load() {
    setPhase("loading");
    setError(null);
    try {
      const s = await api.load();
      setState(s);
      const r = s?.role ?? role;
      setRole(r);
      if (s) {
        setName(s.display_name ?? user?.display_name ?? "");
        setPhone(s.phone_e164 ?? "");
        setCity(s.city ?? "");
        setIntent(s.host_intent ?? "");
        setEventType(s.event_type ?? "");
        setEventDate(s.event_date ?? "");
        setCategory(s.business_category ?? "");
      }
      const resume = resumeStep(s, r);
      if (resume === "done" && s?.completed_at) {
        finish(s.role);
        return;
      }
      setStep(resume);
      setPhase("ready");
    } catch (err) {
      setPhase(
        err instanceof OnboardingError && err.code === "unavailable" ? "unavailable" : "failed",
      );
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function finish(r: OnboardingRole) {
    forgetOnboarding();
    navigate(safeNext(next, HOME[r]), { replace: true });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof OnboardingError
          ? ONBOARDING_ERROR_COPY[err.code]
          : ONBOARDING_ERROR_COPY.unknown,
      );
    } finally {
      setBusy(false);
    }
  }

  function submitAbout(e: FormEvent) {
    e.preventDefault();
    const found = validateAbout({ name, phone, city });
    setErrors(found);
    if (Object.keys(found).length || !role) return;
    void run(async () => {
      await api.save({
        role,
        displayName: name.trim(),
        phone: normalizePhone(phone),
        city: city.trim(),
      });
      setPhone(normalizePhone(phone) ?? phone);
      setStep(role === "host" ? "plans" : "business");
    });
  }

  function submitPlans(e: FormEvent) {
    e.preventDefault();
    const found = validatePlans({ intent, eventType, eventDate });
    setErrors(found);
    if (Object.keys(found).length || !intent) return;
    void run(async () => {
      await api.save({
        role: "host",
        hostIntent: intent,
        eventType: eventType || null,
        eventDate: eventDate || null,
      });
      await api.complete();
      finish("host");
    });
  }

  function submitBusiness(e: FormEvent) {
    e.preventDefault();
    const found = validateBusiness({ businessName, category });
    setErrors(found);
    if (Object.keys(found).length) return;
    void run(async () => {
      if (
        !houses.some((h) => h.kind === "vendor" && h.role === "owner") &&
        !state?.has_vendor_house
      )
        await api.openVendorHouse(businessName.trim());
      await api.save({ role: "vendor", businessCategory: category });
      await api.complete();
      await refreshHouses();
      finish("vendor");
    });
  }

  const steps: OnboardingStep[] = stepsFor(role).filter((s) => s !== "done");
  const position = Math.max(0, steps.indexOf(step));

  if (phase === "loading")
    return (
      <Shell>
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-ink-muted"
        >
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Getting your account ready…
        </p>
      </Shell>
    );
  if (phase === "unavailable" || phase === "failed")
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-plum-950">
          {phase === "unavailable" ? "Account setup isn't on yet" : "We couldn't load your setup"}
        </h1>
        <p className="mt-2 text-ink-muted">
          {phase === "unavailable"
            ? ONBOARDING_ERROR_COPY.unavailable
            : ONBOARDING_ERROR_COPY.network}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {phase === "failed" && (
            <Button type="button" onClick={() => void load()}>
              Try again
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(safeNext(next, role === "vendor" ? "/vendor" : "/host"))}
          >
            Continue to my house
          </Button>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
        <span>
          Step {position + 1} of {steps.length}
        </span>
        {role && <span>{role === "host" ? "Host" : "Vendor"}</span>}
      </div>
      <Progress
        value={((position + 1) / steps.length) * 100}
        className="mt-2"
        aria-label="Setup progress"
      />
      <h1 className="mt-6 font-display text-3xl font-bold text-plum-950">{STEP_TITLE[step]}</h1>

      {step === "role" && (
        <div className="mt-6 grid gap-3" role="group" aria-label="Choose how you'll use Ówàńbè">
          {(Object.keys(ROLE_COPY) as OnboardingRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRole(r);
                setStep("about");
              }}
              className="min-h-[44px] rounded-2xl border border-plum-900/10 bg-white p-4 text-left transition hover:border-plum-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum-500"
            >
              <span className="block font-semibold text-plum-950">{ROLE_COPY[r].title}</span>
              <span className="mt-1 block text-sm text-ink-muted">{ROLE_COPY[r].body}</span>
            </button>
          ))}
        </div>
      )}

      {step === "about" && (
        <form className="mt-6 space-y-4" onSubmit={submitAbout} noValidate>
          <Field id="ob-name" label="Your full name" error={errors.name}>
            <Input
              id="ob-name"
              value={name}
              maxLength={120}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            id="ob-phone"
            label="Phone number"
            hint="Nigerian numbers can start with 0. Other countries: start with + and the country code."
            error={errors.phone}
          >
            <Input
              id="ob-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              maxLength={20}
              placeholder="0801 234 5678"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field id="ob-city" label="City" error={errors.city}>
            <Input
              id="ob-city"
              value={city}
              maxLength={80}
              autoComplete="address-level2"
              placeholder="e.g. Lagos, Ibadan, London"
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          <Actions
            busy={busy}
            error={error}
            onBack={params.get("role") ? undefined : () => setStep("role")}
            label="Continue"
          />
        </form>
      )}

      {step === "plans" && (
        <form className="mt-6 space-y-5" onSubmit={submitPlans} noValidate>
          <fieldset>
            <legend className="text-sm font-medium text-ink">Who is the celebration for?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["hosting", "I'm hosting it", "It's my own celebration or my family's."],
                  [
                    "arranging",
                    "I'm arranging it for someone",
                    "I'm planning or booking on someone else's behalf.",
                  ],
                ] as const
              ).map(([value, title, body]) => (
                <label
                  key={value}
                  className={`flex min-h-[44px] cursor-pointer flex-col rounded-2xl border p-4 ${intent === value ? "border-plum-700 bg-plum-100" : "border-plum-900/10 bg-white"}`}
                >
                  <span className="flex items-center gap-2 font-semibold text-plum-950">
                    <input
                      type="radio"
                      name="ob-intent"
                      value={value}
                      checked={intent === value}
                      onChange={() => setIntent(value)}
                    />
                    {title}
                  </span>
                  <span className="mt-1 text-sm text-ink-muted">{body}</span>
                </label>
              ))}
            </div>
            {errors.intent && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.intent}
              </p>
            )}
          </fieldset>
          <Field id="ob-event-type" label="What kind of celebration? (optional)">
            <select
              id="ob-event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Not sure yet</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ob-event-date" label="Date (optional)" error={errors.eventDate}>
            <Input
              id="ob-event-date"
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </Field>
          <Actions
            busy={busy}
            error={error}
            onBack={() => setStep("about")}
            label="Finish and open my Host house"
          />
        </form>
      )}

      {step === "business" && (
        <form className="mt-6 space-y-5" onSubmit={submitBusiness} noValidate>
          <Field
            id="ob-business"
            label="Business name"
            hint="This is the name hosts see."
            error={errors.businessName}
          >
            <Input
              id="ob-business"
              value={businessName}
              maxLength={80}
              autoComplete="organization"
              placeholder="e.g. Adùnní Events"
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-ink">What does your business do?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {BUSINESS_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={`min-h-[44px] rounded-full border px-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 ${category === c ? "border-plum-800 bg-plum-800 text-white" : "border-plum-900/10 bg-white hover:bg-plum-100"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            {errors.category && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.category}
              </p>
            )}
          </fieldset>
          <p className="text-sm text-ink-muted">
            Next you'll set up your profile. Verification comes before your first booking.
          </p>
          <Actions
            busy={busy}
            error={error}
            onBack={() => setStep("about")}
            label="Finish and open my Vendor house"
          />
        </form>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-10 sm:py-16">
      <Logo showTagline={false} className="self-center" />
      <section className="mt-8 rounded-3xl bg-white p-6 shadow-card sm:p-8">{children}</section>
    </main>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Actions({
  busy,
  error,
  onBack,
  label,
}: {
  busy: boolean;
  error: string | null;
  onBack?: (() => void) | undefined;
  label: string;
}) {
  return (
    <div className="space-y-3 pt-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft aria-hidden className="h-4 w-4" /> Back
          </Button>
        )}
        <Button type="submit" disabled={busy} className="ml-auto">
          {busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {label}
        </Button>
      </div>
    </div>
  );
}
