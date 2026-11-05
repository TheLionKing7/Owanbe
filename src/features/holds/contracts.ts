/**
 * F-38 vendor calendar soft-hold contracts.
 * The enforcement point is supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql:
 * this module mirrors its `my_date_holds` and `my_notifications` projections for display and
 * puts the server's `payment_due_at` into words. It never decides a deadline of its own and
 * never records a payment — confirmation is a service-role function no browser can call.
 */
import { countdownFrom } from "@/features/quotes/contracts";

export const HOLD_STATUSES = ["awaiting_payment", "confirmed", "released"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const RELEASE_REASONS = ["payment_window_closed", "outbid"] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export const REFUND_REASONS = ["outbid", "late_payment"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const ALERT_KINDS = [
  "date_competing",
  "date_secured",
  "date_outbid",
  "payment_window_closed",
  "refund_pending",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Mirrors `public.quote_payment_holds.payment_due_at` set by the database on acceptance. */
export const PAYMENT_WINDOW_HOURS = 24;

/** Exactly the columns of `public.my_date_holds(p_house)`, in that order. */
export interface HoldSummary {
  hold_id: string;
  quote_id: string;
  title: string | null;
  service_date: string;
  status: HoldStatus;
  payment_due_at: string;
  confirmed_at: string | null;
  released_at: string | null;
  release_reason: ReleaseReason | null;
  lock_slot: number;
  daily_capacity: number;
  competing: boolean;
  is_vendor_side: boolean;
  counterparty_house: string;
  counterparty_name: string | null;
  paid_minor: number | null;
  paid_currency: string | null;
  refund_minor: number | null;
  refund_currency: string | null;
  refund_reason: RefundReason | null;
}

/** Exactly the columns of `public.my_notifications(p_house)`. */
export interface HouseAlert {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  /** Identifiers only — the database never puts offer contents or payment references in here. */
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export const HOLD_LABELS: Record<HoldStatus, string> = {
  awaiting_payment: "Awaiting payment",
  confirmed: "Date secured",
  released: "Date released",
};

export const HOLD_TONE: Record<HoldStatus, string> = {
  awaiting_payment: "bg-gold-100 text-plum-900",
  confirmed: "bg-owanbe-emerald-green/15 text-owanbe-emerald-green",
  released: "bg-ink-subtle/20 text-ink-muted",
};

export const RELEASE_COPY: Record<ReleaseReason, string> = {
  payment_window_closed:
    "The payment window closed, so this date is free again for another celebration.",
  outbid: "Another payment reached this date first, so it is no longer held for you.",
};

export const REFUND_COPY: Record<RefundReason, string> = {
  outbid: "This payment is owed back: the date was already secured by another celebration.",
  late_payment: "This payment arrived after the date was released, so it is owed back in full.",
};

export const ALERT_TONE: Record<AlertKind, string> = {
  date_competing: "bg-gold-100 text-plum-900",
  date_secured: "bg-owanbe-emerald-green/15 text-owanbe-emerald-green",
  date_outbid: "bg-owanbe-vibrant-red/10 text-owanbe-vibrant-red",
  payment_window_closed: "bg-ink-subtle/20 text-ink-muted",
  refund_pending: "bg-owanbe-vibrant-red/10 text-owanbe-vibrant-red",
};

export interface PaymentWindow {
  open: boolean;
  hours: number;
  minutes: number;
  label: string;
}

/**
 * Reads the deadline the database wrote when the quote was accepted. `paymentDueAt` is
 * authoritative; an expired window only describes what the sweep will release, it never
 * releases anything here.
 */
export function paymentWindow(paymentDueAt: string, now: Date = new Date()): PaymentWindow {
  const countdown = countdownFrom(paymentDueAt, now);
  if (!countdown || countdown.expired) {
    return { open: false, hours: 0, minutes: 0, label: "The payment window has closed" };
  }
  const parts =
    countdown.hours > 0 ? `${countdown.hours}h ${countdown.minutes}m` : `${countdown.minutes}m`;
  return {
    open: true,
    hours: countdown.hours,
    minutes: countdown.minutes,
    label: `${parts} left to pay`,
  };
}

/** One service date as the vendor's calendar sees it. */
export interface DateGroup {
  service_date: string;
  holds: HoldSummary[];
  confirmed: number;
  awaiting: number;
  refunded: number;
  /**
   * The vendor's daily capacity for this date, or null when the holds on it belong to
   * different vendors — a host can be awaiting payment on two houses with different capacities,
   * and no single "n of m" figure is true for that date.
   */
  capacity: number | null;
  is_contested: boolean;
}

export function groupByDate(holds: readonly HoldSummary[]): DateGroup[] {
  const buckets = new Map<string, HoldSummary[]>();
  for (const hold of holds) {
    const existing = buckets.get(hold.service_date);
    if (existing) existing.push(hold);
    else buckets.set(hold.service_date, [hold]);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([service_date, grouped]) => {
      const capacities = new Set(grouped.map((hold) => hold.daily_capacity));
      return {
        service_date,
        holds: grouped,
        confirmed: grouped.filter((hold) => hold.status === "confirmed").length,
        awaiting: grouped.filter((hold) => hold.status === "awaiting_payment").length,
        refunded: grouped.filter((hold) => hold.refund_minor !== null).length,
        capacity: capacities.size === 1 ? (grouped[0]?.daily_capacity ?? null) : null,
        is_contested: grouped.some((hold) => hold.competing || hold.status === "released"),
      };
    });
}

export function unreadCount(alerts: readonly HouseAlert[]): number {
  return alerts.filter((alert) => alert.read_at === null).length;
}

/** Plain-language status line for one hold, derived only from server fields. */
export function holdCopy(hold: HoldSummary, now: Date = new Date()): string {
  if (hold.status === "confirmed") {
    return hold.confirmed_at ? `Secured on ${hold.confirmed_at.slice(0, 10)}.` : "Secured.";
  }
  if (hold.status === "released") {
    const reason = hold.release_reason ? RELEASE_COPY[hold.release_reason] : "Released.";
    return hold.refund_minor !== null && hold.refund_reason
      ? `${reason} ${REFUND_COPY[hold.refund_reason]}`
      : reason;
  }
  return paymentWindow(hold.payment_due_at, now).label;
}
