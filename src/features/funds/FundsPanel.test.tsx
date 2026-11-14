import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FundsPanel } from "./FundsPanel";
import type { FundsApi } from "./api";
import type { RecoveryActionRow, RecoveryCaseContext } from "./contracts";

const ACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CASE_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const BOOKING_ID = "8d3c2b1a-9e0f-4a7b-8c6d-5e4f3a2b1c0d";

function action(overrides: Partial<RecoveryActionRow> = {}): RecoveryActionRow {
  return {
    action_id: ACTION_ID,
    reference: "RA-0123456789AB",
    kind: "clawback",
    status: "requested",
    case_id: CASE_ID,
    case_reference: "CASE-0123456789AB",
    booking_id: BOOKING_ID,
    pool_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    currency: "NGN",
    amount_minor: 5000,
    replacement_cost_minor: null,
    requested_by: "9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a",
    requested_by_name: "Ada",
    approvals: 1,
    requested_at: "2026-11-14T09:00:00.000Z",
    approved_at: null,
    settled_at: null,
    reason: "The vendor did not deliver",
    ...overrides,
  };
}

const CONTEXT: RecoveryCaseContext = {
  case_id: CASE_ID,
  case_reference: "CASE-0123456789AB",
  case_status: "investigating",
  booking_id: BOOKING_ID,
  pool_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  currency: "NGN",
  paid_minor: 100000,
  refunded_minor: 0,
  vendor_payable_minor: 68250,
  fund_balance_minor: 1000,
};

