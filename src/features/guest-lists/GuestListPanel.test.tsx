import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuestListError, type GuestListApi } from "./api";
import { GuestListPanel } from "./GuestListPanel";
import type { GuestListSummary, GuestRsvp, MaskedGuest, SharedListSummary } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

const HOUSE_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const LIST_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";

const HOUSE: HouseSummary = {
  house_id: HOUSE_ID,
  kind: "host",
  display_name: "Tolu and Ife's wedding",
  role: "owner",
  capabilities: ["quotes"],
};

function list(overrides: Partial<GuestListSummary> = {}): GuestListSummary {
  return {
    list_id: LIST_ID,
    title: "Tolu and Ife's wedding",
    visibility: "private",
    version: 1,
    guest_count: 1,
    yes_count: 1,
    share_count: 0,
    created_at: "2026-11-08T10:00:00.000Z",
    ...overrides,
  };
}

const SHARED: SharedListSummary[] = [
  { list_id: LIST_ID, title: "Ada's engagement", guest_count: 2 },
];

function stubApi(overrides: Partial<GuestListApi> = {}): GuestListApi {
  return {
    list: vi.fn(async () => [list()]),
    rsvps: vi.fn(async (): Promise<GuestRsvp[]> => [
      {
        rsvp_id: "r-1",
        display_name: "Tolu",
        response: "yes",
        phone: "08012345678",
        address: "12 Broad Street",
        created_at: "2026-11-08T10:05:00.000Z",
      },
    ]),
    recipients: vi.fn(async () => []),
    sharedWithMe: vi.fn(async () => []),
    sharedList: vi.fn(async (): Promise<MaskedGuest[]> => [
      { display_name: "Ada", response: "maybe" },
    ]),
    create: vi.fn(async () => LIST_ID),
    addRsvp: vi.fn(async () => "r-new"),
    setVisibility: vi.fn(async () => 2),
    share: vi.fn(async () => 2),
    revoke: vi.fn(async () => 3),
    ...overrides,
  };
}

afterEach(cleanup);

describe("GuestListPanel", () => {
  it("lists the house's guest lists", async () => {
    const api = stubApi();
    render(<GuestListPanel house={HOUSE} api={api} />);

    expect(screen.getByTestId("lists-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("guest-list-card")).toHaveTextContent(
      "Tolu and Ife's wedding",
    );
    expect(api.list).toHaveBeenCalledWith(HOUSE_ID);
  });

  it("explains an empty house and offers a retry when the read fails", async () => {
    render(<GuestListPanel house={HOUSE} api={stubApi({ list: vi.fn(async () => []) })} />);
    expect(await screen.findByTestId("lists-empty")).toHaveTextContent("No guest lists yet");
    cleanup();

    const listCall = vi
      .fn()
      .mockRejectedValueOnce(new GuestListError("forbidden", "forbidden: guest lists in house"))
      .mockResolvedValueOnce([list()]);
    render(<GuestListPanel house={HOUSE} api={stubApi({ list: listCall })} />);
    expect(await screen.findByTestId("lists-error")).toHaveTextContent(
      "Only the host of this guest list can do that.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("guest-list-card")).toBeInTheDocument();
  });

  it("creates a list in this house", async () => {
    const api = stubApi();
    render(<GuestListPanel house={HOUSE} api={api} />);
    await screen.findByTestId("guest-list-card");

    fireEvent.click(screen.getByTestId("new-guest-list"));
    fireEvent.change(screen.getByTestId("guest-list-title"), {
      target: { value: "Engagement lunch" },
    });
    fireEvent.click(screen.getByTestId("create-guest-list"));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({ house_id: HOUSE_ID, title: "Engagement lunch" }),
    );
  });

  it("refuses a list with no name before it reaches the server", async () => {
    const api = stubApi();
    render(<GuestListPanel house={HOUSE} api={api} />);
    await screen.findByTestId("guest-list-card");

    fireEvent.click(screen.getByTestId("new-guest-list"));
    fireEvent.click(screen.getByTestId("create-guest-list"));

    expect(await screen.findByTestId("create-error")).toHaveTextContent("Name this guest list");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("opens a list shared with the host without any contact detail", async () => {
    render(
      <GuestListPanel house={HOUSE} api={stubApi({ sharedWithMe: vi.fn(async () => SHARED) })} />,
    );

    expect(await screen.findByTestId("open-shared")).toBeInTheDocument();
    expect(screen.getByText(/Ada's engagement/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-shared"));

    const guests = await screen.findByTestId("shared-guests");
    expect(guests).toHaveTextContent("Ada");
    expect(guests.textContent).not.toContain("08012345678");
    expect(guests.textContent).not.toContain("Broad Street");
  });

  it("says when no list has been shared with the host", async () => {
    render(<GuestListPanel house={HOUSE} api={stubApi()} />);
    expect(await screen.findByTestId("shared-empty")).toHaveTextContent(
      "Nobody has shared a guest list with you.",
    );
  });
});
