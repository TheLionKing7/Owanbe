import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteError } from "@/features/quotes/api";
import { HouseAlerts } from "./HouseAlerts";
import type { HoldsApi } from "./api";
import type { HouseAlert } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

const VENDOR_HOUSE: HouseSummary = {
  house_id: "vendor-1",
  kind: "vendor",
  display_name: "Alice Events Ltd",
  role: "owner",
  capabilities: ["quotes", "calendar"],
};

function alert(overrides: Partial<HouseAlert> = {}): HouseAlert {
  return {
    id: "a-1",
    kind: "date_competing",
    title: "Two hosts hold this date",
    body: "2026-12-05 now has more accepted quotes than you can serve in one day.",
    payload: { quote_id: "q-1", service_date: "2026-12-05" },
    read_at: null,
    created_at: "2026-11-04T09:00:00.000Z",
    ...overrides,
  };
}

function stubApi(overrides: Partial<HoldsApi> = {}): HoldsApi {
  return {
    holds: vi.fn(async () => []),
    alerts: vi.fn(async () => [] as HouseAlert[]),
    markSeen: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(cleanup);

describe("HouseAlerts", () => {
  it("lists only this house's alerts and counts the unread ones", async () => {
    const alerts = vi.fn(async () => [
      alert(),
      alert({ id: "a-2", kind: "date_secured", title: "Date secured", read_at: null }),
      alert({
        id: "a-3",
        kind: "refund_pending",
        title: "Payment owed back",
        read_at: "2026-11-04T10:00:00.000Z",
      }),
    ]);
    render(<HouseAlerts house={VENDOR_HOUSE} api={stubApi({ alerts })} />);

    expect(screen.getByTestId("alerts-loading")).toBeInTheDocument();
    expect(await screen.findAllByTestId("alert-row")).toHaveLength(3);
    expect(alerts).toHaveBeenCalledWith("vendor-1");
    expect(screen.getByTestId("alerts-unread")).toHaveTextContent("2");
    expect(screen.getAllByTestId("alert-row")[0]).toHaveTextContent("Two hosts hold this date");
    // The body never repeats an offer line or a payment reference; the server keeps those out.
    expect(document.body.textContent).not.toMatch(/inclusions|payment_reference/);
  });

  it("marks an alert seen through the server and re-reads the projection", async () => {
    const markSeen = vi.fn(async () => {});
    const alerts = vi
      .fn()
      .mockResolvedValueOnce([alert()])
      .mockResolvedValueOnce([alert({ read_at: "2026-11-04T11:00:00.000Z" })]);
    render(<HouseAlerts house={VENDOR_HOUSE} api={stubApi({ alerts, markSeen })} />);

    expect(await screen.findByTestId("alerts-unread")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("alert-seen-a-1"));
    await waitFor(() => expect(markSeen).toHaveBeenCalledWith("a-1"));
    expect(alerts).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("alert-seen-a-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alerts-unread")).not.toBeInTheDocument();
  });

  it("says so when there is nothing to report", async () => {
    render(<HouseAlerts house={VENDOR_HOUSE} api={stubApi()} />);
    expect(await screen.findByTestId("alerts-empty")).toHaveTextContent(
      "Nothing about your dates yet",
    );
  });

  it("explains a refusal in plain language and keeps a retry path", async () => {
    const alerts = vi
      .fn()
      .mockRejectedValueOnce(new QuoteError("forbidden", "forbidden: not a member of this house"))
      .mockResolvedValueOnce([alert()]);
    render(<HouseAlerts house={VENDOR_HOUSE} api={stubApi({ alerts })} />);

    expect(await screen.findByTestId("alerts-error")).toHaveTextContent(
      "Your account cannot do that in this house.",
    );
    fireEvent.click(screen.getByTestId("alerts-refresh"));
    expect(await screen.findByTestId("alert-row")).toBeInTheDocument();
  });

  it("reports a refusal to mark an alert seen", async () => {
    const markSeen = vi.fn(async () => {
      throw new QuoteError("forbidden", "forbidden: not a member of this house");
    });
    render(
      <HouseAlerts
        house={VENDOR_HOUSE}
        api={stubApi({ alerts: vi.fn(async () => [alert()]), markSeen })}
      />,
    );

    fireEvent.click(await screen.findByTestId("alert-seen-a-1"));
    expect(await screen.findByTestId("alerts-error")).toHaveTextContent(
      "Your account cannot do that in this house.",
    );
    expect(screen.getByTestId("alert-row")).toBeInTheDocument();
  });
});
