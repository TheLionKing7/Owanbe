import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GuestListError,
  classifyGuestListError,
  guestListErrorMessage,
  shareGuestList,
} from "./api";

const LIST_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guest list api", () => {
  it("maps database refusals to the codes the UI explains", () => {
    expect(classifyGuestListError("stale_version: expected 2, found 3")).toBe("stale_version");
    expect(classifyGuestListError("forbidden: guest lists in house")).toBe("forbidden");
    expect(classifyGuestListError("recipient_not_found")).toBe("not_found");
    expect(classifyGuestListError("already_shared")).toBe("already_shared");
    expect(classifyGuestListError("invalid_recipient")).toBe("validation");
    expect(classifyGuestListError("something else")).toBe("unknown");
  });

  it("uses the field's own words for a validation refusal", () => {
    expect(
      guestListErrorMessage(new GuestListError("validation", "Enter their email address")),
    ).toBe("Enter their email address");
    expect(guestListErrorMessage(new GuestListError("forbidden", "forbidden"))).toBe(
      "Only the host of this guest list can do that.",
    );
    expect(guestListErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("sends the caller's token to the share route and returns the new version", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: 4 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const version = await shareGuestList(
      LIST_ID,
      { grantee_email: "ada@example.com", expected_version: 3 },
      "header.payload.signature",
    );

    expect(version).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/guest-lists/${LIST_ID}/share`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer header.payload.signature",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      grantee_email: "ada@example.com",
      expected_version: 3,
    });
  });

  it("refuses to share without a signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: 4 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      shareGuestList(LIST_ID, { grantee_email: "ada@example.com", expected_version: 3 }, null),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the server's refusal code back to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "stale_version", message: "moved" }, 409)),
    );
    await expect(
      shareGuestList(LIST_ID, { grantee_email: "ada@example.com", expected_version: 3 }, "a.b.c"),
    ).rejects.toMatchObject({ code: "stale_version" });
  });
});
