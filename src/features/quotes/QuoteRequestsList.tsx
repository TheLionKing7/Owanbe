import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/payments/currency";
import { QUOTE_ERROR_COPY } from "./api";
import {
  REQUEST_STATUS_LABELS,
  quoteRequestApi,
  type QuoteRequest,
  type QuoteRequestApi,
} from "./requests";

interface Props {
  houseId: string;
  side: "host" | "vendor";
  api?: QuoteRequestApi | undefined;
  /** Vendor only: open the quote form prefilled for this request. */
  onWriteQuote?: ((request: QuoteRequest) => void) | undefined;
  /** Bumped by the parent after a quote is sent so the list refreshes. */
  refreshKey?: number | undefined;
}

/** F-13: quote requests sent from vendor pages, seen from either house. */
export function QuoteRequestsList({ houseId, side, api = quoteRequestApi, onWriteQuote, refreshKey }: Props) {
  const [rows, setRows] = useState<QuoteRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.list(houseId));
    } catch {
      setRows(null);
      setError("We couldn't load quote requests.");
    }
  }, [api, houseId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function respond(id: string, status: "declined" | "withdrawn") {
    setPendingId(id);
    try {
      await api.respond(id, status);
      await load();
    } catch {
      setError(QUOTE_ERROR_COPY.unknown);
    } finally {
      setPendingId(null);
    }
  }

  if (error) {
    return (
      <section role="status" className="surface p-5 text-sm text-ink">
        {error}{" "}
        <button type="button" className="font-semibold text-plum-800 underline" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }
  if (rows === null) {
    return <p role="status" className="surface p-5 text-sm text-ink-muted">Loading quote requests…</p>;
  }
  if (rows.length === 0) {
    return (
      <section className="surface p-5 text-sm text-ink-muted" data-testid="requests-empty">
        {side === "vendor"
          ? "No quote requests yet. Hosts can ask you for a quote from your public profile."
          : "You haven't asked any vendor for a quote yet. Browse vendors and press “Request a quote”."}
      </section>
    );
  }

  return (
    <section className="surface p-5" aria-labelledby="requests-title" data-testid="quote-requests">
      <h2 id="requests-title" className="font-display text-xl font-bold text-plum-950">Quote requests</h2>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.request_id} className="rounded-2xl border border-plum-900/10 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-plum-900">{r.counterparty_name}</p>
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {REQUEST_STATUS_LABELS[r.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink">
              {r.service_date}
              {r.guest_count ? ` · ${r.guest_count} guests` : ""}
              {r.budget_minor !== null ? ` · budget ${formatMoney(r.budget_minor, r.currency)}` : ""}
            </p>
            {r.notes && <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{r.notes}</p>}
            {r.status === "open" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {side === "vendor" && onWriteQuote && (
                  <button type="button" className="btn-primary min-h-[44px] px-4 text-sm" onClick={() => onWriteQuote(r)}>
                    Write a quote
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline min-h-[44px] px-4 text-sm"
                  disabled={pendingId === r.request_id}
                  onClick={() => void respond(r.request_id, side === "vendor" ? "declined" : "withdrawn")}
                >
                  {side === "vendor" ? "Decline" : "Withdraw"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
