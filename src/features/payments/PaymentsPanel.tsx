import { useCallback, useEffect, useMemo, useState } from "react";
import type { HouseSummary } from "@/lib/auth/types";
import { formatMoney } from "@/lib/payments/currency";
import { createPaymentsApi, paymentsErrorMessage, type PaymentsApi } from "./api";
import {
  MOVEMENT_LABELS,
  POOL_STATUS_LABELS,
  type BookingFund,
  type BookingSummary,
  type FundMovement,
} from "./contracts";

interface PaymentsPanelProps {
  house: HouseSummary;
  /** Injected in tests; defaults to the authorized RPC projections and the app's own routes. */
  api?: PaymentsApi | undefined;
  /** The caller's token decides what they may see and do; the server never acts as them. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
  /** The reference the provider sent the host back with, when they have just paid. */
  returnedReference?: string | undefined;
}

const NO_TOKEN = async (): Promise<string | null> => null;

function serviceDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A deadline is shown with the reader's own timezone, because it is the reader's deadline. */
function deadlineLabel(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function PaymentsPanel({
  house,
  api,
  getAccessToken,
  returnedReference,
}: PaymentsPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createPaymentsApi(readToken), [api, readToken]);

  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fund, setFund] = useState<BookingFund | null>(null);
  const [movements, setMovements] = useState<FundMovement[] | null>(null);
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [askingRefund, setAskingRefund] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    try {
      setBookings(await client.bookings(house.house_id));
    } catch (caught) {
      setBookings(null);
      setListError(paymentsErrorMessage(caught));
    }
  }, [client, house.house_id]);

  const loadMoney = useCallback(
    async (bookingId: string) => {
      setMoneyError(null);
      try {
        const money = await client.money(bookingId);
        setFund(money.fund);
        setMovements(money.movements);
      } catch (caught) {
        setFund(null);
        setMovements(null);
        setMoneyError(paymentsErrorMessage(caught));
      }
    },
    [client],
  );

  // A host who has just paid comes back with a reference. The server asks the provider what
  // happened; the browser never decides that a payment succeeded.
  useEffect(() => {
    if (!returnedReference) return;
    let cancelled = false;
    void (async () => {
      try {
        await client.verifyPayment(returnedReference);
      } catch {
        // The provider's own webhook is the authority; a failed check here is not the end.
      }
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [client, load, returnedReference]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    async (bookingId: string) => {
      setOpenId(bookingId);
      setActionError(null);
      setPaymentLink(null);
      setAskingRefund(false);
      setRefundReason("");
      await loadMoney(bookingId);
    },
    [loadMoney],
  );

  async function startPayment(bookingId: string) {
    setActionError(null);
    setActionPending(true);
    try {
      const started = await client.startPayment(bookingId);
      setPaymentLink(started.authorization_url);
    } catch (caught) {
      setActionError(paymentsErrorMessage(caught));
    } finally {
      setActionPending(false);
    }
  }

  async function complete(bookingId: string) {
    setActionError(null);
    setActionPending(true);
    try {
      await client.complete(bookingId);
      await loadMoney(bookingId);
      await load();
    } catch (caught) {
      setActionError(paymentsErrorMessage(caught));
    } finally {
      setActionPending(false);
    }
  }

  async function refund(bookingId: string) {
    setActionError(null);
    setActionPending(true);
    try {
      await client.refund(bookingId, refundReason);
      setAskingRefund(false);
      setRefundReason("");
      await loadMoney(bookingId);
      await load();
    } catch (caught) {
      setActionError(paymentsErrorMessage(caught));
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="payments-panel">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-3 text-sm"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {bookings === null && !listError && (
        <p
          role="status"
          className="surface p-6 text-sm text-ink-muted"
          data-testid="payments-loading"
        >
          Loading your payments…
        </p>
      )}

      {listError && (
        <section role="alert" className="surface p-6" data-testid="payments-error">
          <h2 className="font-display text-xl font-bold text-plum-950">
            We could not load your payments
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

      {bookings !== null && bookings.length === 0 && (
        <section className="surface p-6" data-testid="payments-empty">
          <h2 className="font-display text-xl font-bold text-plum-950">No payments yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Once you accept a vendor's quote, the booking and its payment will appear here.
          </p>
        </section>
      )}

      {bookings !== null && bookings.length > 0 && (
        <section aria-labelledby="payments-list" className="space-y-4">
          <h2 id="payments-list" className="font-display text-2xl font-bold text-plum-950">
            Your bookings and payments
          </h2>
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <li key={booking.booking_id} className="surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {booking.is_host_side ? booking.counterparty_name : booking.counterparty_name}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {serviceDateLabel(booking.service_date)} ·{" "}
                      {formatMoney(booking.total_minor, booking.currency)}
                    </p>
                    <p className="text-sm text-ink-subtle" data-testid="pool-status">
                      {POOL_STATUS_LABELS[booking.pool_status] ?? booking.pool_status}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                    onClick={() => void open(booking.booking_id)}
                    data-testid="open-payment"
                    data-booking-id={booking.booking_id}
                  >
                    {openId === booking.booking_id ? "Close" : "Open"}
                  </button>
                </div>

                {openId === booking.booking_id && (
                  <div
                    className="mt-4 border-t border-plum-900/10 pt-4"
                    data-testid="payment-detail"
                  >
                    {fund === null && !moneyError && (
                      <p role="status" className="text-sm text-ink-muted">
                        Loading the money…
                      </p>
                    )}
                    {moneyError && (
                      <div role="alert" data-testid="payment-detail-error">
                        <p className="text-sm text-ink-muted">{moneyError}</p>
                        <button
                          type="button"
                          className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
                          onClick={() => void loadMoney(booking.booking_id)}
                        >
                          Try again
                        </button>
                      </div>
                    )}

                    {fund !== null && (
                      <div className="space-y-4">
                        {fund.frozen && (
                          <p
                            role="alert"
                            className="rounded-2xl bg-owanbe-vibrant-red/10 p-3 text-sm font-semibold text-owanbe-vibrant-red"
                            data-testid="frozen-notice"
                          >
                            This money is on hold while a dispute is open
                            {fund.frozen_reason ? `: ${fund.frozen_reason}` : "."}
                          </p>
                        )}

                        <dl className="grid gap-2 sm:grid-cols-2" data-testid="fund-breakdown">
                          <div>
                            <dt className="text-sm text-ink-muted">Total</dt>
                            <dd className="text-sm font-semibold text-ink">
                              {formatMoney(fund.total_minor, fund.currency)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-sm text-ink-muted">Paid</dt>
                            <dd className="text-sm font-semibold text-ink">
                              {formatMoney(fund.paid_minor, fund.currency)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-sm text-ink-muted">Still held</dt>
                            <dd className="text-sm font-semibold text-ink">
                              {formatMoney(fund.held_minor, fund.currency)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-sm text-ink-muted">Released to the vendor</dt>
                            <dd className="text-sm font-semibold text-ink">
                              {formatMoney(
                                fund.released_70_minor + fund.released_30_minor,
                                fund.currency,
                              )}
                            </dd>
                          </div>
                          {fund.refunded_minor > 0 && (
                            <div>
                              <dt className="text-sm text-ink-muted">Refunded</dt>
                              <dd className="text-sm font-semibold text-ink">
                                {formatMoney(fund.refunded_minor, fund.currency)}
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-sm text-ink-muted">Platform fee</dt>
                            <dd className="text-sm font-semibold text-ink">
                              {formatMoney(fund.commission_minor, fund.currency)}
                            </dd>
                          </div>
                        </dl>

                        {deadlineLabel(fund.release_30_due_at) && (
                          <p className="text-sm text-ink-muted" data-testid="release-deadline">
                            The last payment is released on{" "}
                            <strong className="text-ink">
                              {deadlineLabel(fund.release_30_due_at)}
                            </strong>{" "}
                            unless you tell us there is a problem before then.
                          </p>
                        )}

                        {fund.is_host_side && fund.pool_status === "awaiting_payment" && (
                          <div>
                            <button
                              type="button"
                              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
                              disabled={actionPending}
                              onClick={() => void startPayment(booking.booking_id)}
                              data-testid="start-payment"
                            >
                              {actionPending ? "Starting…" : "Pay now"}
                            </button>
                            {paymentLink && (
                              <p className="mt-2 text-sm text-ink" data-testid="payment-link">
                                <a
                                  href={paymentLink}
                                  className="font-semibold text-plum-800 underline"
                                  rel="noreferrer"
                                >
                                  Continue to the payment page
                                </a>
                              </p>
                            )}
                          </div>
                        )}

                        {fund.is_host_side && fund.booking_status === "paid" && (
                          <button
                            type="button"
                            className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                            disabled={actionPending}
                            onClick={() => void complete(booking.booking_id)}
                            data-testid="complete-booking"
                          >
                            {actionPending ? "Sending…" : "The celebration happened"}
                          </button>
                        )}

                        {fund.is_host_side && fund.held_minor > 0 && fund.refunded_minor === 0 && (
                          <div>
                            {!askingRefund ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                                  onClick={() => setAskingRefund(true)}
                                  data-testid="ask-refund"
                                >
                                  Ask for the money back
                                </button>
                                <p className="mt-2 text-sm text-ink-subtle">
                                  {formatMoney(fund.held_minor, fund.currency)} is still held for
                                  this booking, so it can be refunded. The part already released to
                                  the vendor is settled with the vendor.
                                </p>
                              </>
                            ) : (
                              <div>
                                <label
                                  htmlFor="refund-reason"
                                  className="block text-sm font-semibold text-ink"
                                >
                                  Why do you want the money back?
                                </label>
                                <input
                                  id="refund-reason"
                                  value={refundReason}
                                  onChange={(event) => setRefundReason(event.target.value)}
                                  placeholder="The date changed and we cannot go ahead"
                                  className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                                  data-testid="refund-reason"
                                />
                                <div className="mt-3 flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    className="btn-primary min-h-[44px] px-5 py-2 text-sm"
                                    disabled={actionPending}
                                    onClick={() => void refund(booking.booking_id)}
                                    data-testid="send-refund"
                                  >
                                    {actionPending ? "Sending…" : "Request the refund"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-outline min-h-[44px] px-5 py-2 text-sm"
                                    onClick={() => setAskingRefund(false)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {actionError && (
                          <p
                            role="alert"
                            className="text-sm font-semibold text-owanbe-vibrant-red"
                            data-testid="payment-action-error"
                          >
                            {actionError}
                          </p>
                        )}

                        {movements !== null && movements.length > 0 && (
                          <div data-testid="movements">
                            <h3 className="font-display text-lg font-bold text-plum-950">
                              What moved
                            </h3>
                            <ul className="mt-2 space-y-1">
                              {movements.map((movement, index) => (
                                <li
                                  key={`${movement.movement}-${index}`}
                                  className="text-sm text-ink"
                                >
                                  {MOVEMENT_LABELS[movement.movement] ?? movement.movement} ·{" "}
                                  {formatMoney(movement.amount_minor, movement.currency)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
