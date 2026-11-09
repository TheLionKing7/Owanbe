import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { createPlannerApi, plannerErrorMessage, type PlannerApi, type PlanResult } from "./api";
import {
  PLANNER_DISCLOSURE,
  REPORT_CATEGORIES,
  type PlannerInput,
  type ReportCategory,
} from "./contracts";

const NO_TOKEN = async (): Promise<string | null> => null;

const CURRENCIES = ["NGN", "GBP", "USD", "EUR"];

const BUDGET_FIT_LABEL: Record<string, string> = {
  within_budget: "Within your budget",
  above_budget: "Above your budget",
  unknown: "Budget fit unknown",
};

const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  wrong_facts: "The facts are wrong",
  not_relevant: "Not relevant to my celebration",
  missing_vendor: "A vendor was missing",
  price_or_availability: "Price or availability is wrong",
  harmful: "Something harmful or offensive",
  other: "Something else",
};

interface PlannerPanelProps {
  /** Injected in tests; defaults to the app's own planner routes. */
  api?: PlannerApi | undefined;
  /** The caller's own token decides what the database lets them do. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
  /** The F-7 hand-off arrives as a question the host asked at sign-up. */
  initialBrief?: string | undefined;
}

/**
 * F-101: OwanbePlanner. The host says what they are planning, the assistant answers with
 * options built only from published vendor profiles, and every answer carries the disclosure
 * label and a way to report it.
 */
