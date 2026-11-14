/**
 * F-107 OwanbeAI console.
 *
 * Two things live here, and they are not the same thing:
 *
 *   * What OwanbeAI has answered you. Every signed-in person sees this, because an answer the
 *     platform showed them should still be readable, and reportable, after it left the screen.
 *   * The case queue and the answer queue. These are for platform staff who hold the AI
 *     investigation grant. The database refuses anyone else, and the console says so rather than
 *     showing an empty queue.
 *
 * Working a case moves the case and writes a note. Nothing here touches a payment, a hold or a
 * booking: there is no path from this screen to the ledger, and the database's case workflow
 * holds no money fields at all.
 */
import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MessagesSquare } from "lucide-react";
import {
  aiConsoleErrorMessage,
  createAiConsoleApi,
  AiConsoleError,
  type AiConsoleApi,
} from "./console.api";
import {
  AI_ANSWER_LABEL,
  AI_ANSWER_LABEL_FALLBACK,
  AI_CASE_MOVES,
  AI_CASE_PRIORITY_LABEL,
  AI_CASE_STATUS_LABEL,
  AI_CASE_STATUSES,
  AI_CONSOLE_DISCLOSURE,
  AI_CONSOLE_LABEL,
  type AiAnswer,
  type AiCase,
  type AiCaseStatus,
} from "./console-contracts";
import { AiLabel, AiReportControl } from "./AiDisclosure";
import { aiErrorMessage, createAiReportApi } from "./api";

const NO_TOKEN = async (): Promise<string | null> => null;

const SURFACE_LABEL: Record<string, string> = {
  payment_investigation: "Payment investigation",
  vendor_profile_copy: "Vendor profile draft",
};

