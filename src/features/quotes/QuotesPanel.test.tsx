import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HoldsApi } from "@/features/holds/api";
import type { HoldSummary } from "@/features/holds/contracts";
import { QuoteError, type QuoteApi, type QuoteRevision, type QuoteSummary } from "./api";
import { QuotesPanel } from "./QuotesPanel";
import type { HouseSummary } from "@/lib/auth/types";

const HOST_HOUSE: HouseSummary = {
  house_id: "host-1",
  kind: "host",
  display_name: "The Ogun wedding",
  role: "owner",
  capabilities: ["quotes"],
};
const VENDOR_OWNER: HouseSummary = {
  house_id: "vendor-1",
  kind: "vendor",
  display_name: "Alice Events Ltd",
  role: "owner",
  capabilities: ["quotes", "calendar", "members"],
};
const VENDOR_STAFF: HouseSummary = { ...VENDOR_OWNER, role: "staff", capabilities: ["quotes"] };

function inHours(hours: number): string {
  // A minute of slack: the countdown floors to whole minutes, so a deadline built exactly on the
  // hour would already read "4h 59m" by the time the component renders.
  return new Date(Date.now() + hours * 3_600_000 + 60_000).toISOString();
}

function summary(overrides: Partial<QuoteSummary> = {}): QuoteSummary {
  return {
    quote_id: "q-1",
    service_date: "2026-12-05",
    status: "sent",
    currency: "NGN",
    total_minor: 175_000,
    current_revision: 2,
    sent_at: new Date(Date.now() - 3_600_000).toISOString(),
    expires_at: inHours(5),
    decided_at: null,
    close_note: null,
    version: 3,
    is_vendor_side: false,
    counterparty_house: "vendor-1",
    counterparty_name: "Alice Events Ltd",
    title: "Wedding reception",
    lock_slot: 1,
    daily_capacity: 1,
    competing: false,
    ...overrides,
  };
}

const REVISIONS: QuoteRevision[] = [
  {
    number: 1,
    authored_by_role: "vendor",
    title: "Wedding reception",
    inclusions: [{ label: "Venue", line_total_minor: 150_000 }],
    extras: [{ label: "Extra hour", line_total_minor: 25_000 }],
    currency: "NGN",
    subtotal_minor: 150_000,
    total_minor: 175_000,
    message: null,
    created_at: "2026-11-04T09:00:00.000Z",
  },
];

function stubApi(overrides: Partial<QuoteApi> = {}): QuoteApi {
  return {
    list: vi.fn(async () => [] as QuoteSummary[]),
    history: vi.fn(async () => REVISIONS),
    create: vi.fn(async () => "q-new"),
    revise: vi.fn(async () => 3),
    send: vi.fn(async () => inHours(24)),
    counter: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    decline: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    setDailyCapacity: vi.fn(async () => {}),
    ...overrides,
  };
}

function fillBuilder() {
  fireEvent.change(screen.getByLabelText("Host house ID"), { target: { value: "host-1" } });
  fireEvent.change(screen.getByLabelText("Celebration date"), { target: { value: "2026-12-05" } });
  fireEvent.change(screen.getByLabelText("Quote title"), {
    target: { value: "Wedding reception" },
  });
  fireEvent.change(screen.getByPlaceholderText("Item or service"), { target: { value: "Venue" } });
  fireEvent.change(screen.getByPlaceholderText("Amount (NGN)"), { target: { value: "1500" } });
}

afterEach(cleanup);

