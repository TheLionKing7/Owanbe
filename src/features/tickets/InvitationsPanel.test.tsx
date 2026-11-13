import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseSummary } from "@/lib/auth/types";
import { InvitationsPanel } from "./InvitationsPanel";
import { TicketError, type TicketsApi } from "./api";
import type { HostCheckin, HostInvitation, ScannerGrant } from "./contracts";

const HOUSE_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const LIST_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const INVITATION_ID = "9c3d2e1f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
const GRANT_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

const HOUSE: HouseSummary = {
  house_id: HOUSE_ID,
  kind: "host",
  display_name: "Tolu and Ife's wedding",
  role: "owner",
  capabilities: ["quotes"],
};

const INVITATION: HostInvitation = {
  invitation_id: INVITATION_ID,
  claim_limit: 2 as const,
  generation: 1,
  status: "issued" as const,
  claim_deadline: "2026-11-20T23:59:00.000Z",
  admission_expires_at: "2026-12-20T23:59:00.000Z",
  claimed_count: 0,
  token_fingerprint: "9f8e7d6c",
  created_at: "2026-11-13T10:00:00.000Z",
  updated_at: "2026-11-13T10:00:00.000Z",
  version: 1,
};

const GRANT: ScannerGrant = {
  grant_id: GRANT_ID,
  device_id: "Gate phone 1",
  grantee_user_id: "u-1",
  granted_by: "u-host",
  expires_at: "2026-11-20T23:59:00.000Z",
  revoked_at: null,
  created_at: "2026-11-13T10:00:00.000Z",
  version: 1,
};

const CHECKIN: HostCheckin = {
  checkin_id: "c-1",
  display_name: "Ada",
  result: "admitted" as const,
  mode: "online" as const,
  device_id: "Gate phone 1",
  occurred_at: "2026-11-13T10:05:00.000Z",
  created_at: "2026-11-13T10:05:00.000Z",
};

function stubApi(overrides: Partial<TicketsApi> = {}): TicketsApi {
  return {
    lists: vi.fn(async () => [
      {
        list_id: LIST_ID,
        title: "Tolu and Ife's wedding",
        visibility: "private" as const,
        version: 1,
        guest_count: 2,
        yes_count: 1,
        share_count: 0,
        created_at: "2026-11-08T10:00:00.000Z",
      },
    ]),
    invitations: vi.fn(async () => [INVITATION]),
    issue: vi.fn(async () => ({
      invitation_id: INVITATION_ID,
      token: "t".repeat(64),
      claim_limit: 2 as const,
      generation: 1,
      claim_deadline: "2026-11-20T23:59:00.000Z",
      admission_expires_at: "2026-12-20T23:59:00.000Z",
      version: 1,
    })),
    reissue: vi.fn(async () => ({
      invitation_id: INVITATION_ID,
      token: "n".repeat(64),
      claim_limit: 2 as const,
      generation: 2,
      claim_deadline: "2026-11-20T23:59:00.000Z",
      admission_expires_at: "2026-12-20T23:59:00.000Z",
      version: 2,
    })),
    revoke: vi.fn(async () => 2),
    scannerGrants: vi.fn(async () => [GRANT]),
    issueScannerGrant: vi.fn(async () => GRANT_ID),
    revokeScannerGrant: vi.fn(async () => 2),
    checkins: vi.fn(async () => [CHECKIN]),
    ...overrides,
  };
}

const NO_RPC = vi.fn(async () => undefined) as never;

afterEach(cleanup);

