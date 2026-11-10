import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { QUOTE_ERROR_COPY, QuoteError } from "./api";
import { quoteRequestApi, quoteRequestSchema, type QuoteRequestApi } from "./requests";

interface Props {
  vendorSlug: string;
  vendorName: string;
  api?: QuoteRequestApi | undefined;
}

/** F-13: the host's quote request, sent from the vendor's public page. */
export function QuoteRequestForm({ vendorSlug, vendorName, api = quoteRequestApi }: Props) {
  const [date, setDate] = useState("");
  const [guests, setGuests] = useState("");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNeedsSignIn(false);
    const parsed = quoteRequestSchema.safeParse({
      vendor_slug: vendorSlug,
      service_date: date,
      guest_count: guests ? Number(guests) : null,
      budget_naira: budget ? Number(budget.replace(/[,\s]/g, "")) : null,
      notes: notes.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
      return;
    }
    setPending(true);
    try {
      await api.create(parsed.data);
      setSent(true);
    } catch (caught) {
      if (caught instanceof QuoteError && caught.code === "unauthorized") {
        setNeedsSignIn(true);
      } else if (caught instanceof QuoteError && caught.message.includes("too_many_open_requests")) {
        setError(`You already have 3 open requests with ${vendorName}. Wait for a reply first.`);
      } else if (caught instanceof QuoteError) {
        setError(QUOTE_ERROR_COPY[caught.code]);
      } else {
        setNeedsSignIn(true);
      }
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="rounded-3xl bg-muted p-6" data-testid="quote-request-sent">
        <p className="font-semibold text-plum-950">Request sent to {vendorName}</p>
        <p className="mt-1 text-sm text-ink-muted">
          You'll see their quote in your Host house. Prices and dates are only confirmed in a quote.
        </p>
        <Link to="/host/$section" params={{ section: "quotes" }} className="btn-primary mt-4 inline-flex h-11 items-center px-5">
          Go to my quotes
        </Link>
      </div>
    );
  }

  const field = "mt-1 w-full rounded-2xl border border-plum-900/10 bg-card px-3 py-2 text-sm text-ink";
  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-3xl bg-muted p-6" data-testid="quote-request-form">
      <p className="font-semibold text-plum-950">Ask {vendorName} for a quote</p>
      <p className="mt-1 text-sm text-ink-muted">Prices and dates are only confirmed in a quote.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold text-ink">
          Celebration date
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="text-sm font-semibold text-ink">
          Guests (optional)
          <input type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} className={field} />
        </label>
        <label className="text-sm font-semibold text-ink">
          Budget in ₦ (optional)
          <input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} className={field} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-semibold text-ink">
        What do you need? (optional)
        <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
      </label>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-owanbe-vibrant-red">{error}</p>}
      {needsSignIn && (
        <p role="alert" className="mt-3 text-sm text-ink">
          Sign in to your Host house to send this request.{" "}
          <Link to="/sign-in" className="font-semibold text-primary underline">Sign in</Link>
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary mt-4 inline-flex h-11 items-center px-5">
        {pending ? "Sending…" : "Request a quote"}
      </button>
    </form>
  );
}
