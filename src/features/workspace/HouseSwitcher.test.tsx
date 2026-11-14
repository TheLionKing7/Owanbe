import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HouseSwitcher } from "./HouseSwitcher";
import type { HoldsApi } from "@/features/holds/api";
import type { HouseAlert } from "@/features/holds/contracts";
import type { HouseSummary } from "@/lib/auth/types";

const HOST_HOUSE: HouseSummary = {
  house_id: "host-1",
  kind: "host",
  display_name: "Ada's celebration",
  role: "owner",
  capabilities: [],
};

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
    payload: {},
    read_at: null,
    created_at: "2026-11-04T09:00:00.000Z",
    ...overrides,
  };
}

function stubApi(alerts: (houseId: string) => Promise<HouseAlert[]> = async () => []): HoldsApi {
  return {
    holds: vi.fn(async () => []),
    alerts: vi.fn(alerts),
    markSeen: vi.fn(async () => {}),
  };
}

afterEach(cleanup);

describe("HouseSwitcher", () => {
  it("lists both houses and marks the one the person is in", () => {
    render(
      <HouseSwitcher
        houses={[HOST_HOUSE, VENDOR_HOUSE]}
        current="host"
        onSwitch={() => {}}
        api={stubApi()}
      />,
    );

    expect(screen.getByTestId("house-switch-host")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("house-switch-vendor")).not.toHaveAttribute("aria-current");
  });

  it("shows each house's own unread count", async () => {
    const api = stubApi(async (houseId) =>
      houseId === "vendor-1" ? [alert(), alert({ id: "a-2" })] : [alert({ id: "a-3" })],
    );
    render(
      <HouseSwitcher
        houses={[HOST_HOUSE, VENDOR_HOUSE]}
        current="host"
        onSwitch={() => {}}
        api={api}
      />,
    );

    expect(await screen.findByTestId("house-switch-badge-vendor")).toHaveTextContent("2");
    expect(screen.getByTestId("house-switch-badge-host")).toHaveTextContent("1");
  });

  it("asks before it switches and switches only when the person confirms", async () => {
    const onSwitch = vi.fn();
    render(
      <HouseSwitcher
        houses={[HOST_HOUSE, VENDOR_HOUSE]}
        current="host"
        onSwitch={onSwitch}
        api={stubApi()}
      />,
    );

    fireEvent.click(screen.getByTestId("house-switch-vendor"));

    expect(await screen.findByTestId("house-switch-title")).toHaveTextContent(
      "Switch to the Vendor House?",
    );
    expect(onSwitch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("house-switch-confirm"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("vendor"));
  });

  it("keeps the person where they are when they stay", async () => {
    const onSwitch = vi.fn();
    render(
      <HouseSwitcher
        houses={[HOST_HOUSE, VENDOR_HOUSE]}
        current="host"
        onSwitch={onSwitch}
        api={stubApi()}
      />,
    );

    fireEvent.click(screen.getByTestId("house-switch-vendor"));
    fireEvent.click(await screen.findByTestId("house-switch-cancel"));

    await waitFor(() => expect(screen.queryByTestId("house-switch-title")).not.toBeInTheDocument());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("has nothing to offer an account that holds one house only", () => {
    render(
      <HouseSwitcher houses={[HOST_HOUSE]} current="host" onSwitch={() => {}} api={stubApi()} />,
    );

    expect(screen.queryByTestId("house-switcher")).not.toBeInTheDocument();
  });

  it("switches without a badge when a house's alerts cannot be read", async () => {
    const api = stubApi(async (houseId) => {
      if (houseId === "vendor-1") throw new Error("forbidden");
      return [];
    });
    render(
      <HouseSwitcher
        houses={[HOST_HOUSE, VENDOR_HOUSE]}
        current="host"
        onSwitch={() => {}}
        api={api}
      />,
    );

    await waitFor(() => expect(api.alerts).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("house-switch-badge-vendor")).not.toBeInTheDocument();
    expect(screen.getByTestId("house-switch-vendor")).toBeInTheDocument();
  });
});
