import { describe, expect, it } from "vitest";
import { houseCan, isValidAccessPurpose, validateStaffCapabilities } from "@/lib/permissions";

const owner = { role: "owner" as const, capabilities: [] };
const staff = { role: "staff" as const, capabilities: ["chat", "quotes"] };

describe("F-78 role matrix", () => {
  it("vendor owner can change payouts and administer members", () => {
    expect(houseCan(owner, "payouts")).toBe(true);
    expect(houseCan(owner, "members")).toBe(true);
  });

  it("vendor staff use only granted capabilities", () => {
    expect(houseCan(staff, "quotes")).toBe(true);
    expect(houseCan(staff, "calendar")).toBe(false);
  });

  it("vendor staff can never change payouts, members or billing, even if listed", () => {
    const sneaky = { role: "staff" as const, capabilities: ["payouts", "members", "billing"] };
    expect(houseCan(sneaky, "payouts")).toBe(false);
    expect(houseCan(sneaky, "members")).toBe(false);
    expect(houseCan(sneaky, "billing")).toBe(false);
  });

  it("owners cannot grant owner-only capabilities to staff", () => {
    expect(() => validateStaffCapabilities(["chat", "payouts"])).toThrow("owner_only_capability:payouts");
  });

  it("revoked members and non-members have no access", () => {
    expect(houseCan({ ...owner, revoked: true }, "chat")).toBe(false);
    expect(houseCan(null, "chat")).toBe(false);
  });

  it("sensitive reads require a purpose of at least 10 characters", () => {
    expect(isValidAccessPurpose("short")).toBe(false);
    expect(isValidAccessPurpose("Ticket 4411: login issue")).toBe(true);
  });
});
