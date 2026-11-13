import { useState } from "react";
import type { HoldSummary } from "@/features/holds/contracts";
import { paymentWindow, REFUND_COPY, RELEASE_COPY } from "@/features/holds/contracts";
import type { QuoteRevision, QuoteSummary } from "./api";
import {
  actionsFor,
  counterDeadlineLabel,
  countdownFrom,
  formatMinor,
  STATUS_LABELS,
  type QuoteSide,
} from "./contracts";

export type QuoteAction = "send" | "revise" | "cancel" | "accept" | "decline" | "counter";

export interface QuoteActionDetail {
  message?: string | undefined;
  reason?: string | undefined;
}

interface QuoteCardProps {
  quote: QuoteSummary;
  side: QuoteSide;
  /** Null until the history has been loaded; the database is the only source of revisions. */
  revisions: QuoteRevision[] | null;
  pending: QuoteAction | null;
  error: string | null;
  /** Render-time clock. The deadline itself always comes from the server. */
  now: Date;
  /**
   * F-38 payment hold for this quote, read from `my_date_holds`. Null until the holds projection
   * has been read, so an accepted quote shows no window rather than an invented one.
   */
  hold?: HoldSummary | null | undefined;
  onAction(action: QuoteAction, detail?: QuoteActionDetail): void;
  onShowHistory(): void;
}

const STATUS_TONE: Record<QuoteSummary["status"], string> = {
  draft: "bg-plum-100 text-plum-800",
  sent: "bg-gold-100 text-plum-900",
  countered: "bg-gold-100 text-plum-900",
  accepted: "bg-owanbe-emerald-green/15 text-owanbe-emerald-green",
  declined: "bg-ink-subtle/20 text-ink-muted",
  expired: "bg-ink-subtle/20 text-ink-muted",
  cancelled: "bg-ink-subtle/20 text-ink-muted",
};

