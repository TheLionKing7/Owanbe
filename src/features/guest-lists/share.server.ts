/**
 * F-40 server-only boundary for POST /api/guest-lists/:id/share.
 *
 * The caller's own token is forwarded to PostgREST, so `share_guest_list` runs as that user and the
 * database decides whether they own the list. No service-role key is read here, and the recipient's
 * email address is never logged or echoed back.
 */
import { shareRequestSchema } from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQLSTATE raised by the migration → what the browser is told. Raw database text is not returned. */
const STATUS_BY_CODE: Record<string, { status: number; error: string; message: string }> = {
  "42501": { status: 403, error: "forbidden", message: "Only the host of this list can share it." },
  P0002: {
    status: 404,
    error: "not_found",
    message: "We could not find that list, or that person is not on Ówàńbè yet.",
  },
  "40001": {
    status: 409,
    error: "stale_version",
    message: "This list changed while you were reading it. The latest version is shown below.",
  },
  "22023": { status: 400, error: "validation", message: "Check the email address and try again." },
  "23505": {
    status: 409,
    error: "already_shared",
    message: "That person already has access to this list.",
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function shareGuestListAsCaller(request: Request, listId: string): Promise<Response> {
  if (!UUID_PATTERN.test(listId)) {
    return json({ error: "validation", message: "That guest list link is not valid." }, 400);
  }

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.split(".").length !== 3) {
    return json({ error: "unauthorized", message: "Sign in to share a guest list." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check the details and try again." }, 400);
  }
  const parsed = shareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      },
      400,
    );
  }

  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  // A secret key would act as the server, not as the caller, so it is refused rather than used.
  if (!url || !key || key.startsWith("sb_secret_")) {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so guest lists stay locked.",
      },
      503,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/share_guest_list`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_list: listId,
        p_grantee_email: parsed.data.grantee_email,
        p_expected_version: parsed.data.expected_version,
      }),
    });
  } catch {
    return json(
      {
        error: "unknown",
        message: "We could not reach guest list sharing. Try again in a moment.",
      },
      502,
    );
  }

  if (!res.ok) {
    let code = "";
    try {
      code = String(((await res.json()) as { code?: unknown }).code ?? "");
    } catch {
      code = "";
    }
    const mapped = STATUS_BY_CODE[code];
    if (mapped) return json({ error: mapped.error, message: mapped.message }, mapped.status);
    console.error("share_guest_list failed", res.status, code);
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }

  const version: unknown = await res.json();
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  return json({ version }, 200);
}
