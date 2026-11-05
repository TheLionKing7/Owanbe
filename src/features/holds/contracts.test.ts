import { describe, expect, it } from "vitest";
import {
  groupByDate,
  holdCopy,
  PAYMENT_WINDOW_HOURS,
  paymentWindow,
  unreadCount,
  type HoldSummary,
  type HouseAlert,
} from "./contracts";

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function hold(overrides: Partial<HoldSummary> = {}): HoldSummary {
  return {
    hold_id: "h-1",
    quote_id: "q-1",
    title: "Wedding reception",
    service_date: "2026-12-05",
    status: "awaiting_payment",
    payment_due_at: inHours(PAYMENT_WINDOW_HOURS),
    confirmed_at: null,
    released_at: null,
    release_reason: null,
    lock_slot: 1,
    daily_capacity: 1,
    competing: false,
    is_vendor_side: true,
    counterparty_house: "host-1",
    counterparty_name: "The Ogun wedding",
    paid_minor: null,
    paid_currency: null,
    refund_minor: null,
    refund_currency: null,
    refund_reason: null,
    ...overrides,
  };
}

function alert(overrides: Partial<HouseAlert> = {}): HouseAlert {
  return {
    id: "a-1",
    kind: "date_secured",
    title: "Date secured",
    body: "Payment recorded.",
    payload: { quote_id: "q-1" },
    read_at: null,
    created_at: "2026-11-04T09:00:00.000Z",
    ...overrides,
  };
}

describe("payment window wording", () => {
  it("describes the deadline the server wrote", () => {
    const open = paymentWindow(inHours(5), new Date());
    expect(open.open).toBe(true);
    expect(open.label).toMatch(/^5h \d+m left to pay$/);
    expect(PAYMENT_WINDOW_HOURS).toBe(24);
  });

  it("never claims time is left once the deadline passed", () => {
    const closed = paymentWindow(inHours(-1), new Date());
    expect(closed).toEqual({
      open: false,
      hours: 0,
      minutes: 0,
      label: "The payment window has closed",
    });
    expect(paymentWindow("not a date", new Date()).open).toBe(false);
  });

  it("starts the hold copy from the same server deadline", () => {
    expect(holdCopy(hold({ payment_due_at: inHours(2) }), new Date())).toMatch(/left to pay$/);
  });
});

describe("hold copy", () => {
  it("states that a confirmed payment made the date theirs", () => {
    expect(holdCopy(hold({ status: "confirmed", confirmed_at: "2026-11-04T10:00:00.000Z" }))).toBe(
      "Secured on 2026-11-04.",
    );
  });

  it("explains each release reason in plain language", () => {
    expect(holdCopy(hold({ status: "released", release_reason: "payment_window_closed" }))).toMatch(
      /payment window closed/i,
    );
    expect(holdCopy(hold({ status: "released", release_reason: "outbid" }))).toMatch(
      /another payment/i,
    );
  });

  it("adds the refund obligation when one was recorded", () => {
    const text = holdCopy(
      hold({
        status: "released",
        release_reason: "outbid",
        refund_minor: 175_000,
        refund_currency: "NGN",
        refund_reason: "outbid",
      }),
    );
    expect(text).toMatch(/another payment/i);
    expect(text).toMatch(/owed back/i);
  });
});

describe("calendar grouping", () => {
  it("keeps one group per service date and counts what is secured", () => {
    const groups = groupByDate([
      hold({ hold_id: "h-1", service_date: "2026-12-05", status: "confirmed" }),
      hold({ hold_id: "h-2", service_date: "2026-12-05", status: "released" }),
      hold({ hold_id: "h-3", service_date: "2026-12-12", status: "awaiting_payment" }),
    ]);
    expect(groups.map((group) => group.service_date)).toEqual(["2026-12-12", "2026-12-05"]);
    expect(groups[1]?.confirmed).toBe(1);
    expect(groups[1]?.holds).toHaveLength(2);
    expect(groups[1]?.is_contested).toBe(true);
    expect(groups[0]?.awaiting).toBe(1);
    expect(groups[0]?.capacity).toBe(1);
  });

  it("refuses a single capacity figure when a host holds two different vendors", () => {
    const groups = groupByDate([
      hold({ hold_id: "h-1", daily_capacity: 1, is_vendor_side: false }),
      hold({ hold_id: "h-2", daily_capacity: 3, is_vendor_side: false }),
    ]);
    expect(groups[0]?.capacity).toBeNull();
  });

  it("counts refunds on the date so a lost payment is visible", () => {
    const groups = groupByDate([
      hold({
        status: "released",
        release_reason: "payment_window_closed",
        refund_minor: 50_000,
        refund_currency: "NGN",
        refund_reason: "late_payment",
      }),
    ]);
    expect(groups[0]?.refunded).toBe(1);
  });

  it("returns nothing for nothing", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("alert unread count", () => {
  it("counts only the rows the server has not stamped read", () => {
    expect(unreadCount([])).toBe(0);
    expect(
      unreadCount([
        alert({ id: "a-1", read_at: "2026-11-04T10:00:00.000Z" }),
        alert({ id: "a-2" }),
        alert({ id: "a-3" }),
      ]),
    ).toBe(2);
  });
});
