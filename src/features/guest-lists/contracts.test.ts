import { describe, expect, it } from "vitest";
import {
  CONTACT_HIDDEN_NOTE,
  maskPreview,
  newGuestListSchema,
  newRsvpSchema,
  publicGuestListPath,
  shareRequestSchema,
} from "./contracts";

const LIST_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

describe("guest list contracts", () => {
  it("keeps contact details out of the shared preview", () => {
    const preview = maskPreview([
      {
        rsvp_id: "r-1",
        display_name: "Tolu",
        response: "yes",
        phone: "08012345678",
        address: "12 Broad Street",
        created_at: "2026-11-08T10:00:00.000Z",
      },
    ]);
    expect(preview).toEqual([{ display_name: "Tolu", response: "yes" }]);
    expect(JSON.stringify(preview)).not.toContain("08012345678");
    expect(JSON.stringify(preview)).not.toContain("Broad Street");
  });

  it("builds the public path from the list id", () => {
    expect(publicGuestListPath(LIST_ID)).toBe(`/guest-lists/${LIST_ID}`);
  });

  it("states the contact rule once, for every visibility", () => {
    expect(CONTACT_HIDDEN_NOTE).toContain("visible to you alone");
  });

  it("refuses a list without a title", () => {
    const parsed = newGuestListSchema.safeParse({ house_id: LIST_ID, title: "   " });
    expect(parsed.success).toBe(false);
  });

  it("refuses a guest without a name and accepts one with contacts", () => {
    expect(newRsvpSchema.safeParse({ display_name: "", response: "invited" }).success).toBe(false);
    expect(
      newRsvpSchema.safeParse({
        display_name: "Tolu",
        response: "yes",
        phone: "08012345678",
        address: "12 Broad Street",
      }).success,
    ).toBe(true);
  });

  it("normalises the recipient email and refuses an invalid one", () => {
    const parsed = shareRequestSchema.safeParse({
      grantee_email: "  ADA@Example.com ",
      expected_version: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.grantee_email).toBe("ada@example.com");
    expect(
      shareRequestSchema.safeParse({ grantee_email: "not-an-email", expected_version: 2 }).success,
    ).toBe(false);
  });
});
