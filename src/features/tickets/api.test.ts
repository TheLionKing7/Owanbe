import { describe, expect, it, vi } from "vitest";
import {
  TicketError,
  classifyTicketError,
  createTicketsApi,
  ticketErrorMessage,
  type AuthenticatedRpc,
} from "./api";

const LIST_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const INVITATION_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const GRANT_ID = "9c3d2e1f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";

function stubRpc(responses: Record<string, unknown>) {
  return vi.fn(async (fn: string) => {
    if (!(fn in responses)) throw new Error(`unexpected call ${fn}`);
    const value = responses[fn];
    if (value instanceof Error) throw value;
    return value;
  });
}

function apiFor(rpc: ReturnType<typeof stubRpc>) {
  return createTicketsApi(rpc as unknown as AuthenticatedRpc);
}

describe("tickets api", () => {
  it("maps database refusals to the codes the host is told", () => {
    expect(classifyTicketError("stale_version: expected 2, found 3")).toBe("stale_version");
    expect(classifyTicketError("forbidden: guest lists in house")).toBe("forbidden");
    expect(classifyTicketError("invitation_not_found")).toBe("not_found");
    expect(classifyTicketError("invalid_claim_limit")).toBe("validation");
    expect(classifyTicketError("something else")).toBe("unknown");
  });

  it("uses the field's own words for a validation refusal", () => {
    expect(ticketErrorMessage(new TicketError("validation", "Choose a guest list"))).toBe(
      "Choose a guest list",
    );
    expect(ticketErrorMessage(new TicketError("forbidden", "forbidden"))).toBe(
      "Only the host of this guest list can do that.",
    );
    expect(ticketErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("issues an invitation through the database, which mints the token", async () => {
    const rpc = stubRpc({
      create_invitation: {
        invitation_id: INVITATION_ID,
        token: "t".repeat(64),
        claim_limit: 2,
        generation: 1,
        claim_deadline: "2026-11-20T23:59:00.000Z",
        admission_expires_at: "2026-12-20T23:59:00.000Z",
        version: 1,
      },
    });
    const api = apiFor(rpc);

    const issued = await api.issue({
      guest_list_id: LIST_ID,
      claim_limit: 2,
      claim_deadline: "2026-11-20T23:59:00.000Z",
      admission_expires_at: "2026-12-20T23:59:00.000Z",
    });

    expect(issued.token).toHaveLength(64);
    expect(rpc).toHaveBeenCalledWith("create_invitation", {
      p_list: LIST_ID,
      p_claim_limit: 2,
      p_claim_deadline: "2026-11-20T23:59:00.000Z",
      p_admission_expires_at: "2026-12-20T23:59:00.000Z",
    });
  });

  it("takes the link back with the version the host is holding", async () => {
    const rpc = stubRpc({ revoke_invitation: 3 });
    const api = apiFor(rpc);

    expect(await api.revoke(INVITATION_ID, 2)).toBe(3);
    expect(rpc).toHaveBeenCalledWith("revoke_invitation", {
      p_invitation: INVITATION_ID,
      p_expected_version: 2,
    });
  });

  it("finds the person who will hold the door device before handing it over", async () => {
    const rpc = stubRpc({
      grantee_for_list: [{ user_id: "u-1", display_name: "Ada" }],
      issue_scanner_grant: {
        grant_id: GRANT_ID,
        device_id: "Gate phone 1",
        grantee_user_id: "u-1",
        expires_at: "2026-11-20T23:59:00.000Z",
        version: 1,
      },
    });
    const api = apiFor(rpc);

    const grantId = await api.issueScannerGrant({
      guest_list_id: LIST_ID,
      device_id: "Gate phone 1",
      grantee_email: "door@example.com",
      expires_at: "2026-11-20T23:59:00.000Z",
    });

    expect(grantId).toBe(GRANT_ID);
    expect(rpc).toHaveBeenCalledWith("grantee_for_list", {
      p_list: LIST_ID,
      p_email: "door@example.com",
    });
    expect(rpc).toHaveBeenCalledWith("issue_scanner_grant", {
      p_list: LIST_ID,
      p_device_id: "Gate phone 1",
      p_grantee: "u-1",
      p_expires_at: "2026-11-20T23:59:00.000Z",
    });
  });

  it("refuses to hand a device to a person who is not on the platform", async () => {
    const rpc = stubRpc({ grantee_for_list: [] });
    const api = apiFor(rpc);

    await expect(
      api.issueScannerGrant({
        guest_list_id: LIST_ID,
        device_id: "Gate phone 1",
        grantee_email: "stranger@example.com",
        expires_at: "2026-11-20T23:59:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("turns the database's own refusal into the host's code", async () => {
    const rpc = stubRpc({ revoke_invitation: new Error("stale_version: expected 1, found 2") });
    const api = apiFor(rpc);

    await expect(api.revoke(INVITATION_ID, 1)).rejects.toMatchObject({ code: "stale_version" });
  });
});
