import { useCallback, useEffect, useState } from "react";
import { holdsApi, type HoldsApi } from "@/features/holds/api";
import type { HoldSummary } from "@/features/holds/contracts";
import {
  QUOTE_ERROR_COPY,
  QuoteError,
  quoteApi,
  type QuoteApi,
  type QuoteRevision,
  type QuoteSummary,
} from "./api";
import { QuoteCard, type QuoteAction, type QuoteActionDetail } from "./QuoteCard";
import { QuoteBuilder, type BuilderValues } from "./QuoteBuilder";
import { QuoteRequestsList } from "./QuoteRequestsList";
import { quoteRequestApi, type QuoteRequest, type QuoteRequestApi } from "./requests";
import { dailyCapacitySchema, type QuoteSide } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

interface QuotesPanelProps {
  house: HouseSummary;
  side: QuoteSide;
  /** Prefill for the vendor builder; the enquiry rail that supplies these arrives with F-19/F-13. */
  hostHint?: string | null | undefined;
  dateHint?: string | null | undefined;
  /** Injected in tests; defaults to the Supabase RPC boundary. */
  api?: QuoteApi | undefined;
  /** F-38 payment windows for the accepted quotes on this list. */
  holdApi?: HoldsApi | undefined;
  /** F-13 quote requests from vendor pages. */
  requestApi?: QuoteRequestApi | undefined;
}

interface QuoteState {
  revisions: QuoteRevision[] | null;
  pending: QuoteAction | null;
  error: string | null;
}

const EMPTY_STATE: Record<QuoteSide, { title: string; body: string }> = {
  host: {
    title: "No quotes yet",
    body: "Quotes from vendors will appear here. Each one shows what is included, the total and how long you have left to respond.",
  },
  vendor: {
    title: "No quotes yet",
    body: "Write your first quote for a host house. It stays a draft until you send it, and sending holds that date for 24 hours.",
  },
};

function messageFor(error: unknown): string {
  if (error instanceof QuoteError) return QUOTE_ERROR_COPY[error.code];
  return QUOTE_ERROR_COPY.unknown;
}