export function PlannerPanel({ api, getAccessToken, initialBrief }: PlannerPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createPlannerApi(readToken), [api, readToken]);

  const [eventType, setEventType] = useState("");
  const [city, setCity] = useState("");
  const [guests, setGuests] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("wrong_facts");
  const [note, setNote] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    setBrief((current) => (current.trim() ? current : (initialBrief ?? "")));
  }, [initialBrief]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amount = Number(budget);
    const guestCount = Number(guests);
    if (!eventType.trim() || !city.trim() || !brief.trim() || !amount || !guestCount) {
      setError(
        "Tell us the celebration, the city, how many guests are coming, the budget and what you want from it.",
      );
      return;
    }
    const input: PlannerInput = {
      event_type: eventType.trim(),
      city: city.trim(),
      guest_count: Math.round(guestCount),
      budget_minor: Math.round(amount * 100),
      budget_currency: currency,
      brief: brief.trim(),
    };
    setBusy(true);
    try {
      const answer = await client.generate(input);
      setResult(answer);
      setReported(false);
      setReporting(false);
      setReportError(null);
    } catch (caught) {
      setError(plannerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendReport() {
    if (!result) return;
    setReportError(null);
    try {
      await client.report(result.interaction_id, category, note.trim() || undefined);
      setReported(true);
      setReporting(false);
    } catch (caught) {
      setReportError(plannerErrorMessage(caught));
    }
  }

  return (
    <div className="space-y-6" data-testid="planner-panel">
      <section aria-labelledby="planner-form" className="surface p-5 sm:p-6">
        <p className="inline-flex items-center gap-2 rounded-full bg-plum-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800">
          <Sparkles aria-hidden className="h-3.5 w-3.5" /> {PLANNER_DISCLOSURE}
        </p>
        <h2 id="planner-form" className="mt-3 font-display text-2xl font-bold text-plum-950">
          Tell OwanbePlanner what you are planning
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          The planner builds options from vendors who have published a profile on Ówàńbè. It never
          invents a price or a date: anything it cannot confirm is marked unknown.
        </p>

        <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="planner-event-type" className="block text-sm font-semibold text-ink">
                Celebration
              </label>
              <input
                id="planner-event-type"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                placeholder="Wedding"
                className="mt-2 min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="planner-event-type"
              />
            </div>
            <div>
              <label htmlFor="planner-city" className="block text-sm font-semibold text-ink">
                City
              </label>
              <input
                id="planner-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Lagos"
                className="mt-2 min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="planner-city"
              />
            </div>
            <div>
              <label htmlFor="planner-guests" className="block text-sm font-semibold text-ink">
                Guests
              </label>
              <input
                id="planner-guests"
                type="number"
                min={1}
                max={5000}
                value={guests}
                onChange={(event) => setGuests(event.target.value)}
                placeholder="150"
                className="mt-2 min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="planner-guests"
              />
            </div>
            <div>
              <label htmlFor="planner-budget" className="block text-sm font-semibold text-ink">
                Budget
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="planner-budget"
                  type="number"
                  min={0}
                  step="0.01"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  placeholder="500000"
                  className="min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="planner-budget"
                />
                <select
                  aria-label="Currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="min-h-[44px] rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="planner-currency"
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="planner-brief" className="block text-sm font-semibold text-ink">
              What do you want from this celebration?
            </label>
            <textarea
              id="planner-brief"
              rows={4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="We want a traditional wedding with a small band and local food, and we need it done by December."
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="planner-brief"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="planner-error"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary min-h-[44px] px-6 py-2 text-sm"
            disabled={busy}
            data-testid="planner-submit"
          >
            {busy ? "Planning…" : "Ask OwanbePlanner"}
          </button>
        </form>
      </section>

      {busy && (
        <p
          role="status"
          className="surface p-6 text-sm text-ink-muted"
          data-testid="planner-loading"
        >
          OwanbePlanner is putting your options together…
        </p>
      )}

      {result && !busy && (
        <section
          aria-labelledby="planner-answer"
          className="surface p-5 sm:p-6"
          data-testid="planner-result"
        >
          <p
            className="inline-flex items-center gap-2 rounded-full bg-plum-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800"
            data-testid="planner-disclosure"
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" /> {result.disclosure}
          </p>
          <h2 id="planner-answer" className="mt-3 font-display text-2xl font-bold text-plum-950">
            Your plan
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{result.plan.summary}</p>

          {(result.grounding.removed_vendors > 0 || result.grounding.unknown_prices > 0) && (
            <p
              className="mt-3 rounded-2xl bg-cream-100 p-3 text-xs text-ink-muted"
              data-testid="planner-grounding"
            >
              {result.grounding.removed_vendors > 0 &&
                `${result.grounding.removed_vendors} vendor${result.grounding.removed_vendors === 1 ? "" : "s"} we could not confirm ${
                  result.grounding.removed_vendors === 1 ? "was" : "were"
                } left out. `}
              {result.grounding.unknown_prices > 0 &&
                `${result.grounding.unknown_prices} price${
                  result.grounding.unknown_prices === 1 ? "" : "s"
                } could not be read from the vendor's own note.`}
            </p>
          )}

          {result.plan.options.length === 0 && (
            <p className="mt-4 text-sm text-ink-muted" data-testid="planner-no-options">
              There is nothing to build on yet. Once vendors publish their profiles, ask again and
              the planner will put options together for you.
            </p>
          )}

          {result.plan.options.length > 0 && (
            <ol className="mt-5 space-y-5" data-testid="planner-options">
              {result.plan.options.map((option, index) => (
                <li key={`${option.title}-${index}`} className="rounded-3xl bg-cream-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
                    Option {index + 1} · {PLANNER_DISCLOSURE}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-bold text-plum-950">
                    {option.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">{option.summary}</p>

                  {option.vendors.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {option.vendors.map((vendor) => (
                        <li
                          key={vendor.slug}
                          className="rounded-2xl bg-white p-3 text-sm"
                          data-testid="planner-vendor"
                        >
                          <span className="font-semibold text-plum-950">
                            {vendor.business_name}
                          </span>
                          {vendor.category ? (
                            <span className="text-ink-muted"> · {vendor.category}</span>
                          ) : null}
                          <span className="mt-1 block text-ink-muted">{vendor.price_label}</span>
                          <span className="mt-1 block text-ink-subtle">
                            {vendor.availability_label}
                          </span>
                          <span className="mt-1 block text-xs text-ink-subtle">
                            {BUDGET_FIT_LABEL[vendor.budget_fit]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {option.steps.length > 0 && (
                    <ol className="mt-4 space-y-2">
                      {option.steps.map((step, stepIndex) => (
                        <li key={`${step.title}-${stepIndex}`} className="text-sm text-ink">
                          <span className="font-semibold text-plum-800">{stepIndex + 1}.</span>{" "}
                          <span className="font-semibold">{step.title}</span>
                          {step.detail ? ` — ${step.detail}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="mt-5 text-xs text-ink-subtle">
            This is a starting point, not a quote. Ask each vendor for a formal quote before you pay
            anyone.
          </p>

          <div className="mt-4">
            {reported ? (
              <p className="text-sm text-owanbe-emerald-green" data-testid="planner-reported">
                Thank you. We have logged your report and will look at that answer.
              </p>
            ) : reporting ? (
              <div className="space-y-3" data-testid="planner-report-form">
                <label
                  htmlFor="planner-report-category"
                  className="block text-sm font-semibold text-ink"
                >
                  What was wrong with this answer?
                </label>
                <select
                  id="planner-report-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ReportCategory)}
                  className="min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="planner-report-category"
                >
                  {REPORT_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {REPORT_CATEGORY_LABEL[value]}
                    </option>
                  ))}
                </select>
                <label
                  htmlFor="planner-report-note"
                  className="block text-sm font-semibold text-ink"
                >
                  Anything else we should know? (optional)
                </label>
                <textarea
                  id="planner-report-note"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="planner-report-note"
                />
                {reportError && (
                  <p
                    role="alert"
                    className="text-sm font-semibold text-owanbe-vibrant-red"
                    data-testid="planner-report-error"
                  >
                    {reportError}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="btn-primary min-h-[44px] px-5 py-2 text-sm"
                    onClick={() => void sendReport()}
                    data-testid="planner-report-submit"
                  >
                    Send the report
                  </button>
                  <button
                    type="button"
                    className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                    onClick={() => setReporting(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                onClick={() => setReporting(true)}
                data-testid="planner-report-open"
              >
                Report this answer
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