describe("QuotesPanel", () => {
  it("loads the quotes and shows the deadline the server set", async () => {
    const api = stubApi({ list: vi.fn(async () => [summary()]) });
    render(<QuotesPanel house={HOST_HOUSE} side="host" api={api} />);

    expect(screen.getByTestId("quotes-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("quote-card")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith("host-1");
    expect(screen.getByTestId("quote-status")).toHaveTextContent("Awaiting the host");
    expect(screen.getByTestId("quote-total").textContent).toMatch(/1,?750\.00/);
    expect(screen.getByTestId("quote-countdown").textContent).toMatch(/5h \d+m left to respond/);
    expect(screen.getByTestId("quote-lock")).toHaveTextContent("slot 1 of 1 per day");
  });

  it("explains an empty list on each side", async () => {
    render(<QuotesPanel house={HOST_HOUSE} side="host" api={stubApi()} />);
    expect(await screen.findByTestId("quotes-empty")).toHaveTextContent(
      "Quotes from vendors will appear here",
    );
    cleanup();

    render(<QuotesPanel house={VENDOR_OWNER} side="vendor" api={stubApi()} />);
    expect(await screen.findByTestId("quotes-empty")).toHaveTextContent("Write your first quote");
  });

  it("offers a retry when the list cannot be read", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new QuoteError("forbidden", "forbidden: quotes in house"))
      .mockResolvedValueOnce([summary()]);
    render(<QuotesPanel house={HOST_HOUSE} side="host" api={stubApi({ list })} />);

    expect(await screen.findByTestId("quotes-error")).toHaveTextContent(
      "Your account cannot do that in this house.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("quote-card")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("warns both houses when a date is already fully held", async () => {
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary({ lock_slot: 2, competing: true })]) })}
      />,
    );

    expect(await screen.findByTestId("quote-competing")).toHaveTextContent(
      "competes with another quote",
    );
  });

  it("lets the host accept, and re-reads the quote when the version moved", async () => {
    const accept = vi
      .fn()
      .mockRejectedValueOnce(new QuoteError("stale_version", "stale_version"))
      .mockResolvedValueOnce(undefined);
    const list = vi.fn(async () => [summary()]);
    render(<QuotesPanel house={HOST_HOUSE} side="host" api={stubApi({ accept, list })} />);

    fireEvent.click(await screen.findByTestId("action-accept"));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("q-1", 3));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This quote changed while you were reading it",
    );
    // The stale read is refreshed so the next action carries the new version.
    expect(list).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId("action-accept"));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the revision history without letting the client rewrite it", async () => {
    const api = stubApi({ list: vi.fn(async () => [summary()]) });
    render(<QuotesPanel house={HOST_HOUSE} side="host" api={api} />);

    fireEvent.click(await screen.findByTestId("action-history"));
    expect(await screen.findByTestId("quote-history")).toHaveTextContent("Revision 1");
    expect(screen.getByTestId("quote-history")).toHaveTextContent("Extra hour");
    expect(api.history).toHaveBeenCalledWith("q-1");
  });

  it("only offers the owner the daily capacity control", async () => {
    render(<QuotesPanel house={VENDOR_STAFF} side="vendor" api={stubApi()} />);
    await waitFor(() => expect(screen.getByTestId("quotes-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("capacity-input")).not.toBeInTheDocument();
    cleanup();

    const setDailyCapacity = vi.fn(async () => {});
    render(
      <QuotesPanel
        house={VENDOR_OWNER}
        side="vendor"
        api={stubApi({
          list: vi.fn(async () => [summary({ is_vendor_side: true })]),
          setDailyCapacity,
        })}
      />,
    );
    fireEvent.change(await screen.findByTestId("capacity-input"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("capacity-save"));
    await waitFor(() => expect(setDailyCapacity).toHaveBeenCalledWith("vendor-1", 3));

    fireEvent.change(screen.getByTestId("capacity-input"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("capacity-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 to 100");
  });

  it("creates a draft from the vendor builder with derived line totals", async () => {
    const create = vi.fn(async () => "q-new");
    render(<QuotesPanel house={VENDOR_OWNER} side="vendor" api={stubApi({ create })} />);

    fireEvent.click(await screen.findByTestId("new-quote"));
    expect(screen.getByTestId("quote-builder")).toBeInTheDocument();
    expect(screen.getByTestId("builder-total").textContent).toMatch(/0\.00/);

    fillBuilder();
    expect(screen.getByTestId("builder-total").textContent).toMatch(/1,?500\.00/);

    fireEvent.click(screen.getByTestId("builder-save"));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        vendor_house_id: "vendor-1",
        host_house_id: "host-1",
        service_date: "2026-12-05",
        currency: "NGN",
        title: "Wedding reception",
        inclusions: [{ label: "Venue", line_total_minor: 150_000 }],
        extras: [],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("quote-builder")).not.toBeInTheDocument());
  });

  it("keeps the builder open and explains a refusal", async () => {
    const create = vi.fn(async () => {
      throw new QuoteError("validation", "invalid_quote_lines");
    });
    render(<QuotesPanel house={VENDOR_OWNER} side="vendor" api={stubApi({ create })} />);

    fireEvent.click(await screen.findByTestId("new-quote"));
    fillBuilder();
    fireEvent.click(screen.getByTestId("builder-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the quote details and try again.",
    );
    expect(screen.getByTestId("quote-builder")).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stops an incomplete offer before it reaches the database", async () => {
    const create = vi.fn(async () => "q-new");
    render(<QuotesPanel house={VENDOR_OWNER} side="vendor" api={stubApi({ create })} />);

    fireEvent.click(await screen.findByTestId("new-quote"));
    fireEvent.change(screen.getByLabelText("Host house ID"), { target: { value: "host-1" } });
    fireEvent.change(screen.getByLabelText("Celebration date"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.change(screen.getByLabelText("Quote title"), {
      target: { value: "Wedding reception" },
    });
    fireEvent.change(screen.getByPlaceholderText("Item or service"), {
      target: { value: "Venue" },
    });
    fireEvent.change(screen.getByPlaceholderText("Amount (NGN)"), { target: { value: "soon" } });
    fireEvent.click(screen.getByTestId("builder-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Every line needs an amount");
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("quote-builder")).toBeInTheDocument();
  });

  it("explains that a quote can no longer be acted on", async () => {
    const decline = vi.fn(async () => {
      throw new QuoteError("invalid_transition", "invalid_transition: quote is accepted");
    });
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary()]), decline })}
      />,
    );

    fireEvent.click(await screen.findByTestId("action-decline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That quote is no longer open to this action.",
    );
  });
});

