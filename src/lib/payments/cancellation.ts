/**
 * F-20 / F-21: who gets what back when a paid booking is cancelled.
 *
 * Owner decisions (2026-11-10):
 *   - Host cancels more than 30 days before the event: 80% back (20% vendor forfeit).
 *   - Host cancels 14 to 30 days before: 50% back.
 *   - Host cancels under 14 days before: nothing back.
 *   - Vendor cancels at any time: the host gets everything back.
 *   - A refund above ₦500,000 needs two different staff approvals.
 *
 * The same rules live in the database (app_private.cancellation_refund_minor). This copy is for
 * the screen preview only; the database figure is the one that is paid.
 */

export type CancelledBy = "host" | "vendor";

/** ₦500,000 in kobo. */
export const DUAL_APPROVAL_THRESHOLD_MINOR = 50_000_000;

export function daysUntil(serviceDate: string, now: Date = new Date()): number {
  const event = Date.UTC(
    Number(serviceDate.slice(0, 4)),
    Number(serviceDate.slice(5, 7)) - 1,
    Number(serviceDate.slice(8, 10)),
  );
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((event - today) / 86_400_000);
}

/** Refund share in percent. */
export function refundPercent(by: CancelledBy, daysBefore: number): number {
  if (by === "vendor") return 100;
  if (daysBefore > 30) return 80;
  if (daysBefore >= 14) return 50;
  return 0;
}

export interface CancellationQuote {
  percent: number;
  refundMinor: number;
  vendorKeepsMinor: number;
  needsSecondApproval: boolean;
}

export function quoteCancellation(
  by: CancelledBy,
  paidMinor: number,
  daysBefore: number,
): CancellationQuote {
  if (!Number.isInteger(paidMinor) || paidMinor < 0) throw new Error("paid_minor_invalid");
  const percent = refundPercent(by, daysBefore);
  const refundMinor = Math.floor((paidMinor * percent) / 100);
  return {
    percent,
    refundMinor,
    vendorKeepsMinor: paidMinor - refundMinor,
    needsSecondApproval: refundMinor > DUAL_APPROVAL_THRESHOLD_MINOR,
  };
}
