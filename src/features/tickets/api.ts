/**
 * F-108 host-side boundary. Every call is a database function that decides for itself whether the
 * caller owns the guest list, so this module never grants anything: it forwards the caller's own
 * session to Postgres and explains the refusal.
 *
 * The link a host shares is minted by the database and exists once, in the host's hands. The token
 * is never stored here, never logged, and never shown twice.
 */
import type { GuestListSummary } from "@/features/guest-lists/contracts";
import type {
  ClaimLimit,
  HostCheckin,
  HostInvitation,
  IssuedInvitation,
  ScannerGrant,
} from "./contracts";

export type TicketErrorCode =
  | "forbidden"
  | "stale_version"
  | "not_found"
  | "validation"
  | "unauthorized"
  | "unconfigured"
  | "unknown";

export class TicketError extends Error {
  constructor(
    readonly code: TicketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TicketError";
  }
}

export function classifyTicketError(message: string): TicketErrorCode {
  const text = message.toLowerCase();
  if (text.includes("stale_version")) return "stale_version";
  if (text.includes("not_found")) return "not_found";
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("auth_not_configured") || text.includes("invalid_token")) return "unconfigured";
  if (text.includes("invalid_") || text.includes("violates check constraint")) return "validation";
  return "unknown";
}

export const TICKET_ERROR_COPY: Record<TicketErrorCode, string> = {
  forbidden: "Only the host of this guest list can do that.",
  stale_version: "This invitation changed while you were reading it. The latest version is below.",
  not_found: "We could not find that invitation.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to manage your guest lists.",
  unconfigured: "Sign-in is not configured in this environment, so invitations stay locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function ticketErrorMessage(error: unknown): string {
  if (error instanceof TicketError) {
    return error.code === "validation" ? error.message : TICKET_ERROR_COPY[error.code];
  }
  return TICKET_ERROR_COPY.unknown;
}

/** The caller's own database session. The database, not this module, decides what it may do. */
export type AuthenticatedRpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export interface IssueInvitationInput {
  guest_list_id: string;
  claim_limit: ClaimLimit;
  claim_deadline: string;
  admission_expires_at: string;
}

export interface IssueScannerGrantInput {
  guest_list_id: string;
  device_id: string;
  grantee_email: string;
  expires_at: string;
}

export interface TicketsApi {
  lists(houseId: string): Promise<GuestListSummary[]>;
  invitations(listId: string): Promise<HostInvitation[]>;
  issue(input: IssueInvitationInput): Promise<IssuedInvitation>;
  reissue(invitationId: string, version: number): Promise<IssuedInvitation>;
  revoke(invitationId: string, version: number): Promise<number>;
  scannerGrants(listId: string): Promise<ScannerGrant[]>;
  issueScannerGrant(input: IssueScannerGrantInput): Promise<string>;
  revokeScannerGrant(grantId: string, version: number): Promise<number>;
  checkins(listId: string): Promise<HostCheckin[]>;
}

export function createTicketsApi(rpc: AuthenticatedRpc): TicketsApi {
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      return await rpc<T>(name, args);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new TicketError(classifyTicketError(message), message);
    }
  }

  return {
    lists: (houseId) => call<GuestListSummary[]>("my_guest_lists", { p_house: houseId }),
    invitations: (listId) => call<HostInvitation[]>("host_invitations", { p_list: listId }),
    issue: (input) =>
      call<IssuedInvitation>("create_invitation", {
        p_list: input.guest_list_id,
        p_claim_limit: input.claim_limit,
        p_claim_deadline: input.claim_deadline,
        p_admission_expires_at: input.admission_expires_at,
      }),
    reissue: (invitationId, version) =>
      call<IssuedInvitation>("reissue_invitation", {
        p_invitation: invitationId,
        p_expected_version: version,
      }),
    revoke: (invitationId, version) =>
      call<number>("revoke_invitation", {
        p_invitation: invitationId,
        p_expected_version: version,
      }),
    scannerGrants: (listId) => call<ScannerGrant[]>("host_scanner_grants", { p_list: listId }),
    issueScannerGrant: async (input) => {
      const people = await call<{ user_id: string; display_name: string }[]>("grantee_for_list", {
        p_list: input.guest_list_id,
        p_email: input.grantee_email,
      });
      const person = people[0];
      if (!person) throw new TicketError("not_found", "grantee_not_found");
      const issued = await call<{ grant_id: string }>("issue_scanner_grant", {
        p_list: input.guest_list_id,
        p_device_id: input.device_id,
        p_grantee: person.user_id,
        p_expires_at: input.expires_at,
      });
      return issued.grant_id;
    },
    revokeScannerGrant: (grantId, version) =>
      call<number>("revoke_scanner_grant", {
        p_grant: grantId,
        p_expected_version: version,
      }),
    checkins: (listId) => call<HostCheckin[]>("host_checkins", { p_list: listId }),
  };
}
