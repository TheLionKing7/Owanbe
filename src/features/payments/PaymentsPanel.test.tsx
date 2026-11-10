import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseSummary } from "@/lib/auth/types";
import { PaymentsPanel } from "./PaymentsPanel";
import type { PaymentsApi } from "./api";
import type { BookingFund, BookingSummary, FundMovement } from "./contracts";

const HOUSE_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const BOOKING_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";

const HOUSE: HouseSummary = {
  house_id: HOUSE_ID,
  kind: "host",
  display_name: "Tolu and Ife's wedding",
  role: "owner",
  capabilities: ["bookings"],
};

function booking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    booking_id: BOOKING_ID,
    quote_id: "8a2c1d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
    service_date: "2026-12-12",
    total_minor: 100000,
    currency: "NGN",
    booking_status: "paid",
    pool_status: "partially_released",
    paid_minor: 100000,
    held_minor: 30000,
    released_minor: 70000,
    refunded_minor: 0,
    release_30_due_at: "2026-11-10T12:00:00.000Z",
    frozen: false,
    is_host_side: true,
    counterparty_name: "Dave Cakes Ltd",
    ...overrides,
  };
}

function fund(overrides: Partial<BookingFund> = {}): BookingFund {
  return {
    booking_id: BOOKING_ID,
    quote_id: "8a2c1d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
    service_date: "2026-12-12",
    total_minor: 100000,
    currency: "NGN",
    booking_status: "paid",
    pool_status: "partially_released",
    paid_minor: 100000,
    held_minor: 30000,
    released_70_minor: 70000,
    released_30_minor: 0,
    commission_minor: 1750,
    tax_minor: 0,
    vendor_net_minor: 68250,
    refunded_minor: 0,
    release_30_due_at: "2026-11-10T12:00:00.000Z",
    paid_at: "2026-11-09T12:00:00.000Z",
    completed_at: null,
    refunded_at: null,
    frozen: false,
    frozen_reason: null,
    payment_reference: "owanbe-abcd1234",
    is_host_side: true,
    counterparty_house: "1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e",
    counterparty_name: "Dave Cakes Ltd",
    ...overrides,
  };
}

const MOVEMENT: FundMovement = {
  movement: "booking_hold",
  direction: "in",
  amount_minor: 100000,
  currency: "NGN",
  reference: "owanbe-abcd1234",
  memo: "Payment received",
  created_at: "2026-11-09T12:00:00.000Z",
};

