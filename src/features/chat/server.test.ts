import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachmentLinkAsCaller,
  conversationAsCaller,
  sendMessageAsCaller,
  uploadAttachmentAsCaller,
} from "./server";

const CONVERSATION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const ATTACHMENT_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const QUOTE_ID = "8c7b6a5d-4e3f-4a2b-9c0d-1e2f3a4b5c6d";
const TOKEN = "header.payload.signature";

function request(body?: unknown): Request {
  const init: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://owanbe.app/api/chats", init);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat routes", () => {
  it("forwards the caller's token to the database function", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/rest/v1/rpc/conversation_attachments")) return jsonResponse([], 200);
      if (url.includes("/rest/v1/rpc/thread_quotes")) return jsonResponse([], 200);
      return jsonResponse(
        [
          {
            conversation_id: CONVERSATION_ID,
            side: "host",
            counterparty_name: "Adeola Cakes",
            counterparty_slug: "adeola-cakes",
            message_id: "m-1",
            kind: "text",
            sender_side: "vendor",
            sender_name: "Ade",
            body: "Yes, 12 December works.",
            quote_id: null,
            revision: null,
            sent_at: "2026-11-09T10:00:00.000Z",
            mine: false,
          },
        ],
        200,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await conversationAsCaller(request(), CONVERSATION_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/conversation_messages");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("returns the quote the thread is about and what each message carries", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/rest/v1/rpc/conversation_attachments")) return jsonResponse([], 200);
      if (url.includes("/rest/v1/rpc/thread_quotes")) {
        return jsonResponse(
          [
            {
              quote_id: QUOTE_ID,
              service_date: "2026-12-12",
              status: "sent",
              currency: "NGN",
              total_minor: 120000,
              current_revision: 1,
              sent_at: "2026-11-09T10:00:00.000Z",
              expires_at: "2026-11-10T10:00:00.000Z",
              counter_response_due_at: null,
              decided_at: null,
              version: 2,
              is_vendor_side: false,
              title: "Hall and decor",
              revisions: [],
            },
          ],
          200,
        );
      }
      return jsonResponse(
        [
          {
            conversation_id: CONVERSATION_ID,
            side: "host",
            counterparty_name: "Adeola Cakes",
            counterparty_slug: "adeola-cakes",
            message_id: "m-1",
            kind: "quote_offer",
            sender_side: "vendor",
            sender_name: "Ade",
            body: "",
            quote_id: QUOTE_ID,
            revision: 1,
            sent_at: "2026-11-09T10:00:00.000Z",
            mine: false,
          },
        ],
        200,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await conversationAsCaller(request(), CONVERSATION_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages[0]).toMatchObject({
      kind: "quote_offer",
      quote_id: QUOTE_ID,
      revision: 1,
    });
    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]).toMatchObject({ quote_id: QUOTE_ID, title: "Hall and decor" });
  });

  it("refuses a conversation that is not the caller's", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "42501", message: "forbidden" }, 403)),
    );

    const res = await conversationAsCaller(request(), CONVERSATION_ID);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("refuses a request without a signed-in caller", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const anonymous = new Request("https://owanbe.app/api/chats");
    const res = await conversationAsCaller(anonymous, CONVERSATION_ID);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty message before it reaches the database", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMessageAsCaller(request({ body: "   " }), CONVERSATION_ID);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a valid message as the caller", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async () => jsonResponse("m-2", 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMessageAsCaller(
      request({ body: "Can you do 12 December?" }),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(201);
    expect((await res.json()).message_id).toBe("m-2");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      p_conversation: CONVERSATION_ID,
      p_body: "Can you do 12 December?",
    });
  });

  it("sends a document through the database function", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async () => jsonResponse("m-3", 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMessageAsCaller(
      request({
        body: "Here is the quote.",
        attachment: {
          path: `conversations/${CONVERSATION_ID}/file.pdf`,
          file_name: "quote.pdf",
          content_type: "application/pdf",
          size_bytes: 2048,
        },
      }),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/send_document");
    expect(JSON.parse(String(init.body))).toEqual({
      p_conversation: CONVERSATION_ID,
      p_body: "Here is the quote.",
      p_file_name: "quote.pdf",
      p_content_type: "application/pdf",
      p_size_bytes: 2048,
      p_storage_path: `conversations/${CONVERSATION_ID}/file.pdf`,
    });
  });

  it("refuses a document the database would not accept", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendMessageAsCaller(
      request({
        body: "",
        attachment: {
          path: `conversations/${CONVERSATION_ID}/file.exe`,
          file_name: "file.exe",
          content_type: "application/x-msdownload",
          size_bytes: 2048,
        },
      }),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chat attachments", () => {
  /** A multipart body, built by hand so the file name and size reach the route unchanged. */
  function uploadRequest(fileName: string, contentType: string, bytes: Uint8Array): Request {
    const boundary = "----owanbe-test-boundary";
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    return new Request(`https://owanbe.app/api/chats/${CONVERSATION_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
  }

  it("puts the file in the private bucket as the caller", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async () => jsonResponse({ Key: "file" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await uploadAttachmentAsCaller(
      uploadRequest("quote.pdf", "application/pdf", new Uint8Array([1, 2, 3])),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.file_name).toBe("quote.pdf");
    expect(body.content_type).toBe("application/pdf");
    expect(body.size_bytes).toBe(3);
    expect(body.path).toMatch(
      new RegExp(`^conversations/${CONVERSATION_ID}/[0-9a-f-]+-quote\\.pdf$`),
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://project.supabase.co/storage/v1/object/chat-attachments/${body.path}`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses a file type the bucket does not take", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await uploadAttachmentAsCaller(
      uploadRequest("run.exe", "application/x-msdownload", new Uint8Array([1])),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a file that is too large", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    const res = await uploadAttachmentAsCaller(
      uploadRequest("big.pdf", "application/pdf", new Uint8Array(11 * 1024 * 1024)),
      CONVERSATION_ID,
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a short-lived link for a participant", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/rest/v1/rpc/conversation_attachment")) {
        return jsonResponse(
          [
            {
              attachment_id: ATTACHMENT_ID,
              file_name: "quote.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
              storage_path: `conversations/${CONVERSATION_ID}/file.pdf`,
            },
          ],
          200,
        );
      }
      return jsonResponse({ signedURL: "/object/sign/chat-attachments/file.pdf?token=abc" }, 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await attachmentLinkAsCaller(request(), CONVERSATION_ID, ATTACHMENT_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(
      "https://project.supabase.co/storage/v1/object/sign/chat-attachments/file.pdf?token=abc",
    );
    expect(body.file_name).toBe("quote.pdf");
  });

  it("refuses a link for a caller who is not part of the conversation", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXTERNAL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: "42501", message: "forbidden" }, 403)),
    );

    const res = await attachmentLinkAsCaller(request(), CONVERSATION_ID, ATTACHMENT_ID);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });
});