describe("QuotesPanel payment windows (F-38)", () => {
  function hold(overrides: Partial<HoldSummary> = {}): HoldSummary {
    return {
      hold_id: "h-1",
      quote_id: "q-1",
      title: "Wedding reception",
      service_date: "2026-12-05",
      status: "awaiting_payment",
      payment_due_at: inHours(7),
      confirmed_at: null,
      released_at: null,
      release_reason: null,
      lock_slot: 1,
      daily_capacity: 1,
      competing: false,
      is_vendor_side: false,
      counterparty_house: "vendor-1",
      counterparty_name: "Alice Events Ltd",
      paid_minor: null,
      paid_currency: null,
      refund_minor: null,
      refund_currency: null,
      refund_reason: null,
      ...overrides,
    };
  }

  function stubHolds(overrides: Partial<HoldsApi> = {}): HoldsApi {
    return {
      holds: vi.fn(async () => [] as HoldSummary[]),
      alerts: vi.fn(async () => []),
      markSeen: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("shows the deadline the database set once the host accepts", async () => {
    const holds = vi.fn(async () => [hold()]);
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary({ status: "accepted" })]) })}
        holdApi={stubHolds({ holds })}
      />,
    );

    expect(await screen.findByTestId("quote-payment-window")).toHaveTextContent(
      /7h \d+m left to pay/,
    );
    expect(screen.getByTestId("quote-payment-window")).toHaveTextContent(
      "Nothing here is a payment button",
    );
    expect(holds).toHaveBeenCalledWith("host-1");
  });

  it("reads the windows only when something was accepted", async () => {
    const holds = vi.fn(async () => [] as HoldSummary[]);
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary()]) })}
        holdApi={stubHolds({ holds })}
      />,
    );

    await screen.findByTestId("quote-card");
    expect(holds).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quote-payment-window")).not.toBeInTheDocument();
  });

  it("tells the host the date was outbid and the money is owed back", async () => {
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary({ status: "accepted" })]) })}
        holdApi={stubHolds({
          holds: vi.fn(
            async () =>
              [
                hold({
                  status: "released",
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

    expect(await screen.findByTestId("quote-payment-window")).toHaveTextContent(
      "Another payment reached this date first",
    );
    expect(screen.getByTestId("quote-payment-window")).toHaveTextContent(/1,?750\.00 owed back/);
  });

  it("keeps the quotes on screen when the windows cannot be read", async () => {
    render(
      <QuotesPanel
        house={HOST_HOUSE}
        side="host"
        api={stubApi({ list: vi.fn(async () => [summary({ status: "accepted" })]) })}
        holdApi={stubHolds({
          holds: vi.fn(async () => {
            throw new QuoteError("forbidden", "forbidden: calendar in house");
          }),
        })}
      />,
    );

    expect(await screen.findByTestId("holds-error")).toHaveTextContent(
      "Your account cannot do that in this house.",
    );
    expect(screen.getByTestId("quote-card")).toBeInTheDocument();
    expect(screen.queryByTestId("quote-payment-window")).not.toBeInTheDocument();
  });
});
