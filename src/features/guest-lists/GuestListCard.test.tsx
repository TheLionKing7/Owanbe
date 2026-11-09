import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuestListError, type GuestListApi } from "./api";
import { GuestListCard } from "./GuestListCard";
import type { GuestListSummary, GuestRecipient, GuestRsvp } from "./contracts";

const LIST_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function list(overrides: Partial<GuestListSummary> = {}): GuestListSummary {
  return {
    list_id: LIST_ID,
    title: "Tolu and Ife's wedding",
    visibility: "private",
    version: 2,
    guest_count: 1,
    yes_count: 1,
    share_count: 0,
    created_at: "2026-11-08T10:00:00.000Z",
    ...overrides,
  };
}

const RSVPS: GuestRsvp[] = [
  {
    rsvp_id: "r-1",
    display_name: "Tolu",
    response: "yes",
    phone: "08012345678",
    address: "12 Broad Street",
    created_at: "2026-11-08T10:05:00.000Z",
  },
];

const RECIPIENTS: GuestRecipient[] = [
  { share_id: "s-1", display_name: "Ada", granted_at: "2026-11-08T11:00:00.000Z" },
];

function stubApi(overrides: Partial<GuestListApi> = {}): GuestListApi {
  return {
    list: vi.fn(async () => [list()]),
    rsvps: vi.fn(async () => RSVPS),
    recipients: vi.fn(async () => RECIPIENTS),
    sharedWithMe: vi.fn(async () => []),
    sharedList: vi.fn(async () => []),
    create: vi.fn(async () => LIST_ID),
    addRsvp: vi.fn(async () => "r-new"),
    setVisibility: vi.fn(async () => 3),
    share: vi.fn(async () => 3),
    revoke: vi.fn(async () => 4),
    ...overrides,
  };
}

afterEach(cleanup);

describe("GuestListCard", () => {
  it("shows the host the contacts and the guests the masked view", async () => {
    render(<GuestListCard list={list()} api={stubApi()} onChanged={async () => {}} />);

    expect(await screen.findByTestId("guest-row")).toHaveTextContent("Tolu");
    // Only the host's own screen carries a contact detail.
    expect(screen.getByTestId("guest-phone")).toHaveTextContent("08012345678");
    expect(screen.getByTestId("guest-address")).toHaveTextContent("12 Broad Street");

    const preview = await screen.findByTestId("masked-preview");
    expect(preview).toHaveTextContent("Tolu");
    expect(preview.textContent).not.toContain("08012345678");
    expect(preview.textContent).not.toContain("Broad Street");
  });

  it("switches visibility with the version the server gave", async () => {
    const api = stubApi();
    render(<GuestListCard list={list()} api={api} onChanged={async () => {}} />);

    fireEvent.click(await screen.findByTestId("visibility-public"));

    await waitFor(() => expect(api.setVisibility).toHaveBeenCalledWith(LIST_ID, "public", 2));
    expect(await screen.findByTestId("guest-list-notice")).toHaveTextContent(
      "This list is now public.",
    );
  });

  it("offers the public link only while the list is public", async () => {
    render(<GuestListCard list={list()} api={stubApi()} onChanged={async () => {}} />);
    await screen.findByTestId("guest-row");
    expect(screen.queryByTestId("public-link")).not.toBeInTheDocument();

    cleanup();
    render(
      <GuestListCard
        list={list({ visibility: "public" })}
        api={stubApi()}
        onChanged={async () => {}}
      />,
    );
    const link = await screen.findByTestId("public-link");
    expect(link).toHaveAttribute("href", `/guest-lists/${LIST_ID}`);
  });

  it("refuses an invalid recipient email before it reaches the server", async () => {
    const api = stubApi();
    render(<GuestListCard list={list()} api={api} onChanged={async () => {}} />);

    fireEvent.change(await screen.findByTestId("share-email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByTestId("share-submit"));

    expect(await screen.findByTestId("guest-list-error")).toHaveTextContent(
      "Enter the email address they use on Ówàńbè",
    );
    expect(api.share).not.toHaveBeenCalled();
  });

  it("shares with a verified platform user and says what they will see", async () => {
    const api = stubApi();
    render(<GuestListCard list={list()} api={api} onChanged={async () => {}} />);

    fireEvent.change(await screen.findByTestId("share-email"), {
      target: { value: " Ada@Example.com " },
    });
    fireEvent.click(screen.getByTestId("share-submit"));

    await waitFor(() => expect(api.share).toHaveBeenCalledWith(LIST_ID, "ada@example.com", 2));
    expect(await screen.findByTestId("guest-list-notice")).toHaveTextContent(
      "never phone numbers or addresses",
    );
  });

  it("removes access on request", async () => {
    const api = stubApi();
    render(<GuestListCard list={list()} api={api} onChanged={async () => {}} />);

    fireEvent.click(await screen.findByTestId("revoke-share"));

    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(LIST_ID, "s-1", 2));
    expect(await screen.findByTestId("guest-list-notice")).toHaveTextContent("Access removed.");
  });

  it("re-reads the list when the version moved, and explains the refusal", async () => {
    const onChanged = vi.fn(async () => {});
    const api = stubApi({
      setVisibility: vi.fn(async () => {
        throw new GuestListError("stale_version", "stale_version: expected 2, found 3");
      }),
    });
    render(<GuestListCard list={list()} api={api} onChanged={onChanged} />);

    fireEvent.click(await screen.findByTestId("visibility-public"));

    expect(await screen.findByTestId("guest-list-error")).toHaveTextContent(
      "This list changed while you were reading it",
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("offers a retry when the guest rows cannot be read", async () => {
    const rsvps = vi
      .fn()
      .mockRejectedValueOnce(new GuestListError("unknown", "boom"))
      .mockResolvedValueOnce(RSVPS);
    render(<GuestListCard list={list()} api={stubApi({ rsvps })} onChanged={async () => {}} />);

    expect(await screen.findByTestId("guests-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("guest-row")).toBeInTheDocument();
  });
});
