import { useCallback, useEffect, useState } from "react";
import { QUOTE_ERROR_COPY, QuoteError } from "@/features/quotes/api";
import { holdsApi, type HoldsApi } from "./api";
import { ALERT_TONE, unreadCount, type HouseAlert } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

interface HouseAlertsProps {
  house: HouseSummary;
  /** Injected in tests; defaults to the Supabase RPC boundary. */
  api?: HoldsApi | undefined;
}

function messageFor(error: unknown): string {
  if (error instanceof QuoteError) return QUOTE_ERROR_COPY[error.code];
  return QUOTE_ERROR_COPY.unknown;
}

export function HouseAlerts({ house, api = holdsApi }: HouseAlertsProps) {
  const [alerts, setAlerts] = useState<HouseAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAlerts(await api.alerts(house.house_id));
    } catch (caught) {
      setAlerts(null);
      setError(messageFor(caught));
    }
  }, [api, house.house_id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markSeen(alert: HouseAlert) {
    setPending(alert.id);
    try {
      await api.markSeen(alert.id);
      // The database stamps read_at; re-read the projection rather than pretend locally.
      await load();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  const unread = alerts ? unreadCount(alerts) : 0;

  return (
    <section className="surface p-5" aria-labelledby="alerts-title" data-testid="alerts-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="alerts-title" className="font-display text-xl font-bold text-plum-950">
          Date alerts
          {unread > 0 && (
            <span
              className="ml-2 rounded-full bg-owanbe-vibrant-red px-2 py-0.5 text-xs text-white"
              data-testid="alerts-unread"
            >
              {unread}
            </span>
          )}
        </h2>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-4 py-2 text-sm"
          onClick={() => void load()}
          data-testid="alerts-refresh"
        >
          Refresh
        </button>
      </div>

      {alerts === null && !error && (
        <p role="status" className="mt-3 text-sm text-ink-muted" data-testid="alerts-loading">
          Loading your alerts…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-owanbe-vibrant-red" data-testid="alerts-error">
          {error}
        </p>
      )}

      {alerts !== null && alerts.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted" data-testid="alerts-empty">
          Nothing about your dates yet. Competing holds, secured dates and refunds will appear here.
        </p>
      )}

      {alerts !== null && alerts.length > 0 && (
        <ul className="mt-4 space-y-3">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="rounded-2xl bg-cream-50 p-4"
              data-testid="alert-row"
              data-kind={alert.kind}
              data-read={alert.read_at !== null}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-plum-900">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ALERT_TONE[alert.kind]}`}
                  >
                    {alert.title}
                  </span>
                </p>
                <time dateTime={alert.created_at} className="text-xs text-ink-subtle">
                  {alert.created_at.slice(0, 16).replace("T", " ")}
                </time>
              </div>
              <p className="mt-2 text-sm text-ink-muted">{alert.body}</p>
              {alert.read_at === null && (
                <button
                  type="button"
                  className="btn-outline mt-2 min-h-[44px] px-4 py-1.5 text-sm"
                  disabled={pending !== null}
                  onClick={() => void markSeen(alert)}
                  data-testid={`alert-seen-${alert.id}`}
                >
                  {pending === alert.id ? "Saving…" : "Mark seen"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