interface AiConsolePanelProps {
  /** Injected in tests; defaults to the app's own console routes. */
  api?: AiConsoleApi | undefined;
  /** The caller's own token decides what the database lets them do. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

export function AiConsolePanel({ api, getAccessToken }: AiConsolePanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createAiConsoleApi(readToken), [api, readToken]);
  const reportApi = useMemo(() => createAiReportApi(readToken), [readToken]);

  const [mine, setMine] = useState<AiAnswer[] | null>(null);
  const [cases, setCases] = useState<AiCase[] | null>(null);
  const [answers, setAnswers] = useState<AiAnswer[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffForbidden, setStaffForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<AiCaseStatus | "">("");
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [moveStatus, setMoveStatus] = useState<string>("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [caseError, setCaseError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setMineError(null);
    setStaffError(null);
    setStaffForbidden(false);

    void (async () => {
      const [own, queue, all] = await Promise.allSettled([
        client.mine(),
        client.cases(filter || null),
        client.answers(),
      ]);
      if (!live) return;

      if (own.status === "fulfilled") {
        setMine(own.value);
      } else {
        setMine([]);
        setMineError(aiConsoleErrorMessage(own.reason));
      }

      const staff = [queue, all] as const;
      const refused = staff.find(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof AiConsoleError &&
          result.reason.code === "forbidden",
      );
      if (refused) {
        setCases([]);
        setAnswers([]);
        setStaffForbidden(true);
      } else {
        const failed = staff.find((result) => result.status === "rejected");
        if (failed && failed.status === "rejected") {
          setCases([]);
          setAnswers([]);
          setStaffError(aiConsoleErrorMessage(failed.reason));
        } else {
          if (queue.status === "fulfilled") setCases(queue.value);
          if (all.status === "fulfilled") setAnswers(all.value);
        }
      }
      setLoading(false);
    })();

    return () => {
      live = false;
    };
  }, [client, filter]);

  async function reloadCases() {
    try {
      setCases(await client.cases(filter || null));
    } catch {
      // The list keeps what it had; the next read says what went wrong.
    }
  }

  async function work(caseId: string) {
    setCaseError(null);
    if (!moveStatus) {
      setCaseError("Choose what the case should become.");
      return;
    }
    setSaving(true);
    try {
      await client.updateCase({
        case_id: caseId,
        status: moveStatus as AiCaseStatus,
        note: note.trim() || undefined,
      });
      setActiveCase(null);
      setMoveStatus("");
      setNote("");
      await reloadCases();
    } catch (caught) {
      setCaseError(aiConsoleErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="ai-console-title"
      className="space-y-6 rounded-2xl bg-cream-50 p-4"
      data-testid="ai-console-panel"
    >
      <div>
        <AiLabel label={AI_CONSOLE_LABEL} testId="ai-console-label" />
        <h2 id="ai-console-title" className="mt-2 font-display text-lg font-bold text-plum-950">
          OwanbeAI
        </h2>
        <p className="mt-1 text-sm text-ink-muted" data-testid="ai-console-disclosure">
          {AI_CONSOLE_DISCLOSURE}
        </p>
      </div>

      {loading && (
        <p role="status" className="text-sm text-ink-muted" data-testid="ai-console-loading">
          Reading OwanbeAI&rsquo;s records&hellip;
        </p>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* What OwanbeAI has answered you                                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="rounded-2xl bg-white p-4" data-testid="ai-console-mine">
        <h3 className="font-display text-base font-bold text-plum-950">
          What OwanbeAI has answered you
        </h3>

        {!loading && mineError && (
          <p
            role="alert"
            className="mt-2 text-sm text-owanbe-vibrant-red"
            data-testid="ai-console-mine-error"
          >
            {mineError}
          </p>
        )}

        {!loading && !mineError && mine && mine.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted" data-testid="ai-console-mine-empty">
            OwanbeAI has not answered you yet. When it does, the answer is kept here so you can read
            it again or say that it was wrong.
          </p>
        )}

        {!loading && !mineError && mine && mine.length > 0 && (
          <ul className="mt-3 space-y-3">
            {mine.map((answer) => (
              <li
                key={answer.interaction_id}
                className="rounded-xl border border-plum-900/10 p-3"
                data-testid="ai-console-my-answer"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AiLabel
                    label={AI_ANSWER_LABEL[answer.surface] ?? AI_ANSWER_LABEL_FALLBACK}
                    testId={`ai-console-answer-label-${answer.interaction_id.slice(0, 8)}`}
                  />
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
                    {SURFACE_LABEL[answer.surface] ?? answer.surface} &middot; {answer.model}
                  </p>
                </div>
                <p className="mt-1 text-sm text-ink" data-testid="ai-console-my-answer-text">
                  {answer.response_text}
                </p>
                {answer.reported_at ? (
                  <p className="mt-2 text-xs text-ink-muted" data-testid="ai-console-my-reported">
                    You reported this answer on {answer.reported_at.slice(0, 10)}.
                  </p>
                ) : (
                  <div className="mt-2">
                    <AiReportControl
                      interactionId={answer.interaction_id}
                      onReport={(interactionId, category, reportNote) =>
                        reportApi.report(interactionId, category, reportNote)
                      }
                      errorMessage={aiErrorMessage}
                      testIdPrefix={`ai-console-my-${answer.interaction_id.slice(0, 8)}`}
                      openLabel="Report this answer"
                      thanksLabel="Thank you. We have logged your report and will look at that answer."
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* The case queue                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="rounded-2xl bg-white p-4" data-testid="ai-console-cases">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-bold text-plum-950">
            <FolderOpen aria-hidden className="h-4 w-4" /> Cases
          </h3>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Show</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as AiCaseStatus | "")}
              className="min-h-[44px] rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="ai-console-case-filter"
            >
              <option value="">Every case</option>
              {AI_CASE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {AI_CASE_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!loading && staffForbidden && (
          <p
            role="status"
            className="mt-2 text-sm text-ink-muted"
            data-testid="ai-console-forbidden"
          >
            The OwanbeAI case queue is for platform staff who hold the AI investigation grant.
          </p>
        )}

        {!loading && !staffForbidden && staffError && (
          <p
            role="alert"
            className="mt-2 text-sm text-owanbe-vibrant-red"
            data-testid="ai-console-staff-error"
          >
            {staffError}
          </p>
        )}

        {!loading && !staffForbidden && !staffError && cases && cases.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted" data-testid="ai-console-cases-empty">
            There are no cases
            {filter ? ` that are ${AI_CASE_STATUS_LABEL[filter].toLowerCase()}` : ""}.
          </p>
        )}

        {!loading && !staffForbidden && !staffError && cases && cases.length > 0 && (
          <ul className="mt-3 space-y-3">
            {cases.map((item) => (
              <li
                key={item.case_id}
                className="rounded-xl border border-plum-900/10 p-3"
                data-testid="ai-console-case"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-sm font-bold text-plum-950">
                    {item.case_reference}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {AI_CASE_STATUS_LABEL[item.status]} &middot;{" "}
                    {AI_CASE_PRIORITY_LABEL[item.priority] ?? item.priority} priority
                  </span>
                </div>
                <p
                  className="mt-1 text-sm font-semibold text-plum-950"
                  data-testid="ai-console-case-subject"
                >
                  {item.subject}
                </p>
                <p className="mt-1 text-sm text-ink">{item.reason}</p>

                {item.notes.length > 0 && (
                  <ul className="mt-2 space-y-1" data-testid="ai-console-case-notes">
                    {item.notes.map((caseNote) => (
                      <li key={caseNote.id} className="text-xs text-ink-muted">
                        {caseNote.body}
                      </li>
                    ))}
                  </ul>
                )}

                {activeCase === item.case_id ? (
                  <div className="mt-3 space-y-3" data-testid="ai-console-case-form">
                    <label
                      htmlFor={`ai-console-move-${item.case_id}`}
                      className="block text-sm font-semibold text-ink"
                    >
                      Move this case to
                    </label>
                    <select
                      id={`ai-console-move-${item.case_id}`}
                      value={moveStatus}
                      onChange={(event) => setMoveStatus(event.target.value)}
                      className="min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                      data-testid="ai-console-case-status"
                    >
                      <option value="">Choose a status</option>
                      {AI_CASE_MOVES[item.status].map((status) => (
                        <option key={status} value={status}>
                          {AI_CASE_STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>
                    <label
                      htmlFor={`ai-console-note-${item.case_id}`}
                      className="block text-sm font-semibold text-ink"
                    >
                      Note (optional)
                    </label>
                    <textarea
                      id={`ai-console-note-${item.case_id}`}
                      rows={3}
                      maxLength={1000}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                      data-testid="ai-console-case-note"
                    />
                    {caseError && (
                      <p
                        role="alert"
                        className="text-sm font-semibold text-owanbe-vibrant-red"
                        data-testid="ai-console-case-error"
                      >
                        {caseError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn-primary min-h-[44px] px-5 py-2 text-sm"
                        disabled={saving}
                        onClick={() => void work(item.case_id)}
                        data-testid="ai-console-case-save"
                      >
                        {saving ? "Saving…" : "Save the change"}
                      </button>
                      <button
                        type="button"
                        className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                        onClick={() => {
                          setActiveCase(null);
                          setCaseError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-outline mt-3 min-h-[44px] px-5 py-2 text-sm"
                    onClick={() => {
                      setActiveCase(item.case_id);
                      setMoveStatus("");
                      setNote("");
                      setCaseError(null);
                    }}
                    data-testid="ai-console-case-work"
                  >
                    Work this case
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* The answers                                                          */}
      {/* ----------------------------------------------------------------- */}
      <div className="rounded-2xl bg-white p-4" data-testid="ai-console-answers">
        <h3 className="inline-flex items-center gap-2 font-display text-base font-bold text-plum-950">
          <MessagesSquare aria-hidden className="h-4 w-4" /> Answers
        </h3>
        <p className="mt-1 text-xs text-ink-subtle">
          Every answer OwanbeAI gave, whoever asked for it. Reading this list is recorded on the
          platform&rsquo;s audit trail.
        </p>

        {!loading && !staffForbidden && !staffError && answers && answers.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted" data-testid="ai-console-answers-empty">
            OwanbeAI has not answered anybody yet.
          </p>
        )}

        {!loading && !staffForbidden && !staffError && answers && answers.length > 0 && (
          <ul className="mt-3 space-y-3">
            {answers.map((answer) => (
              <li
                key={answer.interaction_id}
                className="rounded-xl border border-plum-900/10 p-3"
                data-testid="ai-console-answer"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AiLabel
                    label={AI_ANSWER_LABEL[answer.surface] ?? AI_ANSWER_LABEL_FALLBACK}
                    testId={`ai-console-answer-label-${answer.interaction_id.slice(0, 8)}`}
                  />
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">
                    {SURFACE_LABEL[answer.surface] ?? answer.surface} &middot; {answer.model}
                  </p>
                </div>
                <p className="mt-1 text-sm font-semibold text-plum-950">{answer.request_summary}</p>
                <p className="mt-1 text-sm text-ink" data-testid="ai-console-answer-text">
                  {answer.response_text}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {answer.case_reference ? `Case ${answer.case_reference}` : "No case"} &middot;{" "}
                  {answer.reported_at
                    ? `Reported on ${answer.reported_at.slice(0, 10)}`
                    : "Not reported"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
