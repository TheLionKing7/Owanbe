/**
 * F-40 persistence boundary. Reads are authorized projections and writes are `security definer`
 * functions in supabase/migrations/20261108120000_f40_guest_list_privacy.sql; the browser never
 * writes a table directly (RLS is forced and write grants are revoked).
 *
 * Sharing goes through POST /api/guest-lists/:id/share so the caller's token, not a server key,
 * decides who owns the list.
 *
 * `src/integrations/supabase/types.ts` is generated and declares no tables or functions, so the RPC
 * contract is declared here instead of editing a generated file.
 */
import type {
  GuestListSummary,
  GuestListVisibility,
  GuestRecipient,
  GuestRsvp,
  MaskedGuest,
  NewGuestList,
  NewRsvp,
  SharedListSummary,
  ShareRequest,
} from "./contracts";

export type GuestListErrorCode =
  | "forbidden"
  | "stale_version"
  | "not_found"
  | "validation"
  | "already_shared"
  | "unauthorized"
  | "unconfigured"
  | "unknown";

/** Raised for every refusal so the UI can explain it in plain language. */
export class GuestListError extends Error {
  constructor(
    readonly code: GuestListErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuestListError";
  }
}

export function classifyGuestListError(message: string): GuestListErrorCode {
  const text = message.toLowerCase();
  if (text.includes("stale_version")) return "stale_version";
  if (text.includes("already_shared")) return "already_shared";
  if (
    text.includes("guest_list_not_found") ||
    text.includes("share_not_found") ||
    text.includes("recipient_not_found")
  )
    return "not_found";
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("auth_not_configured") || text.includes("invalid_token")) return "unconfigured";
  if (
    text.includes("invalid_title") ||
    text.includes("invalid_guest_name") ||
    text.includes("invalid_response") ||
    text.includes("invalid_contact") ||
    text.includes("invalid_visibility") ||
    text.includes("invalid_recipient") ||
    text.includes("recipient_ambiguous") ||
    text.includes("violates check constraint")
  ) {
    return "validation";
  }
  return "unknown";
}

export const GUEST_LIST_ERROR_COPY: Record<GuestListErrorCode, string> = {
  forbidden: "Only the host of this guest list can do that.",
  stale_version: "This list changed while you were reading it. The latest version is shown below.",
  not_found: "We could not find that guest list, or that person is not on Ówàńbè yet.",
  validation: "Check the details and try again.",
  already_shared: "That person already has access to this list.",
  unauthorized: "Sign in to manage your guest lists.",
  unconfigured: "Sign-in is not configured in this environment, so guest lists stay locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function guestListErrorMessage(error: unknown): string {
  if (error instanceof GuestListError) {
    return error.code === "validation" ? error.message : GUEST_LIST_ERROR_COPY[error.code];
  }
  return GUEST_LIST_ERROR_COPY.unknown;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type RpcClient = (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { supabase } = await import("@/integrations/supabase/client");
  const call = supabase.rpc as unknown as RpcClient;
  const { data, error } = await call(name, args);
  if (error) throw new GuestListError(classifyGuestListError(error.message), error.message);
  return data as T;
}

const ERROR_CODES: readonly GuestListErrorCode[] = [
  "forbidden",
  "stale_version",
  "not_found",
  "validation",
  "already_shared",
  "unauthorized",
  "unconfigured",
  "unknown",
];

/** F-40 wiring: the browser half of POST /api/guest-lists/:id/share. */
export async function shareGuestList(
  listId: string,
  input: ShareRequest,
  accessToken: string | null,
): Promise<number> {
  if (!accessToken) throw new GuestListError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(`/api/guest-lists/${encodeURIComponent(listId)}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new GuestListError("unknown", "share_request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    version?: unknown;
    error?: unknown;
    message?: unknown;
  } | null;
  if (!res.ok) {
    const code = ERROR_CODES.find((candidate) => candidate === body?.error) ?? "unknown";
    throw new GuestListError(
      code,
      typeof body?.message === "string" ? body.message : "share_failed",
    );
  }
  if (typeof body?.version !== "number")
    throw new GuestListError("unknown", "invalid_share_response");
  return body.version;
}

export interface GuestListApi {
  list(houseId: string): Promise<GuestListSummary[]>;
  rsvps(listId: string): Promise<GuestRsvp[]>;
  recipients(listId: string): Promise<GuestRecipient[]>;
  sharedWithMe(): Promise<SharedListSummary[]>;
  sharedList(listId: string): Promise<MaskedGuest[]>;
  create(input: NewGuestList): Promise<string>;
  addRsvp(listId: string, input: NewRsvp): Promise<string>;
  setVisibility(listId: string, visibility: GuestListVisibility, version: number): Promise<number>;
  share(listId: string, granteeEmail: string, version: number): Promise<number>;
  revoke(listId: string, shareId: string, version: number): Promise<number>;
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createGuestListApi(getAccessToken: () => Promise<string | null>): GuestListApi {
  return {
    list: (houseId) => rpc<GuestListSummary[]>("my_guest_lists", { p_house: houseId }),
    rsvps: (listId) => rpc<GuestRsvp[]>("guest_list_rsvps", { p_list: listId }),
    recipients: (listId) => rpc<GuestRecipient[]>("guest_list_recipients", { p_list: listId }),
    sharedWithMe: () => rpc<SharedListSummary[]>("shared_with_me", {}),
    sharedList: (listId) => rpc<MaskedGuest[]>("shared_guest_list", { p_list: listId }),
    create: (input) =>
      rpc<string>("create_guest_list", { p_house: input.house_id, p_title: input.title }),
    addRsvp: (listId, input) =>
      rpc<string>("add_guest_rsvp", {
        p_list: listId,
        p_display_name: input.display_name,
        p_response: input.response,
        p_phone: input.phone ?? null,
        p_address: input.address ?? null,
      }),
    setVisibility: (listId, visibility, version) =>
      rpc<number>("set_guest_list_visibility", {
        p_list: listId,
        p_visibility: visibility,
        p_expected_version: version,
      }),
    share: async (listId, granteeEmail, version) =>
      shareGuestList(
        listId,
        { grantee_email: granteeEmail, expected_version: version },
        await getAccessToken(),
      ),
    revoke: (listId, shareId, version) =>
      rpc<number>("revoke_guest_list_share", {
        p_list: listId,
        p_share: shareId,
        p_expected_version: version,
      }),
  };
}
