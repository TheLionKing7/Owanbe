/**
 * F-107 OwanbeAI: the one AI label and the one report control.
 *
 * Every surface that shows an answer from a model uses these two, so a reader always sees that
 * the words came from a model and always has a way to say the answer was wrong. The surface
 * supplies the words it wants shown and the call it makes; the control owns the wording of the
 * form and the handling of a refusal.
 */
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABEL, type ReportCategory } from "./contracts";

export interface AiLabelProps {
  /** The words this surface puts on its own output. */
  label: string;
  /** The test id, so each surface's label stays addressable. */
  testId?: string | undefined;
}

/** The persistent badge. It sits on the surface itself, so the disclosure is there before any answer is. */
export function AiLabel({ label, testId }: AiLabelProps) {
  return (
    <p
      className="inline-flex items-center gap-2 rounded-full bg-plum-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800"
      data-testid={testId}
    >
      <Sparkles aria-hidden className="h-3.5 w-3.5" /> {label}
    </p>
  );
}

export interface AiReportControlProps {
  /** The interaction the report is about. A new id resets the control. */
  interactionId: string;
  /** Reports the answer. It rejects, and the control shows the surface's own words for it. */
  onReport: (interactionId: string, category: ReportCategory, note?: string) => Promise<void>;
  /** The sentence a refusal is shown as. */
  errorMessage: (error: unknown) => string;
  /** Prefixes the test ids, so two surfaces on one page stay addressable. */
  testIdPrefix: string;
  /** The wording of the button that opens the form. */
  openLabel?: string | undefined;
  /** The wording of the sentence after a report is logged. */
  thanksLabel?: string | undefined;
}

/**
 * The report control. One report per answer: once it is logged the control says so and offers
 * nothing further, because the database refuses a second report rather than merging it.
 */
export function AiReportControl({
  interactionId,
  onReport,
  errorMessage,
  testIdPrefix,
  openLabel = "Report this answer",
  thanksLabel = "Thank you. We have logged your report and will look at that answer.",
}: AiReportControlProps) {
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("wrong_facts");
  const [note, setNote] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [lastInteractionId, setLastInteractionId] = useState(interactionId);

  // The control starts again when the answer it is about changes. The reset happens while
  // rendering, not in an effect: an effect would also fire on mount, and a click that landed
  // before that effect had flushed would open the form and close it again in the same breath.
  if (lastInteractionId !== interactionId) {
    setLastInteractionId(interactionId);
    setReporting(false);
    setCategory("wrong_facts");
    setNote("");
    setReportError(null);
    setReported(false);
  }

  async function send() {
    setReportError(null);
    try {
      await onReport(interactionId, category, note.trim() || undefined);
      setReported(true);
      setReporting(false);
    } catch (caught) {
      setReportError(errorMessage(caught));
    }
  }

  if (reported) {
    return (
      <p className="text-sm text-owanbe-emerald-green" data-testid={`${testIdPrefix}-reported`}>
        {thanksLabel}
      </p>
    );
  }

  if (!reporting) {
    return (
      <button
        type="button"
        className="btn-outline min-h-[44px] px-5 py-2 text-sm"
        onClick={() => setReporting(true)}
        data-testid={`${testIdPrefix}-report-open`}
      >
        {openLabel}
      </button>
    );
  }

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-report-form`}>
      <label
        htmlFor={`${testIdPrefix}-report-category`}
        className="block text-sm font-semibold text-ink"
      >
        What was wrong with this answer?
      </label>
      <select
        id={`${testIdPrefix}-report-category`}
        value={category}
        onChange={(event) => setCategory(event.target.value as ReportCategory)}
        className="min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
        data-testid={`${testIdPrefix}-report-category`}
      >
        {REPORT_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {REPORT_CATEGORY_LABEL[value]}
          </option>
        ))}
      </select>
      <label
        htmlFor={`${testIdPrefix}-report-note`}
        className="block text-sm font-semibold text-ink"
      >
        Anything else we should know? (optional)
      </label>
      <textarea
        id={`${testIdPrefix}-report-note`}
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
        data-testid={`${testIdPrefix}-report-note`}
      />
      {reportError && (
        <p
          role="alert"
          className="text-sm font-semibold text-owanbe-vibrant-red"
          data-testid={`${testIdPrefix}-report-error`}
        >
          {reportError}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary min-h-[44px] px-5 py-2 text-sm"
          onClick={() => void send()}
          data-testid={`${testIdPrefix}-report-submit`}
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
  );
}
