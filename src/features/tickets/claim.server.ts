/**
 * F-108 server-only boundary for the guest side: POST /api/invitations/claim and
 * POST /api/invitations/card.
 *
 * The guest needs no account, so there is no caller token to forward. The platform's own
 * publishable key is used, which acts as the anonymous role, and the database decides what an
 * anonymous caller may do: claim a link with a name and a phone, or read their own card with
 * their own session. A secret key would act as the server and is refused rather than used.
 *
 * The token, the phone and the guest's session are never written to a log or echoed back.
 */
import { claimRequestSchema, guestSessionSchema } from "./contracts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** The publishable key only: a secret key would answer as the server, not as the guest. */
function guestCredentials(): { url: string; key: string } | null {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ??
    process.env["SUPABASE_ANON_KEY"] ??
    process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

async function callAsGuest(
  rpc: string,
  payload: Record<string, unknown>,
): Promise<
  { ok: true; body: unknown } | { ok: false; status: number; error: string; message: string }
> {
  const credentials = guestCredentials();
  if (!credentials) {
    return {
      ok: false,
      status: 503,
      error: "unavailable",
      message: "We could not reach the invitation service. Try again in a moment.",
    };
  }
  const headers: Record<string, string> = {
    apikey: credentials.key,
    "Content-Type": "application/json",
  };
  // New Supabase keys are opaque strings, not bearer tokens; the apikey header carries them.
  if (!credentials.key.startsWith("sb_")) headers["Authorization"] = `Bearer ${credentials.key}`;

  let res: Response;
  try {
    res = await fetch(`${credentials.url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "unavailable",
      message: "We could not reach the invitation service. Try again in a moment.",
    };
  }
  if (!res.ok) return { ok: false, ...(await refusal(res)) };
  return { ok: true, body: await res.json().catch(() => null) };
}

/** The database's own refusal, turned into what the guest is told. Raw text is not returned. */
async function refusal(res: Response): Promise<{ status: number; error: string; message: string }> {
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    code = String(body.code ?? "");
    message = String(body.message ?? "");
  } catch {
    code = "";
  }

  if (message.includes("invitation_expired")) {
    return {
      status: 410,
      error: "expired",
      message: "The deadline to claim this invitation has passed. Ask the host for a new one.",
    };
  }
  if (message.includes("invitation_claimed")) {
    return {
      status: 409,
      error: "claimed",
      message:
        "This invitation has already been claimed. If that was you, open your card from this device.",
    };
  }
  if (message.includes("invalid_guest_name")) {
    return { status: 400, error: "validation", message: "Who is this invitation for?" };
  }
  if (message.includes("invalid_phone")) {
    return {
      status: 400,
      error: "validation",
      message: "Enter a phone number we can reach you on.",
    };
  }
  if (message.includes("invitation_not_found") || message.includes("card_not_found")) {
    return {
      status: 404,
      error: "not_found",
      message: "This invitation link is not valid any more. Ask the host for a new one.",
    };
  }
  if (code === "42501") {
    return {
      status: 403,
      error: "not_found",
      message: "This invitation link is not valid any more. Ask the host for a new one.",
    };
  }
  if (code === "22023") {
    return { status: 400, error: "validation", message: "Check the details and try again." };
  }
  if (code === "P0002") {
    return {
      status: 404,
      error: "not_found",
      message: "This invitation link is not valid any more. Ask the host for a new one.",
    };
  }
  console.error("F-108 invitation call failed", res.status, code);
  return {
    status: 502,
    error: "unavailable",
    message: "We could not reach the invitation service. Try again in a moment.",
  };
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** F-108 wiring: POST /api/invitations/claim. A guest claims a link without an account. */
export async function claimInvitationAsCaller(request: Request): Promise<Response> {
  const parsed = claimRequestSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      },
      400,
    );
  }

  const result = await callAsGuest("claim_invitation", {
    p_token: parsed.data.token,
    p_display_name: parsed.data.display_name,
    p_phone: parsed.data.phone,
    p_device_id: parsed.data.device_id ?? null,
  });
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);

  const body = (result.body ?? {}) as Record<string, unknown>;
  return json(
    {
      guest_session: String(body["guest_session"] ?? ""),
      admission_credential: String(body["admission_credential"] ?? ""),
      event_title: String(body["event_title"] ?? ""),
      slot: Number(body["slot"] ?? 0),
      claim_limit: Number(body["claim_limit"] ?? 1),
      claim_deadline: String(body["claim_deadline"] ?? ""),
      admission_expires_at: String(body["admission_expires_at"] ?? ""),
    },
    200,
  );
}

/** F-108 wiring: POST /api/invitations/card. The guest's own card, read with their own session. */
export async function readGuestCardAsCaller(request: Request): Promise<Response> {
  const parsed = guestSessionSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return json(
      { error: "not_found", message: "That card could not be found on this device." },
      404,
    );
  }

  const result = await callAsGuest("my_claimed_card", {
    p_guest_session: parsed.data.guest_session,
  });
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);

  const body = (result.body ?? {}) as Record<string, unknown>;
  return json(
    {
      event_title: String(body["event_title"] ?? ""),
      display_name: String(body["display_name"] ?? ""),
      slot: Number(body["slot"] ?? 0),
      status: String(body["status"] ?? "issued"),
      expires_at: String(body["expires_at"] ?? ""),
      admission_credential:
        typeof body["admission_credential"] === "string" ? body["admission_credential"] : null,
    },
    200,
  );
}