function stubApi(overrides: Partial<PaymentsApi> = {}): PaymentsApi {
  return {
    bookings: vi.fn(async () => [booking()]),
    cancel: vi.fn(async () => ({ cancelled_by: "host" as const, refund_minor: 0, status: "approved" })),
    money: vi.fn(async () => ({ fund: fund(), movements: [MOVEMENT] })),
    startPayment: vi.fn(async () => ({
      reference: "owanbe-abcd1234",
      authorization_url: "https://checkout.paystack.com/abc",
      amount_minor: 100000,
      currency: "NGN",
    })),
    verifyPayment: vi.fn(async () => ({ outcome: "allocated", booking_id: BOOKING_ID })),
    complete: vi.fn(async () => undefined),
    refund: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PaymentsPanel", () => {
  it("lists the house's bookings", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} />);

    expect(screen.getByTestId("payments-loading")).toBeInTheDocument();
    expect(await screen.findByText("Dave Cakes Ltd")).toBeInTheDocument();
    expect(screen.getByTestId("pool-status")).toHaveTextContent("Part paid out");
    expect(api.bookings).toHaveBeenCalledWith(HOUSE_ID);
  });

  it("explains an empty house and offers a retry when the read fails", async () => {
    const api = stubApi({ bookings: vi.fn(async () => []) });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    expect(await screen.findByTestId("payments-empty")).toHaveTextContent("No payments yet");
  });

  it("offers a retry when the list cannot be read", async () => {
    const api = stubApi({
      bookings: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    expect(await screen.findByTestId("payments-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows what the money is doing when a booking is opened", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));

    const breakdown = await screen.findByTestId("fund-breakdown");
    expect(breakdown).toHaveTextContent("Paid");
    expect(breakdown).toHaveTextContent("Still held");
    expect(breakdown).toHaveTextContent("Released to the vendor");
    expect(breakdown).toHaveTextContent("Platform fee");
    expect(api.money).toHaveBeenCalledWith(BOOKING_ID);
  });

  it("shows the server's own deadline for the last release", async () => {
    render(<PaymentsPanel house={HOUSE} api={stubApi()} />);

    fireEvent.click(await screen.findByTestId("open-payment"));

    expect(await screen.findByTestId("release-deadline")).toHaveTextContent(
      "The last payment is released on",
    );
  });

  it("says plainly when the money is on hold", async () => {
    const api = stubApi({
      money: vi.fn(async () => ({
        fund: fund({ frozen: true, frozen_reason: "A dispute is open" }),
        movements: [],
      })),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));

    const notice = await screen.findByTestId("frozen-notice");
    expect(notice).toHaveTextContent("This money is on hold while a dispute is open");
    expect(notice).toHaveTextContent("A dispute is open");
  });

  it("offers a payment page when the booking is not paid yet", async () => {
    const api = stubApi({
      money: vi.fn(async () => ({
        fund: fund({
          pool_status: "awaiting_payment",
          booking_status: "awaiting_payment",
          paid_minor: 0,
          held_minor: 0,
          released_70_minor: 0,
        }),
        movements: [],
      })),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("start-payment"));

    const link = await screen.findByTestId("payment-link");
    expect(link).toHaveTextContent("Continue to the payment page");
    expect(api.startPayment).toHaveBeenCalledWith(BOOKING_ID);
  });

  it("shows the host's Paystack transfer account at checkout", async () => {
    const api = stubApi({
      money: vi.fn(async () => ({
        fund: fund({ pool_status: "awaiting_payment", booking_status: "awaiting_payment", paid_minor: 0, held_minor: 0, released_70_minor: 0 }),
        movements: [],
      })),
      startPayment: vi.fn(async () => ({
        reference: "owanbe-abcd1234",
        authorization_url: "https://checkout.paystack.com/abc",
        amount_minor: 100000,
        currency: "NGN",
        transfer_account: { account_number: "0123456789", account_name: "Ada Obi", bank_name: "Wema Bank" },
      })),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);
    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("start-payment"));
    expect(await screen.findByTestId("transfer-account")).toHaveTextContent("0123456789");
  });

  it("cancels a paid booking with a reason and previews the host refund", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} />);
    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("ask-cancel"));
    expect(await screen.findByTestId("cancel-preview")).toHaveTextContent("%");
    fireEvent.change(screen.getByTestId("cancel-reason"), { target: { value: "Date moved" } });
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(await screen.findByTestId("cancel-notice")).toHaveTextContent("Booking cancelled");
    expect(api.cancel).toHaveBeenCalledWith(BOOKING_ID, "Date moved");
  });

  it("says why a payment could not be started", async () => {
    const api = stubApi({
      money: vi.fn(async () => ({
        fund: fund({
          pool_status: "awaiting_payment",
          booking_status: "awaiting_payment",
          paid_minor: 0,
          held_minor: 0,
          released_70_minor: 0,
        }),
        movements: [],
      })),
      startPayment: vi.fn(async () => {
        throw new Error("no");
      }),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("start-payment"));

    expect(await screen.findByTestId("payment-action-error")).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("lets the host confirm the celebration happened", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("complete-booking"));

    await waitFor(() => expect(api.complete).toHaveBeenCalledWith(BOOKING_ID));
  });

  it("asks the host why they want the money back, and sends it", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("ask-refund"));
    fireEvent.change(screen.getByTestId("refund-reason"), {
      target: { value: "The date changed and we cannot go ahead" },
    });
    fireEvent.click(screen.getByTestId("send-refund"));

    await waitFor(() =>
      expect(api.refund).toHaveBeenCalledWith(
        BOOKING_ID,
        "The date changed and we cannot go ahead",
      ),
    );
  });

  it("says when a refund was refused", async () => {
    const api = stubApi({
      refund: vi.fn(async () => {
        throw new Error("no");
      }),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));
    fireEvent.click(await screen.findByTestId("ask-refund"));
    fireEvent.change(screen.getByTestId("refund-reason"), {
      target: { value: "The date changed" },
    });
    fireEvent.click(screen.getByTestId("send-refund"));

    expect(await screen.findByTestId("payment-action-error")).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("shows what moved", async () => {
    render(<PaymentsPanel house={HOUSE} api={stubApi()} />);

    fireEvent.click(await screen.findByTestId("open-payment"));

    const movements = await screen.findByTestId("movements");
    expect(movements).toHaveTextContent("Payment received");
  });

  it("asks the server what happened when the host comes back from paying", async () => {
    const api = stubApi();
    render(<PaymentsPanel house={HOUSE} api={api} returnedReference="owanbe-abcd1234" />);

    await waitFor(() => expect(api.verifyPayment).toHaveBeenCalledWith("owanbe-abcd1234"));
  });

  it("does not offer the host a refund on a booking that holds nothing", async () => {
    const api = stubApi({
      money: vi.fn(async () => ({
        fund: fund({
          pool_status: "released",
          booking_status: "completed",
          held_minor: 0,
          released_70_minor: 70000,
          released_30_minor: 30000,
          release_30_due_at: null,
        }),
        movements: [],
      })),
    });
    render(<PaymentsPanel house={HOUSE} api={api} />);

    fireEvent.click(await screen.findByTestId("open-payment"));

    await screen.findByTestId("fund-breakdown");
    expect(screen.queryByTestId("ask-refund")).not.toBeInTheDocument();
    expect(screen.queryByTestId("release-deadline")).not.toBeInTheDocument();
  });
});
