/**
 * F-107 OwanbeAI: the staff panel on a booking's payments.
 *
 * The panel only appears for a caller who may use it: the database decides, by answering whether
 * the zero-retention contract is confirmed and whether the caller holds the AI investigation
 * grant. The panel asks; it never decides.
 *
 * What OwanbeAI does here is read. It cannot move money, refund a payment, release a hold or
 * complete a booking. The most it can do is say what it sees and open a case for a person.
 */
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { aiErrorMessage, createAiApi, type AiApi } from "./api";
import { AI_DISCLOSURE, type InvestigationFinding, type InvestigationResult } from "./contracts";
import { AiLabel, AiReportControl } from "./AiDisclosure";

const NO_TOKEN = async (): Promise<string | null> => null;

const FINDING_LABEL: Record<InvestigationFinding, string> = {
  no_issue: "Nothing wrong found in this payment trail",
  needs_human: "A person needs to look at this",
  case_opened: "A case was opened for a person to look at",
};

interface AiInvestigationPanelProps {
  /** The booking whose payment trail is read. */
  bookingId: string;
  /** Injected in tests; defaults to the app's own AI routes. */
  api?: AiApi | undefined;
  /** The caller's own token decides what the database lets them do. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

export function AiInvestigationPanel({
  bookingId,
  api,
  getAccessToken,
}: AiInvestigationPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createAiApi(readToken), [api, readToken]);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvestigationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await client.status();
        if (!cancelled) setAvailable(status.available);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [bookingId]);

  async function ask() {
    setError(null);
    setBusy(true);
    try {
      setResult(await client.investigate(bookingId, question.trim() || undefined));
    } catch (caught) {
      setError(aiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  // A caller who may not use OwanbeAI never sees the tool at all.
  if (available !== true) return null;

  return (
    <section
      aria-labelledby="ai-investigation-title"
      className="rounded-2xl bg-cream-50 p-4"
      data-testid="ai-investigation-panel"
    >
      <AiLabel label={AI_DISCLOSURE.investigation} testId="ai-investigation-disclosure" />
      <h3 id="ai-investigation-title" className="mt-2 font-display text-lg font-bold text-plum-950">
        Ask OwanbeAI about this payment
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        OwanbeAI reads the payment trail for this booking: what was paid, what is still held, what
        was released and what the payment provider recorded. It cannot move money or release a
        payment. If it finds something, it opens a case for a person to look at.
      </p>

      <div className="mt-3">
        <label htmlFor="ai-investigation-question" className="block text-sm font-semibold text-ink">
          What do you want to know? (optional)
        </label>
        <input
          id="ai-investigation-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={500}
          placeholder="Why is the money still held two months after the date?"
          className="mt-1 min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
          data-testid="ai-investigation-question"
        />
      </div>

      <button
        type="button"
        className="btn-primary mt-3 min-h-[44px] px-5 py-2 text-sm"
        disabled={busy}
        onClick={() => void ask()}
        data-testid="ai-investigation-ask"
      >
        {busy ? "Reading the trail…" : "Ask OwanbeAI"}
      </button>

      {busy && (
        <p
          role="status"
          className="mt-3 text-sm text-ink-muted"
          data-testid="ai-investigation-loading"
        >
          OwanbeAI is reading the payment trail…
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 text-sm font-semibold text-owanbe-vibrant-red"
          data-testid="ai-investigation-error"
        >
          {error}
        </p>
      )}

      {result && !busy && (
        <div className="mt-4 space-y-3" data-testid="ai-investigation-result">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
            <Sparkles aria-hidden className="h-3.5 w-3.5" /> {result.disclosure}
          </p>
          <p className="text-sm font-semibold text-plum-950" data-testid="ai-investigation-finding">
            {FINDING_LABEL[result.finding]}
          </p>
          <p className="text-sm text-ink" data-testid="ai-investigation-summary">
            {result.summary}
          </p>
          {result.case_id && (
            <p className="text-sm text-ink-muted" data-testid="ai-investigation-case">
              A case was opened for this booking. Its reference is{" "}
              <strong className="text-plum-950">{result.case_id}</strong>.
            </p>
          )}
          <AiReportControl
            interactionId={result.interaction_id}
            onReport={(interactionId, category, note) =>
              client.report(interactionId, category, note)
            }
            errorMessage={aiErrorMessage}
            testIdPrefix="ai-investigation"
            openLabel="Report this investigation"
            thanksLabel="Thank you. We have logged your report and will look at that investigation."
          />
        </div>
      )}
    </section>
  );
}
