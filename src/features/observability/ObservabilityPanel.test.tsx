import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObservabilityError, type ObservabilityApi } from "./api";
import { ObservabilityPanel } from "./ObservabilityPanel";
import type { ObservabilitySnapshot } from "./contracts";

function snapshot(overrides: Partial<ObservabilitySnapshot> = {}): ObservabilitySnapshot {
  return {
    signals: [
      {
        signal_key: "payment_ambiguity",
        signal_label: "Provider events with no outcome",
        value: 1,
        detail: "A payment event nobody has decided yet.",
        severity: "critical",
      },
      {
        signal_key: "unread_alerts",
        signal_label: "Unread house alerts",
        value: 4,
        detail: "Alerts written to a house that nobody has read.",
        severity: "info",
      },
    ],
    read_at: "2026-11-13T09:00:00.000Z",
    disclosure: "Counters from the platform's own operational records",
    error_tracking: null,
    ...overrides,
  };
}

function stubApi(overrides: Partial<ObservabilityApi> = {}): ObservabilityApi {
  return {
    read: vi.fn(async () => snapshot()),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ObservabilityPanel", () => {
  it("shows the signals the platform's records hold", async () => {
    const api = stubApi();
    render(<ObservabilityPanel api={api} />);

    await waitFor(() => expect(api.read).toHaveBeenCalled());
    const signals = await screen.findAllByTestId("observability-signal");
    expect(signals).toHaveLength(2);
    expect(signals[0]?.textContent).toContain("Provider events with no outcome");
  });

  it("says where the numbers come from", async () => {
    const api = stubApi();
    render(<ObservabilityPanel api={api} />);

    expect((await screen.findByTestId("observability-disclosure")).textContent).toContain(
      "Counters from the platform's own operational records",
    );
  });

  it("shows the error counts when the observability tool answered", async () => {
    const api = stubApi({
      read: vi.fn(async () =>
        snapshot({
          error_tracking: { unresolved_issues: 3, capped_at: 100, window_hours: 24 },
        }),
      ),
    });
    render(<ObservabilityPanel api={api} />);

    const tracking = await screen.findByTestId("observability-error-tracking");
    expect(tracking.textContent).toContain("3");
    expect(tracking.textContent).toContain("error issues");
  });

  it("says error tracking was not available when it was not", async () => {
    const api = stubApi();
    render(<ObservabilityPanel api={api} />);

    const tracking = await screen.findByTestId("observability-error-tracking");
    expect(tracking.textContent).toContain("Error tracking was not available");
  });

  it("says what the platform cannot measure yet", async () => {
    const api = stubApi();
    render(<ObservabilityPanel api={api} />);

    const notMeasured = await screen.findByTestId("observability-not-measured");
    expect(notMeasured.textContent).toContain("Update latency");
    expect(notMeasured.textContent).toContain("Retry exhaustion");
  });

  it("says the read was refused", async () => {
    const api = stubApi({
      read: vi.fn(async () => {
        throw new ObservabilityError("forbidden", "forbidden");
      }),
    });
    render(<ObservabilityPanel api={api} />);

    const error = await screen.findByTestId("observability-error");
    expect(error.textContent).toContain("platform operations staff");
  });

  it("says the platform holds no signals yet when there are none", async () => {
    const api = stubApi({ read: vi.fn(async () => snapshot({ signals: [] })) });
    render(<ObservabilityPanel api={api} />);

    expect((await screen.findByTestId("observability-empty")).textContent).toContain(
      "no signals yet",
    );
  });
});
