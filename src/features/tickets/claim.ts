/**
 * F-108 guest side. A guest with an invitation link needs no account: they give a name and a
 * phone, and the platform keeps only a hash of the phone. The link is claimed through the platform's
 * own route so the guest's session and card never pass through a browser that is not signed in.
 */
import {
  claimRequestSchema,
  guestSessionSchema,
  type ClaimLimit,
  type ClaimedInvitation,
  type ClaimRequest,
  type GuestCard,
} from "./contracts";

export type ClaimErrorCode =
  "not_found" | "expired" | "claimed" | "validation" | "unavailable" | "network" | "unknown";

export class ClaimError extends Error {
  constructor(
    readonly code: ClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

export function classifyClaimError(message: string): ClaimErrorCode {
  const text = message.toLowerCase();
  if (text.includes("invitation_not_found") || text.includes("card_not_found")) return "not_found";
  if (text.includes("invitation_expired")) return "expired";
  if (text.includes("invitation_claimed")) return "claimed";
  if (text.includes("invalid_")) return "validation";
  return "unknown";
}

export const CLAIM_ERROR_COPY: Record<ClaimErrorCode, string> = {
  not_found: "This invitation link is not valid any more. Ask the host for a new one.",
  expired: "The deadline to claim this invitation has passed. Ask the host for a new one.",
  claimed:
    "This invitation has already been claimed. If that was you, open your card from this device.",
  validation: "Check the details and try again.",
  unavailable: "We could not reach the invitation service. Try again in a moment.",
  network: "We could not reach the platform. Check your connection and try again.",
  unknown: "Something went wrong. Try again in a moment.",
};

export function claimErrorMessage(error: unknown): string {
  if (error instanceof ClaimError) {
    return error.code === "validation" ? error.message : CLAIM_ERROR_COPY[error.code];
  }
  return CLAIM_ERROR_COPY.unknown;
}

interface ApiBody {
  error?: unknown;
  message?: unknown;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ClaimError("network", "claim_request_failed");
  }
  const parsed = (await res.json().catch(() => null)) as ApiBody | null;
  if (!res.ok) {
    const code = typeof parsed?.error === "string" ? parsed.error : "unknown";
    const message = typeof parsed?.message === "string" ? parsed.message : "claim_failed";
    throw new ClaimError(
      code === "not_found" || code === "expired" || code === "claimed" || code === "validation"
        ? code
        : code === "unavailable"
          ? "unavailable"
          : "unknown",
      message,
    );
  }
  return (parsed ?? {}) as Record<string, unknown>;
}

/** F-108 wiring: the browser half of POST /api/invitations/claim. */
export async function claimInvitation(input: ClaimRequest): Promise<ClaimedInvitation> {
  const parsed = claimRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ClaimError("validation", parsed.error.issues[0]?.message ?? "Check the details.");
  }
  const body = await post("/api/invitations/claim", parsed.data);
  return {
    guest_session: String(body["guest_session"] ?? ""),
    admission_credential: String(body["admission_credential"] ?? ""),
    event_title: String(body["event_title"] ?? ""),
    slot: Number(body["slot"] ?? 0),
    claim_limit: (Number(body["claim_limit"] ?? 1) === 2 ? 2 : 1) as ClaimLimit,
    claim_deadline: String(body["claim_deadline"] ?? ""),
    admission_expires_at: String(body["admission_expires_at"] ?? ""),
  };
}

/** The guest's own card, read with the guest's own session. */
export async function readGuestCard(guestSession: string): Promise<GuestCard> {
  const parsed = guestSessionSchema.safeParse({ guest_session: guestSession });
  if (!parsed.success) {
    throw new ClaimError(
      "not_found",
      parsed.error.issues[0]?.message ?? "That card could not be found.",
    );
  }
  const body = await post("/api/invitations/card", parsed.data);
  return {
    event_title: String(body["event_title"] ?? ""),
    display_name: String(body["display_name"] ?? ""),
    slot: Number(body["slot"] ?? 0),
    status: (body["status"] as GuestCard["status"]) ?? "issued",
    expires_at: String(body["expires_at"] ?? ""),
    admission_credential:
      typeof body["admission_credential"] === "string" ? body["admission_credential"] : null,
  };
}
