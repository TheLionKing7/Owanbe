import { useState } from "react";
import { QuoteError, type QuoteApi } from "@/features/quotes/api";
import { QUOTE_ERROR_COPY } from "@/features/quotes/api";
import {
  actionsFor,
  counterDeadlineLabel,
  countdownFrom,
  formatMinor,
  STATUS_LABELS,
  type QuoteStatus,
} from "@/features/quotes/contracts";
import type { ChatSide, ThreadQuote } from "./contracts";

interface ThreadQuoteCardProps {
  quote: ThreadQuote;
  side: ChatSide;
  /** The thread the counter belongs to. */
  conversationId: string;
  api: QuoteApi;
  /** Called once the counter is recorded, so the thread reads itself again. */
  onCountered(): void;
  /** Render-time clock. The deadline itself always comes from the server. */
  now: Date;
}

/**
 * F-23: the quote a thread is negotiating. The host counters here, in the conversation they are
 * already having; the vendor revises from the quotes panel and the revision comes back here.
 */
export function ThreadQuoteCard({
  quote,
  side,
  conversationId,
  api,
  onCountered,
  now,
}: ThreadQuoteCardProps) {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = quote.status as QuoteStatus;
  const actions = actionsFor(status, side);
  // A countered quote is waiting for the vendor, so the deadline that ends it is the one the
  // counter set, not the one the send set.
  const countered = status === "countered";
  const deadline = countered ? quote.counter_response_due_at : quote.expires_at;
  const countdown = countdownFrom(deadline, now);

  async function sendCounter() {
    const text = message.trim();
    setPending(true);
    setError(null);
    try {
      await api.counter(quote.quote_id, quote.version, text, conversationId);
      setMessage("");
      setOpen(false);
      onCountered();
    } catch (caught) {
      setError(
        caught instanceof QuoteError ? QUOTE_ERROR_COPY[caught.code] : QUOTE_ERROR_COPY.unknown,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      className="surface p-4"
      data-testid="thread-quote"
      data-status={quote.status}
      aria-labelledby={`thread-quote-${quote.quote_id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={`thread-quote-${quote.quote_id}`}
            className="font-display text-base font-bold text-plum-950"
          >
            {quote.title ?? "Quote"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            For <time dateTime={quote.service_date}>{quote.service_date}</time> · revision{" "}
            {quote.current_revision}
          </p>
        </div>
        <span
          className="rounded-full bg-gold-100 px-3 py-1 text-xs font-semibold text-plum-900"
          data-testid="thread-quote-status"
        >
          {STATUS_LABELS[status] ?? quote.status}
        </span>
      </div>

      <p
        className="mt-3 font-display text-2xl font-bold text-plum-900"
        data-testid="thread-quote-total"
      >
        {formatMinor(quote.total_minor, quote.currency)}
      </p>

      {countdown && (
        <p
          className={`mt-3 rounded-2xl px-4 py-2 text-sm font-semibold ${
            countdown.expired ? "bg-ink-subtle/15 text-ink-muted" : "bg-gold-100 text-plum-900"
          }`}
          data-testid="thread-quote-countdown"
          data-deadline={countered ? "counter" : "offer"}
        >
          {countered ? counterDeadlineLabel(side, countdown) : countdown.label}
        </p>
      )}

      {side === "vendor" && (
        <p className="mt-3 text-sm text-ink-muted" data-testid="thread-quote-vendor-note">
          The host can counter this offer here. Your revised offer goes back to them in this thread.
        </p>
      )}

      {side === "host" && actions.counter && !open && (
        <button
          type="button"
          className="btn-outline mt-3 min-h-[44px] px-5 py-2 text-sm"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          data-testid="thread-quote-counter"
        >
          Counter this offer
        </button>
      )}

      {side === "host" && actions.counter && open && (
        <div className="mt-3">
          <label
            htmlFor={`thread-counter-${quote.quote_id}`}
            className="text-sm font-semibold text-ink"
          >
            What would you like changed?
          </label>
          <textarea
            id={`thread-counter-${quote.quote_id}`}
            value={message}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white p-3 text-sm text-ink"
            rows={3}
            data-testid="thread-quote-counter-body"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={pending || !message.trim()}
              onClick={() => void sendCounter()}
              data-testid="thread-quote-counter-submit"
            >
              {pending ? "Sending…" : "Send counter"}
            </button>
            <button
              type="button"
              className="btn-outline min-h-[44px] px-5 py-2 text-sm"
              disabled={pending}
              onClick={() => setOpen(false)}
              data-testid="thread-quote-counter-cancel"
            >
              Keep this offer
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 text-sm font-semibold text-owanbe-vibrant-red"
          data-testid="thread-quote-error"
        >
          {error}
        </p>
      )}
    </article>
  );
}
