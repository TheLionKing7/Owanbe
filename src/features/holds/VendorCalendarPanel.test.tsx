import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteError } from "@/features/quotes/api";
import type { HoldsApi } from "./api";
import { VendorCalendarPanel } from "./VendorCalendarPanel";
import type { HoldSummary } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

const VENDOR_HOUSE: HouseSummary = {
  house_id: "vendor-1",
  kind: "vendor",
  display_name: "Alice Events Ltd",
  role: "owner",
  capabilities: ["quotes", "calendar"],
};
const HOST_HOUSE: HouseSummary = { ...VENDOR_HOUSE, house_id: "host-1", kind: "host" };

function inHours(hours: number): string {
  // A minute of slack: the window label floors to whole minutes, so a deadline built exactly on the
  // hour would already read "5h 59m" by the time the component renders.
  return new Date(Date.now() + hours * 3_600_000 + 60_000).toISOString();
}

function hold(overrides: Partial<HoldSummary> = {}): HoldSummary {
  return {
    hold_id: "h-1",
    quote_id: "q-1",
    title: "Wedding reception",
    service_date: "2026-12-05",
    status: "awaiting_payment",
    payment_due_at: inHours(6),
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

function stubApi(overrides: Partial<HoldsApi> = {}): HoldsApi {
  return {
    holds: vi.fn(async () => [] as HoldSummary[]),
    alerts: vi.fn(async () => []),
    markSeen: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(cleanup);

describe("VendorCalendarPanel", () => {
  it("shows the slots and the payment deadline the server set", async () => {
    const api = stubApi({ holds: vi.fn(async () => [hold()]) });
    render(<VendorCalendarPanel house={VENDOR_HOUSE} api={api} />);

    expect(screen.getByTestId("calendar-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("calendar-hold")).toHaveAttribute(
      "data-status",
      "awaiting_payment",
    );
    expect(api.holds).toHaveBeenCalledWith("vendor-1");
    expect(screen.getByTestId("calendar-date-summary")).toHaveTextContent("0 of 1 secured");
    expect(screen.getByTestId("calendar-hold")).toHaveTextContent("Slot 1 of 1 per day");
    expect(screen.getByTestId("calendar-hold-window").textContent).toMatch(/6h \d+m left to pay/);
  });

  it("never offers a browser a way to record a payment", async () => {
    render(
      <VendorCalendarPanel
        house={VENDOR_HOUSE}
        api={stubApi({ holds: vi.fn(async () => [hold()]) })}
      />,
    );
    await screen.findByTestId("calendar-hold");

    expect(screen.getByTestId("calendar-hold-window")).toHaveTextContent(
      "this calendar only shows what the database has recorded",
    );
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
  });

  it("marks a date secured once the payment is recorded", async () => {
    render(
      <VendorCalendarPanel
        house={VENDOR_HOUSE}
        api={stubApi({
          holds: vi.fn(
            async () =>
              [
                hold({
                  status: "confirmed",
                  confirmed_at: "2026-11-04T10:00:00.000Z",
                  paid_minor: 1_250_000,
                  paid_currency: "NGN",
                }),
              ] as HoldSummary[],
          ),
        })}
      />,
    );

    expect(await screen.findByTestId("calendar-hold-paid")).toHaveTextContent(/12,?500\.00/);
    expect(screen.getByTestId("calendar-date-summary")).toHaveTextContent("1 of 1 secured");
    expect(screen.getByTestId("calendar-hold-status")).toHaveTextContent("Date secured");
  });

  it("explains an outbid date and the money owed back", async () => {
    render(
      <VendorCalendarPanel
        house={VENDOR_HOUSE}
        api={stubApi({
          holds: vi.fn(
            async () =>
              [
                hold({
                  status: "released",
                  released_at: "2026-11-04T11:00:00.000Z",
                  release_reason: "outbid",
                  refund_minor: 175_000,
                  refund_currency: "NGN",
                  refund_reason: "outbid",
                }),
              ] as HoldSummary[],
          ),
        })}
      />,
    );

    expect(await screen.findByTestId("calendar-hold-release")).toHaveTextContent(
      "Another payment reached this date first",
    );
    expect(screen.getByTestId("calendar-hold-refund")).toHaveTextContent(/1,?750\.00 owed back/);
  });

  it("says so when there are no dates yet", async () => {
    render(<VendorCalendarPanel house={VENDOR_HOUSE} api={stubApi()} />);
    expect(await screen.findByTestId("calendar-empty")).toHaveTextContent("No dates held yet");
  });

  it("retries when the holds projection cannot be read", async () => {
    const holds = vi
      .fn()
      .mockRejectedValueOnce(new QuoteError("forbidden", "forbidden: calendar in house"))
      .mockResolvedValueOnce([hold()]);
    render(<VendorCalendarPanel house={HOST_HOUSE} api={stubApi({ holds })} />);

    expect(await screen.findByTestId("calendar-error")).toHaveTextContent(
      "Your account cannot do that in this house.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("calendar-hold")).toBeInTheDocument();
    expect(holds).toHaveBeenCalledTimes(2);
  });

  it("keeps the holds on one date in one group", async () => {
    render(
      <VendorCalendarPanel
        house={VENDOR_HOUSE}
        api={stubApi({
          holds: vi.fn(
            async () =>
              [
                hold({ hold_id: "h-1", lock_slot: 1, status: "confirmed" }),
                hold({ hold_id: "h-2", lock_slot: 2, competing: true, quote_id: "q-2" }),
                hold({ hold_id: "h-3", service_date: "2026-12-20", quote_id: "q-3" }),
              ] as HoldSummary[],
          ),
        })}
      />,
    );

    const dates = await screen.findAllByTestId("calendar-date");
    expect(dates).toHaveLength(2);
    // Newest date first, the way the projection orders it.
    expect(dates[0]?.querySelector("time")?.textContent).toBe("2026-12-20");
    expect(dates[1]?.querySelector("time")?.textContent).toBe("2026-12-05");
    expect(within(dates[1]!).getAllByTestId("calendar-hold")).toHaveLength(2);
    expect(within(dates[1]!).getByTestId("calendar-date-summary").textContent).toBe(
      "1 of 1 secured · 1 awaiting payment · competing",
    );
  });
});
