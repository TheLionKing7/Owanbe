import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimError, claimErrorMessage, claimInvitation, readGuestCard } from "./claim";

const TOKEN = "a".repeat(64);
const SESSION = "b".repeat(64);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket claim", () => {
  it("claims a link through the platform's own route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          guest_session: SESSION,
          admission_credential: "c".repeat(64),
          event_title: "Tolu and Ife's wedding",
          slot: 1,
          claim_limit: 2,
          claim_deadline: "2026-11-20T23:59:00.000Z",
          admission_expires_at: "2026-12-20T23:59:00.000Z",
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const claimed = await claimInvitation({
      token: TOKEN,
      display_name: "Ada",
      phone: "08012345678",
    });

    expect(claimed.admission_credential).toHaveLength(64);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/invitations/claim");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      token: TOKEN,
      display_name: "Ada",
      phone: "08012345678",
    });
  });

  it("refuses a claim that is missing a name before it leaves the browser", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      claimInvitation({ token: TOKEN, display_name: "   ", phone: "08012345678" }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the platform's refusal back to the guest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "expired", message: "too late" }, 410)),
    );

    await expect(
      claimInvitation({ token: TOKEN, display_name: "Ada", phone: "08012345678" }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("explains a refusal in the guest's own words", () => {
    expect(claimErrorMessage(new ClaimError("expired", "expired"))).toBe(
      "The deadline to claim this invitation has passed. Ask the host for a new one.",
    );
    expect(claimErrorMessage(new ClaimError("validation", "Who is this for?"))).toBe(
      "Who is this for?",
    );
    expect(claimErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("reads the card back with the guest's own session", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          event_title: "Tolu and Ife's wedding",
          display_name: "Ada",
          slot: 1,
          status: "issued",
          expires_at: "2026-12-20T23:59:00.000Z",
          admission_credential: "c".repeat(64),
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const card = await readGuestCard(SESSION);

    expect(card.display_name).toBe("Ada");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/invitations/card");
    expect(JSON.parse(String(init.body))).toEqual({ guest_session: SESSION });
  });

  it("says a card could not be found rather than reaching the platform", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(readGuestCard("short")).rejects.toMatchObject({ code: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
