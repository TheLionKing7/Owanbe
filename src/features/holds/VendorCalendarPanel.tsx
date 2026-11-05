import { useCallback, useEffect, useState } from "react";
import { formatMinor } from "@/features/quotes/contracts";
import { QUOTE_ERROR_COPY, QuoteError } from "@/features/quotes/api";
import { holdsApi, type HoldsApi } from "./api";
import {
  HOLD_LABELS,
  HOLD_TONE,
  RELEASE_COPY,
  REFUND_COPY,
  groupByDate,
  paymentWindow,
  type HoldSummary,
} from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

interface VendorCalendarPanelProps {
  house: HouseSummary;
  /** Injected in tests; defaults to the Supabase RPC boundary. */
  api?: HoldsApi | undefined;
}

function messageFor(error: unknown): string {
  if (error instanceof QuoteError) return QUOTE_ERROR_COPY[error.code];
  return QUOTE_ERROR_COPY.unknown;
}

function HoldRow({ hold, now }: { hold: HoldSummary; now: Date }) {
  const pay = hold.status === "awaiting_payment" ? paymentWindow(hold.payment_due_at, now) : null;

  return (
    <li
      className="rounded-2xl bg-cream-50 p-4"
      data-testid="calendar-hold"
      data-status={hold.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-semibold text-plum-900">
          {hold.title ?? "Untitled quote"} ·{" "}
          <span className="font-normal text-ink-muted">
            {hold.is_vendor_side ? "For" : "From"} {hold.counterparty_name ?? "the other house"}
          </span>
        </p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${HOLD_TONE[hold.status]}`}
          data-testid="calendar-hold-status"
        >
          {HOLD_LABELS[hold.status]}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-muted">
        Slot {hold.lock_slot} of {hold.daily_capacity} per day.
      </p>

      {pay && (
        <p
          className={`mt-2 text-sm font-semibold ${pay.open ? "text-plum-900" : "text-ink-muted"}`}
          data-testid="calendar-hold-window"
        >
          {pay.label}
          {pay.open &&
            " Payment is collected in the checkout flow; this calendar only shows what the database has recorded."}
        </p>
      )}

      {hold.status === "confirmed" && hold.paid_minor !== null && hold.paid_currency !== null && (
        <p className="mt-2 text-sm text-owanbe-emerald-green" data-testid="calendar-hold-paid">
          {formatMinor(hold.paid_minor, hold.paid_currency)} received on{" "}
          {hold.confirmed_at?.slice(0, 10)} — this date is yours.
        </p>
      )}

      {hold.status === "released" && hold.release_reason && (
        <p className="mt-2 text-sm text-ink-muted" data-testid="calendar-hold-release">
          {RELEASE_COPY[hold.release_reason]}
        </p>
      )}

      {hold.refund_minor !== null &&
        hold.refund_currency !== null &&
        hold.refund_reason !== null && (
          <p
            className="mt-2 text-sm font-semibold text-owanbe-vibrant-red"
            data-testid="calendar-hold-refund"
          >
            {formatMinor(hold.refund_minor, hold.refund_currency)} owed back.{" "}
            {REFUND_COPY[hold.refund_reason]}
          </p>
        )}
    </li>
  );
}

export function VendorCalendarPanel({ house, api = holdsApi }: VendorCalendarPanelProps) {
  const [holds, setHolds] = useState<HoldSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Display clock only: the window itself is a deadline the database wrote.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHolds(await api.holds(house.house_id));
    } catch (caught) {
      setHolds(null);
      setError(messageFor(caught));
    }
  }, [api, house.house_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = groupByDate(holds ?? []);
  const isVendor = house.kind === "vendor";

  return (
    <div className="space-y-6" data-testid="calendar-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {isVendor
            ? "A date is yours once a payment for it is recorded. Until then it is held for 24 hours and other houses can still reach it."
            : "Dates you accepted, and where each one stands."}
        </p>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-2 text-sm"
          onClick={() => void load()}
          data-testid="calendar-refresh"
        >
          Refresh
        </button>
      </div>

      {holds === null && !error && (
        <p
          role="status"
          className="surface p-6 text-sm text-ink-muted"
          data-testid="calendar-loading"
        >
          Loading your dates…
        </p>
      )}

      {error && (
        <section role="alert" className="surface p-6" data-testid="calendar-error">
          <h2 className="font-display text-xl font-bold text-plum-950">
            We could not load your dates
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <button
            type="button"
            className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}

      {holds !== null && holds.length === 0 && (
        <section className="surface p-6" data-testid="calendar-empty">
          <h2 className="font-display text-xl font-bold text-plum-950">No dates held yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {isVendor
              ? "When a host accepts one of your quotes, that celebration date appears here with the payment window the server set."
              : "When you accept a quote, the date and its payment window appear here."}
          </p>
        </section>
      )}

      {groups.map((group) => (
        <section
          key={group.service_date}
          className="surface p-5"
          aria-labelledby={`calendar-${group.service_date}`}
          data-testid="calendar-date"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id={`calendar-${group.service_date}`}
              className="font-display text-xl font-bold text-plum-950"
            >
              <time dateTime={group.service_date}>{group.service_date}</time>
            </h2>
            <p className="text-sm font-semibold text-ink-muted" data-testid="calendar-date-summary">
              {group.capacity === null
                ? `${group.confirmed} secured`
                : `${group.confirmed} of ${group.capacity} secured`}
              {group.awaiting > 0 && ` · ${group.awaiting} awaiting payment`}
              {group.is_contested && " · competing"}
            </p>
          </div>
          <ol className="mt-4 space-y-3">
            {group.holds.map((hold) => (
              <HoldRow key={hold.hold_id} hold={hold} now={now} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