describe("InvitationsPanel", () => {
  it("offers the host's guest lists and issues a link from one of them", async () => {
    const api = stubApi();
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={api} />);

    const select = await screen.findByTestId("invitation-list");
    expect(select).toHaveValue(LIST_ID);

    fireEvent.click(screen.getByTestId("claim-limit-2"));
    fireEvent.click(screen.getByTestId("issue-invitation"));

    await waitFor(() => expect(api.issue).toHaveBeenCalled());
    const input = (api.issue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      guest_list_id: string;
      claim_limit: number;
    };
    expect(input.guest_list_id).toBe(LIST_ID);
    expect(input.claim_limit).toBe(2);
  });

  it("shows the link once and says it is the only time", async () => {
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={stubApi()} />);

    fireEvent.click(await screen.findByTestId("issue-invitation"));

    const issued = await screen.findByTestId("issued-link");
    expect(issued).toHaveTextContent("Copy this link now");
    expect(issued).toHaveTextContent("only time the link is shown");
  });

  it("refuses a card that stops working before the claim deadline", async () => {
    const api = stubApi();
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={api} />);

    await screen.findByTestId("invitation-list");
    fireEvent.change(screen.getByTestId("claim-deadline"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByTestId("admission-expiry"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByTestId("issue-invitation"));

    expect(await screen.findByTestId("issue-error")).toHaveTextContent(
      "The card must stop working on or after the last day to claim.",
    );
    expect(api.issue).not.toHaveBeenCalled();
  });

  it("lists the links the host has issued, with what was claimed", async () => {
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={stubApi()} />);

    const list = await screen.findByTestId("invitations-list");
    expect(list).toHaveTextContent("Waiting for a claim");
    expect(list).toHaveTextContent("0 of 2 claimed");
    expect(list).toHaveTextContent("9f8e7d6c");
  });

  it("takes a link back and can issue a fresh one", async () => {
    const api = stubApi();
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={api} />);

    fireEvent.click(await screen.findByTestId("revoke-invitation"));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(INVITATION_ID, 1));

    fireEvent.click(screen.getByTestId("reissue-invitation"));
    await waitFor(() => expect(api.reissue).toHaveBeenCalledWith(INVITATION_ID, 1));
  });

  it("hands the door device to a named person", async () => {
    const api = stubApi();
    render(<InvitationsPanel house={HOUSE} rpc={NO_RPC} api={api} />);

    fireEvent.change(await screen.findByTestId("device-id"), { target: { value: "Gate phone 2" } });
    fireEvent.change(screen.getByTestId("grantee-email"), {
      target: { value: "door@example.com" },
    });
    fireEvent.click(screen.getByTestId("issue-grant"));

    await waitFor(() => expect(api.issueScannerGrant).toHaveBeenCalled());
    const input = (api.issueScannerGrant as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      device_id: string;
      grantee_email: string;
    };
    expect(input.device_id).toBe("Gate phone 2");
    expect(input.grantee_email).toBe("door@example.com");
  });

  it("shows the record the door leaves, duplicates included", async () => {
    render(
      <InvitationsPanel
        house={HOUSE}
        rpc={NO_RPC}
        api={stubApi({
          checkins: vi.fn(async () => [
            CHECKIN,
            { ...CHECKIN, checkin_id: "c-2", display_name: "Tunde", result: "duplicate" as const },
          ]),
        })}
      />,
    );

    const list = await screen.findByTestId("checkins-list");
    expect(list).toHaveTextContent("Ada");
    expect(list).toHaveTextContent("Admitted");
    expect(list).toHaveTextContent("Already admitted");
  });

  it("explains a failure and keeps the host's work on screen", async () => {
    render(
      <InvitationsPanel
        house={HOUSE}
        rpc={NO_RPC}
        api={stubApi({
          issue: vi.fn(async () => {
            throw new TicketError("forbidden", "forbidden: guest lists in house");
          }),
        })}
      />,
    );

    fireEvent.click(await screen.findByTestId("issue-invitation"));

    expect(await screen.findByTestId("issue-error")).toHaveTextContent(
      "Only the host of this guest list can do that.",
    );
  });

  it("explains an empty house", async () => {
    render(
      <InvitationsPanel
        house={HOUSE}
        rpc={NO_RPC}
        api={stubApi({ lists: vi.fn(async () => []) })}
      />,
    );

    expect(await screen.findByTestId("lists-empty")).toHaveTextContent("no guest lists yet");
  });
});
