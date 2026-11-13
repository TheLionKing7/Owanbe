/**
 * F-14 quote contracts and domain rules.
 * The database (supabase/migrations/20261104120000_f14_quotes.sql) is the enforcement point;
 * everything here is input validation at the trust boundary plus the mirror the UI uses to
 * decide which actions to offer. Money is integer minor units end to end — never a float.
 */
import { z } from "zod";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "countered",
  "accepted",
  "declined",
  "expired",
  "cancelled",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type QuoteSide = "host" | "vendor";

export const quoteLineSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give this line a name")
    .max(120, "Keep the name under 120 characters"),
  line_total_minor: z.number().int("Use whole currency units").min(0, "A line cannot be negative"),
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quoteLinesSchema = z
  .array(quoteLineSchema)
  .max(100, "Split the offer into fewer lines");

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => /^[A-Z]{3}$/.test(value), "Use a three-letter currency code such as NGN");

export const serviceDateSchema = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "Pick the celebration date");

export const newQuoteSchema = z.object({
  vendor_house_id: z.string().uuid(),
  host_house_id: z.string().uuid(),
  service_date: serviceDateSchema,
  currency: currencySchema,
  title: z
    .string()
    .trim()
    .min(1, "Name this quote")
    .max(120, "Keep the title under 120 characters"),
  inclusions: quoteLinesSchema,
  extras: quoteLinesSchema,
});
export type NewQuote = z.input<typeof newQuoteSchema>;

export const revisionSchema = newQuoteSchema
  .pick({ title: true, inclusions: true, extras: true })
  .extend({
    message: z.string().trim().max(2000, "Keep the note under 2000 characters").optional(),
  });
export type RevisionInput = z.input<typeof revisionSchema>;

export const counterSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Say what you would like changed")
    .max(2000, "Keep the note under 2000 characters"),
});
export type CounterInput = z.input<typeof counterSchema>;

export const dailyCapacitySchema = z.number().int().min(1).max(100);

/** The 24-hour expiry is a fixed constant; the deadline itself always comes from the server. */
export const QUOTE_EXPIRY_HOURS = 24;

export function sumLines(lines: readonly QuoteLine[]): number {
  return lines.reduce((total, line) => total + line.line_total_minor, 0);
}

export function quoteTotal(inclusions: readonly QuoteLine[], extras: readonly QuoteLine[]): number {
  return sumLines(inclusions) + sumLines(extras);
}

const exponentCache = new Map<string, number>();

function currencyExponent(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;
  let exponent = 2;
  try {
    exponent =
      new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions()
        .minimumFractionDigits ?? 2;
  } catch {
    exponent = 2; // unknown code: fall back to the common two-decimal display
  }
  exponentCache.set(currency, exponent);
  return exponent;
}

/** Display only. Storage and arithmetic stay in integer minor units. */
export function formatMinor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const value = minor / 10 ** exponent;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(exponent)}`;
  }
}

export function toMinor(units: string, currency: string): number | null {
  const trimmed = units.trim();
  if (!trimmed) return null;
  const exponent = currencyExponent(currency);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 10 ** exponent);
}

/** Decimal string for an amount input; the reverse of toMinor. */
export function fromMinor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Awaiting the host",
  countered: "Host countered",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Withdrawn",
};

/** Which side still has something to do. The database re-checks every transition. */
export function isOpen(status: QuoteStatus): boolean {
  return status === "draft" || status === "sent" || status === "countered";
}

export interface QuoteActions {
  send: boolean;
  revise: boolean;
  cancel: boolean;
  accept: boolean;
  decline: boolean;
  counter: boolean;
}

export function actionsFor(status: QuoteStatus, side: QuoteSide): QuoteActions {
  const none: QuoteActions = {
    send: false,
    revise: false,
    cancel: false,
    accept: false,
    decline: false,
    counter: false,
  };
  if (side === "vendor") {
    if (status === "draft") return { ...none, send: true, revise: true, cancel: true };
    if (status === "countered") return { ...none, send: true, revise: true, cancel: true };
    if (status === "sent") return { ...none, cancel: true };
    return none;
  }
  if (status === "sent" || status === "countered") {
    return { ...none, accept: true, decline: true, counter: true };
  }
  return none;
}

export interface Countdown {
  expired: boolean;
  remainingMs: number;
  hours: number;
  minutes: number;
  label: string;
}

/**
 * Renders a deadline the server set. `expiresAt` is authoritative; this never starts a
 * business timer of its own, it only describes the time left at `now`.
 */
export function countdownFrom(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): Countdown | null {
  if (!expiresAt) return null;
  const deadline = new Date(expiresAt).getTime();
  if (Number.isNaN(deadline)) return null;
  const remainingMs = deadline - now.getTime();
  if (remainingMs <= 0) {
    return { expired: true, remainingMs: 0, hours: 0, minutes: 0, label: "This offer has expired" };
  }
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    expired: false,
    remainingMs,
    hours,
    minutes,
    label: hours > 0 ? `${hours}h ${minutes}m left to respond` : `${minutes}m left to respond`,
  };
}

/**
 * The copy for the deadline a host counter starts. A countered quote is waiting for the vendor,
 * so the window belongs to them; the host is told how long the vendor has.
 */
export function counterDeadlineLabel(side: QuoteSide, countdown: Countdown): string {
  if (countdown.expired) {
    return side === "vendor"
      ? "Your time to respond has run out"
      : "The vendor's time to respond has run out";
  }
  const window = `${countdown.hours}h ${countdown.minutes}m`;
  return side === "vendor"
    ? `You have ${window} to respond. After that the offer expires and the date is released.`
    : `The vendor has ${window} to respond. After that the offer expires and the date is released.`;
}
