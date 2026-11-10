import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatError,
  attachmentLink,
  chatErrorMessage,
  classifyChatError,
  fetchConversation,
  postMessage,
  uploadAttachment,
} from "./api";

const CONVERSATION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat api", () => {
  it("maps database refusals to the codes the UI explains", () => {
    expect(classifyChatError("forbidden: conversation")).toBe("forbidden");
    expect(classifyChatError("conversation_not_found")).toBe("not_found");
    expect(classifyChatError("vendor_not_found")).toBe("not_found");
    expect(classifyChatError("invalid_message")).toBe("validation");
    expect(classifyChatError("not_signed_in")).toBe("unauthorized");
    expect(classifyChatError("something else")).toBe("unknown");
  });

  it("uses the field's own words for a validation refusal", () => {
    expect(
      chatErrorMessage(new ChatError("validation", "Write a message before sending it.")),
    ).toBe("Write a message before sending it.");
    expect(chatErrorMessage(new ChatError("forbidden", "forbidden"))).toBe(
      "You are not part of this conversation, so you cannot read or reply to it.",
    );
    expect(chatErrorMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again in a moment.",
    );
  });

  it("reads the conversation through the app's own route with the caller's token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          conversation_id: CONVERSATION_ID,
          side: "host",
          counterparty_name: "Adeola Cakes",
          counterparty_slug: "adeola-cakes",
          messages: [
            {
              message_id: "m-1",
              sender_side: "vendor",
              sender_name: "Ade",
              body: "Yes, 12 December works.",
              sent_at: "2026-11-09T10:00:00.000Z",
              mine: false,
            },
          ],
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const thread = await fetchConversation(CONVERSATION_ID, "header.payload.signature");

    expect(thread.counterparty_name).toBe("Adeola Cakes");
    expect(thread.messages).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/chats/${CONVERSATION_ID}`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer header.payload.signature",
    );
  });

  it("refuses to read or write without a signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchConversation(CONVERSATION_ID, null)).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(postMessage(CONVERSATION_ID, "hello", null)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a message to the conversation's message route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message_id: "m-2" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const messageId = await postMessage(CONVERSATION_ID, "Can you do 12 December?", "a.b.c");

    expect(messageId).toBe("m-2");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/chats/${CONVERSATION_ID}/messages`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ body: "Can you do 12 December?" });
  });

  it("carries the route's refusal code back to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "forbidden", message: "not yours" }, 403)),
    );
    await expect(postMessage(CONVERSATION_ID, "hello", "a.b.c")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("uploads a document to the conversation's attachment route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          path: `conversations/${CONVERSATION_ID}/file.pdf`,
          file_name: "quote.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1])], "quote.pdf", { type: "application/pdf" });
    const uploaded = await uploadAttachment(CONVERSATION_ID, file, "a.b.c");

    expect(uploaded.file_name).toBe("quote.pdf");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/chats/${CONVERSATION_ID}/attachments`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer a.b.c");
  });

  it("asks for the short-lived link of a document", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/file.pdf?token=x",
          file_name: "quote.pdf",
          content_type: "application/pdf",
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const link = await attachmentLink(CONVERSATION_ID, "a-1", "a.b.c");

    expect(link.file_name).toBe("quote.pdf");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`/api/chats/${CONVERSATION_ID}/attachments/a-1`);
  });

  it("refuses to upload or link without a signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadAttachment(CONVERSATION_ID, new File(["x"], "a.pdf"), null),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(attachmentLink(CONVERSATION_ID, "a-1", null)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
