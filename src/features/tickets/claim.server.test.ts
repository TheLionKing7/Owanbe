import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimInvitationAsCaller, readGuestCardAsCaller } from "./claim.server";

const TOKEN = "a".repeat(64);
const SESSION = "b".repeat(64);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function claimRequest(body: unknown): Request {
  return new Request("https://owanbe.app/api/invitations/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cardRequest(body: unknown): Request {
  return new Request("https://owanbe.app/api/invitations/card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubNetwork(body: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: (init.body as string) ?? "",
    });
    return jsonResponse(body, status);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/invitations/claim", () => {
  it("asks the database to claim the link as the anonymous role", async () => {
    const { calls } = stubNetwork({
      guest_session: SESSION,
      admission_credential: "c".repeat(64),
      event_title: "Tolu and Ife's wedding",
      slot: 1,
      claim_limit: 1,
      claim_deadline: "2026-11-20T23:59:00.000Z",
      admission_expires_at: "2026-12-20T23:59:00.000Z",
    });

    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(200);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/claim_invitation");
    const body = (await res.json()) as { admission_credential: string };
    expect(body.admission_credential).toHaveLength(64);
  });

  it("never answers with the link the guest sent", async () => {
    stubNetwork({
      guest_session: SESSION,
      admission_credential: "c".repeat(64),
      event_title: "Tolu and Ife's wedding",
      slot: 1,
      claim_limit: 1,
    });

    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("08012345678");
  });

  it("refuses a claim that is missing a name or a phone", async () => {
    const { fetchMock } = stubNetwork({});
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "", phone: "" }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns the database's refusal into what the guest is told", async () => {
    stubNetwork({ code: "P0002", message: "invitation_expired" }, 404);
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("expired");
    expect(body.message).not.toContain("invitation_expired");
  });

  it("says a claimed link is claimed", async () => {
    stubNetwork({ code: "P0002", message: "invitation_claimed" }, 404);
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("claimed");
  });

  it("keeps a link that does not exist indistinguishable from one that was revoked", async () => {
    stubNetwork({ code: "P0002", message: "invitation_not_found" }, 404);
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("keeps the invitation service locked when it is not configured", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "");
    stubNetwork({});
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(503);
  });

  it("refuses a secret key rather than acting as the server", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_secret_example");
    const { fetchMock } = stubNetwork({});
    const res = await claimInvitationAsCaller(
      claimRequest({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    );

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/invitations/card", () => {
  it("reads the card with the guest's own session", async () => {
    const { calls } = stubNetwork({
      event_title: "Tolu and Ife's wedding",
      display_name: "Ada",
      slot: 1,
      status: "issued",
      expires_at: "2026-12-20T23:59:00.000Z",
      admission_credential: "c".repeat(64),
    });

    const res = await readGuestCardAsCaller(cardRequest({ guest_session: SESSION }));

    expect(res.status).toBe(200);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/my_claimed_card");
    const body = (await res.json()) as { display_name: string };
    expect(body.display_name).toBe("Ada");
  });

  it("does not answer with a card when the session is not one of ours", async () => {
    stubNetwork({ code: "P0002", message: "card_not_found" }, 404);
    const res = await readGuestCardAsCaller(cardRequest({ guest_session: SESSION }));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("refuses a session that is too short to be one", async () => {
    const { fetchMock } = stubNetwork({});
    const res = await readGuestCardAsCaller(cardRequest({ guest_session: "short" }));

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