function api(overrides: Partial<FundsApi> = {}): FundsApi {
  return {
    balances: async () => [
      {
        currency: "NGN",
        balance_minor: 1000,
        clawed_back_minor: 5000,
        advanced_minor: 4000,
        open_actions: 1,
      },
    ],
    actions: async () => [action()],
    caseContext: async () => CONTEXT,
    ledger: async () => [],
    duePools: async () => [
      {
        pool_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        booking_id: BOOKING_ID,
        host_house_id: "3b4c5d6e-7f80-4912-a3b4-c5d6e7f80912",
        vendor_house_id: "4c5d6e7f-8091-4a23-b4c5-d6e7f8091223",
        currency: "NGN",
        total_minor: 100000,
        paid_minor: 100000,
        held_minor: 30000,
        released_70_minor: 70000,
        release_30_due_at: "2026-11-10T12:00:00.000Z",
        frozen: false,
      },
    ],
    allocate: async () => ({
      release_70: 70000,
      release_30: 30000,
      commission_70: 1750,
      tax_70: 0,
      vendor_net_70: 68250,
      commission_30: 750,
      tax_30: 0,
      vendor_net_30: 29250,
    }),
    release: async () => "released",
    requestRecovery: async () => ACTION_ID,
    decide: async () => "awaiting_approval",
    settle: async () => ({ outcome: "settled", provider_reference: "RB-109-1" }),
    reconcile: async () => ({
      events_checked: 3,
      pools_checked: 2,
      matched: 5,
      exception_count: 0,
      exceptions: [],
    }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("the recovery console", () => {
  it("shows what the fund holds and what has been asked for", async () => {
    render(<FundsPanel api={api()} />);

    await waitFor(() => {
      expect(screen.getByTestId("funds-panel")).toBeInTheDocument();
    });
    expect(await screen.findByText("₦10.00")).toBeInTheDocument();
    expect(await screen.findByText("RA-0123456789AB")).toBeInTheDocument();
    expect(await screen.findByText(/1 of 2 approvals/)).toBeInTheDocument();
  });

  it("says so when the console cannot be opened", async () => {
    render(
      <FundsPanel
        api={api({
          balances: async () => {
            throw new Error("forbidden: staff grant required");
          },
        })}
      />,
    );

    expect(await screen.findByTestId("funds-error")).toBeInTheDocument();
  });

  it("says so when there is nothing in the fund yet", async () => {
    render(<FundsPanel api={api({ balances: async () => [] })} />);

    expect(await screen.findByTestId("funds-empty")).toBeInTheDocument();
  });

  it("records an approval through the database", async () => {
    const decide = vi.fn(async () => "awaiting_approval");
    render(<FundsPanel api={api({ decide })} />);

    fireEvent.click(await screen.findByTestId("approve-action"));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({ action_id: ACTION_ID, decision: "approved" });
    });
  });

  it("asks for the money in the currency of the case, in minor units", async () => {
    const requestRecovery = vi.fn(async () => ACTION_ID);
    render(<FundsPanel api={api({ requestRecovery })} />);

    fireEvent.change(await screen.findByTestId("fund-case-id"), {
      target: { value: CASE_ID },
    });
    fireEvent.click(screen.getByTestId("fund-case-lookup"));
    await screen.findByTestId("fund-case-context");

    fireEvent.change(screen.getByTestId("fund-amount"), { target: { value: "50" } });
    fireEvent.change(screen.getByTestId("fund-reason"), {
      target: { value: "The vendor did not deliver" },
    });
    fireEvent.click(screen.getByTestId("fund-ask-submit"));

    await waitFor(() => {
      expect(requestRecovery).toHaveBeenCalledWith({
        kind: "clawback",
        case_id: CASE_ID,
        amount_minor: 5000,
        reason: "The vendor did not deliver",
      });
    });
  });

  it("asks for the cost of the replacement when it is an advance", async () => {
    const requestRecovery = vi.fn(async () => ACTION_ID);
    render(<FundsPanel api={api({ requestRecovery })} />);

    fireEvent.change(await screen.findByTestId("fund-case-id"), {
      target: { value: CASE_ID },
    });
    fireEvent.click(screen.getByTestId("fund-case-lookup"));
    await screen.findByTestId("fund-case-context");

    fireEvent.click(screen.getByTestId("fund-kind-advance"));
    fireEvent.change(screen.getByTestId("fund-amount"), { target: { value: "80" } });
    fireEvent.change(screen.getByTestId("fund-reason"), {
      target: { value: "The vendor did not deliver" },
    });
    fireEvent.click(screen.getByTestId("fund-ask-submit"));

    await waitFor(() => {
      expect(requestRecovery).toHaveBeenCalledWith({
        kind: "advance",
        case_id: CASE_ID,
        replacement_cost_minor: 8000,
        reason: "The vendor did not deliver",
      });
    });
  });

  it("shows the recovery money that has moved on the case", async () => {
    const ledger = vi.fn(async () => [
      {
        movement: "clawback" as const,
        direction: "in" as const,
        amount_minor: 5000,
        currency: "NGN",
        memo: "Taken back from the vendor",
        created_at: "2026-11-14T10:00:00.000Z",
      },
    ]);
    render(<FundsPanel api={api({ ledger })} />);

    fireEvent.change(await screen.findByTestId("fund-case-id"), {
      target: { value: CASE_ID },
    });
    fireEvent.click(screen.getByTestId("fund-case-lookup"));

    const trail = await screen.findByTestId("fund-trail");
    expect(trail.textContent).toContain("Taken back from the vendor");
    expect(trail.textContent).toContain("₦50.00");
    expect(ledger).toHaveBeenCalledWith(CONTEXT.pool_id);
  });

  it("releases a pool whose window has closed", async () => {
    const release = vi.fn(async () => "released");
    render(<FundsPanel api={api({ release })} />);

    fireEvent.click(await screen.findByTestId("release-pool"));

    await waitFor(() => {
      expect(release).toHaveBeenCalledWith(BOOKING_ID);
    });
  });

  it("shows what the reconciliation found", async () => {
    render(<FundsPanel api={api()} />);

    fireEvent.click(await screen.findByTestId("fund-reconcile"));

    const report = await screen.findByTestId("fund-reconcile-report");
    expect(report.textContent).toContain("3 provider events checked");
  });

  it("shows the split the database calculated", async () => {
    const allocate = vi.fn(async () => ({
      release_70: 70000,
      release_30: 30000,
      commission_70: 1750,
      tax_70: 0,
      vendor_net_70: 68250,
      commission_30: 750,
      tax_30: 0,
      vendor_net_30: 29250,
    }));
    render(<FundsPanel api={api({ allocate })} />);

    fireEvent.change(await screen.findByTestId("fund-split-total"), { target: { value: "1000" } });
    fireEvent.click(screen.getByTestId("fund-split-submit"));

    await waitFor(() => {
      expect(allocate).toHaveBeenCalledWith(100000, "NGN");
    });
    expect(await screen.findByTestId("fund-split")).toBeInTheDocument();
  });
});