export function QuoteCard({
  quote,
  side,
  revisions,
  pending,
  error,
  now,
  hold,
  onAction,
  onShowHistory,
}: QuoteCardProps) {
  const [counterMessage, setCounterMessage] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [mode, setMode] = useState<null | "counter" | "cancel">(null);
  const actions = actionsFor(quote.status, side);
  // A countered quote is waiting for the vendor, so the deadline that ends it is the one the
  // counter set, not the one the send set.
  const countered = quote.status === "countered";
  const deadline = countered ? quote.counter_response_due_at : quote.expires_at;
  const countdown = countdownFrom(deadline, now);
  const pay = hold?.status === "awaiting_payment" ? paymentWindow(hold.payment_due_at, now) : null;
  const busy = pending !== null;

  function submitCounter() {
    if (!counterMessage.trim()) return;
    onAction("counter", { message: counterMessage.trim() });
  }

  return (
    <article
      className="surface p-5 sm:p-6"
      data-testid="quote-card"
      data-status={quote.status}
      aria-labelledby={`quote-${quote.quote_id}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={`quote-${quote.quote_id}-title`}
            className="font-display text-xl font-bold text-plum-950"
          >
            {quote.title ?? "Untitled quote"}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {side === "vendor" ? "For" : "From"}{" "}
            <span className="font-semibold text-ink">
              {quote.counterparty_name ?? "the other house"}
            </span>
            {" · "}
            <time dateTime={quote.service_date}>{quote.service_date}</time>
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONE[quote.status]}`}
          data-testid="quote-status"
        >
          {STATUS_LABELS[quote.status]}
        </span>
      </div>

      <p className="mt-4 font-display text-3xl font-bold text-plum-900" data-testid="quote-total">
        {formatMinor(quote.total_minor, quote.currency)}
      </p>
      <p className="mt-1 text-xs text-ink-subtle">
        Revision {quote.current_revision} · the total is derived from the line items in the database
      </p>

      {countdown && (
        <p
          className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ${
            countdown.expired ? "bg-ink-subtle/15 text-ink-muted" : "bg-gold-100 text-plum-900"
          }`}
          data-testid="quote-countdown"
          data-deadline={countered ? "counter" : "offer"}
        >
          {countered ? counterDeadlineLabel(side, countdown) : countdown.label}
        </p>
      )}

      {quote.lock_slot !== null && (
        <p className="mt-3 text-sm text-ink-muted" data-testid="quote-lock">
          {quote.service_date} hold: slot {quote.lock_slot} of {quote.daily_capacity} per day.
          {quote.competing && (
            <span
              className="mt-1 block font-semibold text-owanbe-vibrant-red"
              data-testid="quote-competing"
            >
              This date is already fully held. Accepting still records the booking, but it competes
              with another quote for the same day.
            </span>
          )}
        </p>
      )}

      {hold?.status === "awaiting_payment" && pay && (
        <p
          className={`mt-3 rounded-2xl px-4 py-3 text-sm font-semibold ${
            pay.open ? "bg-gold-100 text-plum-900" : "bg-ink-subtle/15 text-ink-muted"
          }`}
          data-testid="quote-payment-window"
        >
          {pay.label}
          {pay.open
            ? " The date is yours until the window closes. Nothing here is a payment button — the checkout records it."
            : " The window closed, so the date is free again. A payment that lands now is recorded as owed back."}
        </p>
      )}

      {hold?.status === "confirmed" && (
        <p
          className="mt-3 rounded-2xl bg-owanbe-emerald-green/15 px-4 py-3 text-sm font-semibold text-owanbe-emerald-green"
          data-testid="quote-payment-window"
        >
          Payment recorded{hold.confirmed_at ? ` on ${hold.confirmed_at.slice(0, 10)}` : ""}
          {hold.paid_minor !== null && hold.paid_currency !== null
            ? ` · ${formatMinor(hold.paid_minor, hold.paid_currency)}`
            : ""}
          . This date is yours.
        </p>
      )}

      {hold?.status === "released" && (
        <p
          className="mt-3 rounded-2xl bg-ink-subtle/15 px-4 py-3 text-sm text-ink-muted"
          data-testid="quote-payment-window"
        >
          {hold.release_reason ? RELEASE_COPY[hold.release_reason] : "This date was released."}
          {hold.refund_minor !== null && hold.refund_currency !== null && hold.refund_reason
            ? ` ${formatMinor(hold.refund_minor, hold.refund_currency)} owed back. ${REFUND_COPY[hold.refund_reason]}`
            : ""}
        </p>
      )}

      {quote.close_note && !["expired"].includes(quote.status) && (
        <p className="mt-3 text-sm text-ink-muted">Note: {quote.close_note}</p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-owanbe-vibrant-red/10 px-4 py-3 text-sm font-semibold text-owanbe-vibrant-red"
        >
          {error}
        </p>
      )}

      {mode === "counter" && (
        <div className="mt-4">
          <label htmlFor={`counter-${quote.quote_id}`} className="text-sm font-semibold text-ink">
            What would you like changed?
          </label>
          <textarea
            id={`counter-${quote.quote_id}`}
            value={counterMessage}
            maxLength={2000}
            onChange={(event) => setCounterMessage(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white p-3 text-sm text-ink"
            rows={3}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={busy || !counterMessage.trim()}
              onClick={submitCounter}
              data-testid="counter-submit"
            >
              {pending === "counter" ? "Sending…" : "Send counter"}
            </button>
            <button
              type="button"
              className="btn-outline min-h-[44px] px-5 py-2 text-sm"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Keep this offer
            </button>
          </div>
        </div>
      )}

      {mode === "cancel" && (
        <div className="mt-4">
          <label htmlFor={`cancel-${quote.quote_id}`} className="text-sm font-semibold text-ink">
            Reason (optional, shared with the other house)
          </label>
          <input
            id={`cancel-${quote.quote_id}`}
            value={cancelReason}
            maxLength={500}
            onChange={(event) => setCancelReason(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white p-3 text-sm text-ink"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={busy}
              onClick={() => onAction("cancel", { reason: cancelReason.trim() || undefined })}
              data-testid="cancel-submit"
            >
              {pending === "cancel" ? "Withdrawing…" : "Withdraw this quote"}
            </button>
            <button
              type="button"
              className="btn-outline min-h-[44px] px-5 py-2 text-sm"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Back
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {actions.accept && (
          <button
            type="button"
            className="btn-primary min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => onAction("accept")}
            data-testid="action-accept"
          >
            {pending === "accept" ? "Accepting…" : "Accept"}
          </button>
        )}
        {actions.send && (
          <button
            type="button"
            className="btn-primary min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => onAction("send")}
            data-testid="action-send"
          >
            {pending === "send" ? "Sending…" : quote.sent_at ? "Send revision" : "Send quote"}
          </button>
        )}
        {actions.revise && (
          <button
            type="button"
            className="btn-outline min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => onAction("revise")}
            data-testid="action-revise"
          >
            Edit offer
          </button>
        )}
        {actions.counter && mode !== "counter" && (
          <button
            type="button"
            className="btn-outline min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => setMode("counter")}
            data-testid="action-counter"
          >
            Counter
          </button>
        )}
        {actions.decline && (
          <button
            type="button"
            className="btn-outline min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => onAction("decline")}
            data-testid="action-decline"
          >
            {pending === "decline" ? "Declining…" : "Decline"}
          </button>
        )}
        {actions.cancel && mode !== "cancel" && (
          <button
            type="button"
            className="btn-outline min-h-[44px] px-5 py-2 text-sm"
            disabled={busy}
            onClick={() => setMode("cancel")}
            data-testid="action-cancel"
          >
            Withdraw
          </button>
        )}
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-2 text-sm"
          disabled={busy}
          onClick={onShowHistory}
          data-testid="action-history"
        >
          {revisions ? "Hide history" : "Show history"}
        </button>
      </div>

      {revisions && (
        <ol className="mt-5 space-y-3 border-t border-plum-900/10 pt-4" data-testid="quote-history">
          {revisions.map((revision) => (
            <li key={revision.number} className="rounded-2xl bg-cream-50 p-4">
              <p className="text-sm font-semibold text-plum-900">
                Revision {revision.number} ·{" "}
                {revision.authored_by_role === "vendor" ? "vendor" : "host"}
                {" · "}
                {formatMinor(revision.total_minor, revision.currency)}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{revision.title}</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                {revision.inclusions.map((line) => (
                  <li
                    key={`i-${revision.number}-${line.label}`}
                    className="flex justify-between gap-4"
                  >
                    <span>{line.label}</span>
                    <span>{formatMinor(line.line_total_minor, revision.currency)}</span>
                  </li>
                ))}
                {revision.extras.map((line) => (
                  <li
                    key={`e-${revision.number}-${line.label}`}
                    className="flex justify-between gap-4"
                  >
                    <span>{line.label} (extra)</span>
                    <span>{formatMinor(line.line_total_minor, revision.currency)}</span>
                  </li>
                ))}
              </ul>
              {revision.message && (
                <p className="mt-2 text-sm italic text-ink-muted">“{revision.message}”</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
