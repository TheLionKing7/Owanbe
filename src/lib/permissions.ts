/**
 * F-78 role matrix. The database (supabase/pending/*_f78_permission_scoping.sql) is the
 * enforcement point; this mirror only drives UI hints and server-side pre-checks.
 */
export const HOUSE_CAPABILITIES = ["chat", "quotes", "calendar", "profile", "bookings", "payouts", "members", "billing"] as const;
export type HouseCapability = (typeof HOUSE_CAPABILITIES)[number];

/** Never delegable to vendor staff. */
export const OWNER_ONLY: readonly HouseCapability[] = ["payouts", "members", "billing"];

export type PlatformCapability = "support" | "finance" | "operations" | "arbitrator" | "event_manager" | "verification_reviewer";

export interface Membership {
  role: "owner" | "staff";
  capabilities: readonly string[];
  revoked?: boolean;
}

export function houseCan(membership: Membership | null | undefined, capability: string): boolean {
  if (!membership || membership.revoked) return false;
  if (!(HOUSE_CAPABILITIES as readonly string[]).includes(capability)) return false;
  if (membership.role === "owner") return true;
  if ((OWNER_ONLY as readonly string[]).includes(capability)) return false;
  return membership.capabilities.includes(capability);
}

/** Capabilities an owner may grant to staff; throws on owner-only ones. */
export function validateStaffCapabilities(capabilities: readonly string[]): HouseCapability[] {
  for (const c of capabilities) {
    if (!(HOUSE_CAPABILITIES as readonly string[]).includes(c)) throw new Error(`unknown_capability:${c}`);
    if ((OWNER_ONLY as readonly string[]).includes(c)) throw new Error(`owner_only_capability:${c}`);
  }
  return [...new Set(capabilities)] as HouseCapability[];
}

/** Platform staff reads of house data are allowed only with a purpose (logged server-side). */
export function isValidAccessPurpose(purpose: string | null | undefined): boolean {
  return typeof purpose === "string" && purpose.trim().length >= 10;
}