export function QuotesPanel({
  house,
  side,
  hostHint,
  dateHint,
  api = quoteApi,
  holdApi = holdsApi,
  requestApi = quoteRequestApi,
}: QuotesPanelProps) {
  const [fromRequest, setFromRequest] = useState<QuoteRequest | null>(null);
  const [requestsKey, setRequestsKey] = useState(0);
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [holds, setHolds] = useState<Map<string, HoldSummary> | null>(null);
  const [holdsError, setHoldsError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, QuoteState>>({});
  const [builder, setBuilder] = useState<
    null | { mode: "create" } | { mode: "revise"; quote: QuoteSummary; initial: BuilderValues }
  >(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<string | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [capacityPending, setCapacityPending] = useState(false);
  // Display clock only: expiry is decided by the database, never by this interval.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setListError(null);
    let rows: QuoteSummary[] | null = null;
    try {
      rows = await api.list(house.house_id);
      setQuotes(rows);
    } catch (error) {
      setQuotes(null);
      setListError(messageFor(error));
    }
    // A payment window exists only once a quote is accepted, so the holds projection is read for
    // that case alone. Reading it is also what lets the database sweep a lapsed window.
    if (rows?.some((quote) => quote.status === "accepted")) {
      setHoldsError(null);
      try {
        const holdRows = await holdApi.holds(house.house_id);
        setHolds(new Map(holdRows.map((hold) => [hold.quote_id, hold])));
      } catch (error) {
        setHolds(null);
        setHoldsError(messageFor(error));
      }
    } else {
      setHolds(null);
      setHoldsError(null);
    }
  }, [api, holdApi, house.house_id]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(quoteId: string, next: Partial<QuoteState>) {
    setStates((current) => ({
      ...current,
      [quoteId]: { revisions: null, pending: null, error: null, ...current[quoteId], ...next },
    }));
  }

  async function run(quote: QuoteSummary, action: QuoteAction, detail?: QuoteActionDetail) {
    patch(quote.quote_id, { pending: action, error: null });
    try {
      if (action === "send") await api.send(quote.quote_id, quote.version);
      else if (action === "accept") await api.accept(quote.quote_id, quote.version);
      else if (action === "decline") await api.decline(quote.quote_id, quote.version);
      else if (action === "counter")
        await api.counter(quote.quote_id, quote.version, detail?.message ?? "");
      else if (action === "cancel")
        await api.cancel(quote.quote_id, quote.version, detail?.reason ?? null);
      else if (action === "revise") {
        const revisions = await api.history(quote.quote_id);
        const latest = revisions.at(-1);
        if (!latest) throw new QuoteError("not_found", "quote_not_found");
        setBuilder({
          mode: "revise",
          quote,
          initial: {
            host_house_id: quote.counterparty_house,
            service_date: quote.service_date,
            currency: latest.currency,
            title: latest.title,
            inclusions: latest.inclusions,
            extras: latest.extras,
            message: latest.message ?? undefined,
          },
        });
        setBuilderError(null);
        patch(quote.quote_id, { pending: null, revisions });
        return;
      }
      await load();
      patch(quote.quote_id, { pending: null });
    } catch (error) {
      // A stale version means the row moved on: re-read it so the next action uses the new version.
      if (error instanceof QuoteError && error.code === "stale_version") await load();
      patch(quote.quote_id, { pending: null, error: messageFor(error) });
    }
  }

  async function showHistory(quote: QuoteSummary) {
    const state = states[quote.quote_id];
    if (state?.revisions) {
      patch(quote.quote_id, { revisions: null });
      return;
    }
    try {
      patch(quote.quote_id, { revisions: await api.history(quote.quote_id), error: null });
    } catch (error) {
      patch(quote.quote_id, { error: messageFor(error) });
    }
  }

  async function submitBuilder(values: BuilderValues) {
    setBuilderError(null);
    try {
      if (builder?.mode === "revise") {
        await api.revise(builder.quote.quote_id, builder.quote.version, {
          title: values.title,
          inclusions: values.inclusions,
          extras: values.extras,
          message: values.message,
        });
      } else {
        const quoteId = await api.create({
          vendor_house_id: house.house_id,
          host_house_id: values.host_house_id,
          service_date: values.service_date,
          currency: values.currency,
          title: values.title,
          inclusions: values.inclusions,
          extras: values.extras,
        });
        if (fromRequest && fromRequest.host_house_id === values.host_house_id) {
          try {
            await requestApi.respond(fromRequest.request_id, "quoted", quoteId);
          } catch {
            // The quote exists either way; the request simply stays open.
          }
        }
        setFromRequest(null);
        setRequestsKey((k) => k + 1);
      }
      setBuilder(null);
      await load();
    } catch (error) {
      setBuilderError(messageFor(error));
    }
  }

  async function saveCapacity() {
    const parsed = dailyCapacitySchema.safeParse(Number(capacity));
    if (!parsed.success) {
      setCapacityError("Pick how many celebrations you can serve in one day (1 to 100).");
      return;
    }
    setCapacityError(null);
    setCapacityPending(true);
    try {
      await api.setDailyCapacity(house.house_id, parsed.data);
      await load();
    } catch (error) {
      setCapacityError(messageFor(error));
    } finally {
      setCapacityPending(false);
    }
  }

  const open = (quotes ?? []).filter((quote) =>
    ["draft", "sent", "countered"].includes(quote.status),
  );
  const closed = (quotes ?? []).filter(
    (quote) => !["draft", "sent", "countered"].includes(quote.status),
  );
  const capacityValue = capacity ?? String(quotes?.[0]?.daily_capacity ?? 1);

  return (
    <div className="space-y-6" data-testid="quotes-panel">
      {side === "vendor" && house.role === "owner" && (
        <section className="surface p-5" aria-labelledby="capacity-title">
          <h2 id="capacity-title" className="font-display text-xl font-bold text-plum-950">
            How many celebrations can you serve in one day?
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Sending a quote holds one slot on that date. Quotes beyond this number are still sent,
            but both houses are told the date is competing.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="daily-capacity" className="sr-only">
              Celebrations per day
            </label>
            <input
              id="daily-capacity"
              type="number"
              min={1}
              max={100}
              value={capacityValue}
              onChange={(event) => setCapacity(event.target.value)}
              className="w-28 rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              aria-invalid={Boolean(capacityError)}
              data-testid="capacity-input"
            />
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={capacityPending}
              onClick={() => void saveCapacity()}
              data-testid="capacity-save"
            >
              {capacityPending ? "Saving…" : "Save"}
            </button>
          </div>
          {capacityError && (
            <p role="alert" className="mt-2 text-sm text-owanbe-vibrant-red">
              {capacityError}
            </p>
          )}
        </section>
      )}

      {side === "vendor" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary min-h-[44px] px-6 py-3 text-sm"
            onClick={() => {
              setBuilder(builder?.mode === "create" ? null : { mode: "create" });
              setBuilderError(null);
            }}
            data-testid="new-quote"
          >
            {builder?.mode === "create" ? "Close the quote form" : "Write a quote"}
          </button>
          <button
            type="button"
            className="btn-outline min-h-[44px] px-5 py-3 text-sm"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      )}

      <QuoteRequestsList
        houseId={house.house_id}
        side={side}
        api={requestApi}
        refreshKey={requestsKey}
        onWriteQuote={(request) => {
          setFromRequest(request);
          setBuilder({ mode: "create" });
          setBuilderError(null);
        }}
      />

      {builder?.mode === "create" && (
        <QuoteBuilder
          key={fromRequest?.request_id ?? "new"}
          vendorHouseId={house.house_id}
          mode="create"
          hostHint={fromRequest?.host_house_id ?? hostHint}
          dateHint={fromRequest?.service_date ?? dateHint}
          pending={false}
          error={builderError}
          onSubmit={(values) => void submitBuilder(values)}
          onClose={() => setBuilder(null)}
        />
      )}
      {builder?.mode === "revise" && (
        <QuoteBuilder
          key={builder.quote.quote_id}
          vendorHouseId={house.house_id}
          mode="revise"
          initial={builder.initial}
          pending={false}
          error={builderError}
          onSubmit={(values) => void submitBuilder(values)}
          onClose={() => setBuilder(null)}
        />
      )}

      {quotes === null && !listError && (
        <p
          role="status"
          className="surface p-6 text-sm text-ink-muted"
          data-testid="quotes-loading"
        >
          Loading your quotes…
        </p>
      )}

      {listError && (
        <section role="alert" className="surface p-6" data-testid="quotes-error">
          <h2 className="font-display text-xl font-bold text-plum-950">
            We could not load your quotes
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{listError}</p>
          <button
            type="button"
            className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}

      {holdsError && (
        <section
          role="alert"
          className="rounded-2xl bg-ink-subtle/15 px-4 py-3"
          data-testid="holds-error"
        >
          <p className="text-sm font-semibold text-ink">{holdsError}</p>
          <p className="mt-1 text-sm text-ink-muted">
            Your quotes are still shown below; only the payment windows could not be read.
          </p>
          <button
            type="button"
            className="btn-outline mt-3 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Reload the windows
          </button>
        </section>
      )}

      {quotes !== null && quotes.length === 0 && (
        <section className="surface p-6" data-testid="quotes-empty">
          <h2 className="font-display text-xl font-bold text-plum-950">
            {EMPTY_STATE[side].title}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{EMPTY_STATE[side].body}</p>
        </section>
      )}

      {open.length > 0 && (
        <section aria-labelledby="open-quotes" className="space-y-4">
          <h2 id="open-quotes" className="font-display text-2xl font-bold text-plum-950">
            Open quotes
          </h2>
          {open.map((quote) => (
            <QuoteCard
              key={quote.quote_id}
              quote={quote}
              side={side}
              now={now}
              hold={holds?.get(quote.quote_id) ?? null}
              revisions={states[quote.quote_id]?.revisions ?? null}
              pending={states[quote.quote_id]?.pending ?? null}
              error={states[quote.quote_id]?.error ?? null}
              onAction={(action, detail) => void run(quote, action, detail)}
              onShowHistory={() => void showHistory(quote)}
            />
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <section aria-labelledby="closed-quotes" className="space-y-4">
          <h2 id="closed-quotes" className="font-display text-2xl font-bold text-plum-950">
            Finished quotes
          </h2>
          {closed.map((quote) => (
            <QuoteCard
              key={quote.quote_id}
              quote={quote}
              side={side}
              now={now}
              hold={holds?.get(quote.quote_id) ?? null}
              revisions={states[quote.quote_id]?.revisions ?? null}
              pending={states[quote.quote_id]?.pending ?? null}
              error={states[quote.quote_id]?.error ?? null}
              onAction={(action, detail) => void run(quote, action, detail)}
              onShowHistory={() => void showHistory(quote)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
