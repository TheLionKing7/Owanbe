/**
 * F-126: the operations dashboard.
 *
 * The panel shows what the platform's own records say needs attention. It is not a control
 * panel: nothing here moves money, releases a hold, settles a refund or closes a case. It is a
 * place to look, so that the person who decides what to do about an overdue release finds out
 * that it is overdue.
 *
 * The panel also says what it cannot see. The blueprint asks the dashboard for nine things and
 * this platform measures five of them; a panel that quietly showed four counters would read as a
 * healthy platform.
 */
import { useEffect, useMemo, useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { createObservabilityApi, observabilityErrorMessage, type ObservabilityApi } from "./api";
import {
  OBSERVABILITY_DISCLOSURE,
  OBSERVABILITY_NOT_MEASURED,
  OBSERVABILITY_SEVERITY_LABEL,
  bySeverity,
  type ObservabilitySeverity,
  type ObservabilitySnapshot,
} from "./contracts";

const NO_TOKEN = async (): Promise<string | null> => null;

const SEVERITY_CLASS: Record<ObservabilitySeverity, string> = {
  critical: "text-owanbe-vibrant-red",
  attention: "text-plum-800",
  info: "text-ink-muted",
};

interface ObservabilityPanelProps {
  /** Injected in tests; defaults to the app's own dashboard route. */
  api?: ObservabilityApi | undefined;
  /** The caller's own token decides what the database lets them read. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

export function ObservabilityPanel({ api, getAccessToken }: ObservabilityPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createObservabilityApi(readToken), [api, readToken]);

  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    client
      .read()
      .then((result) => {
        if (!live) return;
        setSnapshot(result);
      })
      .catch((caught: unknown) => {
        if (!live) return;
        setSnapshot(null);
        setError(observabilityErrorMessage(caught));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client]);

  const signals = useMemo(() => bySeverity(snapshot?.signals ?? []), [snapshot]);

  return (
    <section
      aria-labelledby="observability-title"
      className="rounded-2xl bg-cream-50 p-4"
      data-testid="observability-panel"
    >
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800">
        <Activity aria-hidden className="h-3.5 w-3.5" /> Operations
      </p>
      <h2 id="observability-title" className="mt-2 font-display text-lg font-bold text-plum-950">
        Operations dashboard
      </h2>
      <p className="mt-1 text-sm text-ink-muted" data-testid="observability-disclosure">
        {snapshot?.disclosure ?? OBSERVABILITY_DISCLOSURE}. Counts only: no amounts and no party
        details leave the platform's records.
      </p>

      {loading && (
        <p
          role="status"
          className="mt-2 text-sm text-ink-muted"
          data-testid="observability-loading"
        >
          Reading the platform's records…
        </p>
      )}

      {error && !loading && (
        <p role="alert" className="mt-2 text-sm text-ink-muted" data-testid="observability-error">
          {error}
        </p>
      )}

      {!loading && !error && signals.length === 0 && (
        <p className="mt-2 text-sm text-ink-muted" data-testid="observability-empty">
          The platform's records hold no signals yet.
        </p>
      )}

      {!loading && !error && signals.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="observability-signals">
          {signals.map((signal) => (
            <li
              key={signal.signal_key}
              className="rounded-2xl bg-white p-3"
              data-testid="observability-signal"
              data-signal={signal.signal_key}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-plum-950">{signal.signal_label}</span>
                <span
                  className={`font-display text-lg font-bold ${SEVERITY_CLASS[signal.severity]}`}
                  data-testid="observability-signal-value"
                >
                  {signal.value}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{signal.detail}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {OBSERVABILITY_SEVERITY_LABEL[signal.severity]}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && (
        <div className="mt-4" data-testid="observability-error-tracking">
          {snapshot?.error_tracking ? (
            <p className="text-sm text-ink">
              <span className="font-semibold text-plum-950">
                {snapshot.error_tracking.unresolved_issues}
              </span>{" "}
              error issue{snapshot.error_tracking.unresolved_issues === 1 ? "" : "s"} last seen in
              the last {snapshot.error_tracking.window_hours} hours, counted up to{" "}
              {snapshot.error_tracking.capped_at}.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              Error tracking was not available for this read, so no error counts are shown.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-cream-100 p-3" data-testid="observability-not-measured">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-plum-800">
          <TriangleAlert aria-hidden className="h-3.5 w-3.5" /> Not measured yet
        </p>
        <ul className="mt-2 space-y-1">
          {OBSERVABILITY_NOT_MEASURED.map((line) => (
            <li key={line} className="text-xs text-ink-muted">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
