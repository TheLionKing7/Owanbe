import { describe, expect, it } from "vitest";
import {
  claimRequestSchema,
  guestSessionSchema,
  issueInvitationSchema,
  scannerGrantSchema,
  inviteLink,
  claimLimitCopy,
} from "./contracts";

const LIST_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const TOKEN = "a".repeat(64);

describe("ticket contracts", () => {
  it("accepts an invitation for one or two people", () => {
    expect(
      issueInvitationSchema.safeParse({
        guest_list_id: LIST_ID,
        claim_limit: 1,
        claim_deadline: "2026-11-20",
        admission_expires_at: "2026-12-20",
      }).success,
    ).toBe(true);
    expect(
      issueInvitationSchema.safeParse({
        guest_list_id: LIST_ID,
        claim_limit: 3,
        claim_deadline: "2026-11-20",
        admission_expires_at: "2026-12-20",
      }).success,
    ).toBe(false);
  });

  it("refuses an invitation without a guest list", () => {
    const parsed = issueInvitationSchema.safeParse({
      guest_list_id: "not-a-uuid",
      claim_limit: 1,
      claim_deadline: "2026-11-20",
      admission_expires_at: "2026-12-20",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe("Choose a guest list");
  });

  it("refuses a claim without a name, a phone or a link", () => {
    expect(
      claimRequestSchema.safeParse({ token: TOKEN, display_name: "  ", phone: "08012345678" })
        .success,
    ).toBe(false);
    expect(
      claimRequestSchema.safeParse({ token: TOKEN, display_name: "Ada", phone: "123" }).success,
    ).toBe(false);
    expect(
      claimRequestSchema.safeParse({ token: "short", display_name: "Ada", phone: "08012345678" })
        .success,
    ).toBe(false);
    expect(
      claimRequestSchema.safeParse({ token: TOKEN, display_name: "Ada", phone: "08012345678" })
        .success,
    ).toBe(true);
  });

  it("refuses a card read without a session", () => {
    expect(guestSessionSchema.safeParse({ guest_session: "short" }).success).toBe(false);
    expect(guestSessionSchema.safeParse({ guest_session: TOKEN }).success).toBe(true);
  });

  it("refuses a scanner grant without a device or a person", () => {
    expect(
      scannerGrantSchema.safeParse({
        guest_list_id: LIST_ID,
        device_id: "  ",
        grantee_email: "door@example.com",
        expires_at: "2026-11-20",
      }).success,
    ).toBe(false);
    expect(
      scannerGrantSchema.safeParse({
        guest_list_id: LIST_ID,
        device_id: "Gate phone 1",
        grantee_email: "not-an-email",
        expires_at: "2026-11-20",
      }).success,
    ).toBe(false);
    expect(
      scannerGrantSchema.safeParse({
        guest_list_id: LIST_ID,
        device_id: "Gate phone 1",
        grantee_email: "door@example.com",
        expires_at: "2026-11-20",
      }).success,
    ).toBe(true);
  });

  it("keeps the token in the path, not in a query string", () => {
    expect(inviteLink(TOKEN)).toBe(`/invite/${TOKEN}`);
    expect(inviteLink(TOKEN)).not.toContain("?");
  });

  it("says what a claim limit of two means", () => {
    expect(claimLimitCopy(1)).toBe("One person");
    expect(claimLimitCopy(2)).toBe("Two people (a couple's link)");
  });
});
