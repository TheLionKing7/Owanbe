/**
 * F-100 persistence boundary. Reads are authorized projections and writes are `security definer`
 * functions in supabase/migrations/20261109020000_f100_in_app_chat.sql; the browser never writes a
 * table directly (RLS is forced and write grants are revoked).
 *
 * The conversation itself is read and written through the app's own routes (GET /chats/:id and
 * POST /chats/:id/messages). Those routes forward the caller's own token, so the database decides
 * whether the caller takes part in the conversation; the route grants nothing by itself.
 */
import {
  uploadedAttachmentSchema,
  type ConversationSummary,
  type ConversationThread,
  type UploadedAttachment,
  type VendorOption,
} from "./contracts";

export type ChatErrorCode =
  "forbidden" | "not_found" | "validation" | "unauthorized" | "unconfigured" | "unknown";

/** Raised for every refusal so the UI can explain it in plain language. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export function classifyChatError(message: string): ChatErrorCode {
  const text = message.toLowerCase();
  if (text.includes("conversation_not_found") || text.includes("vendor_not_found"))
    return "not_found";
  if (text.includes("attachment_not_found")) return "not_found";
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("not_signed_in") || text.includes("invalid_token")) return "unauthorized";
  if (
    text.includes("invalid_message") ||
    text.includes("invalid_vendor") ||
    text.includes("invalid_attachment")
  ) {
    return "validation";
  }
  return "unknown";
}

export const CHAT_ERROR_COPY: Record<ChatErrorCode, string> = {
  forbidden: "You are not part of this conversation, so you cannot read or reply to it.",
  not_found: "We could not find that conversation.",
  validation: "Check your message and try again.",
  unauthorized: "Sign in to use chat.",
  unconfigured: "Sign-in is not configured in this environment, so chat stays locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

/** Validation carries the field's own words; every other refusal is explained from the copy map. */
export function chatErrorMessage(error: unknown): string {
  if (error instanceof ChatError) {
    return error.code === "validation" ? error.message : CHAT_ERROR_COPY[error.code];
  }
  return CHAT_ERROR_COPY.unknown;
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
  if (error) throw new ChatError(classifyChatError(error.message), error.message);
  return data as T;
}

const ERROR_CODES: readonly ChatErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "unconfigured",
  "unknown",
];

function readError(body: unknown): ChatError {
  const payload = body as { error?: unknown; message?: unknown } | null;
  const code = ERROR_CODES.find((candidate) => candidate === payload?.error) ?? "unknown";
  return new ChatError(
    code,
    typeof payload?.message === "string" ? payload.message : "request_failed",
  );
}

/** F-100 wiring: the browser half of GET /chats/:id. */
export async function fetchConversation(
  conversationId: string,
  accessToken: string | null,
): Promise<ConversationThread> {
  if (!accessToken) throw new ChatError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(`/api/chats/${encodeURIComponent(conversationId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ChatError("unknown", "conversation_request_failed");
  }
  const body = (await res.json().catch(() => null)) as ConversationThread | null;
  if (!res.ok) throw readError(body);
  if (!body || typeof body.conversation_id !== "string") {
    throw new ChatError("unknown", "invalid_conversation_response");
  }
  return {
    conversation_id: body.conversation_id,
    side: body.side,
    counterparty_name: body.counterparty_name,
    counterparty_slug: body.counterparty_slug ?? null,
    messages: Array.isArray(body.messages)
      ? body.messages.map((message) => ({
          ...message,
          attachments: Array.isArray(message.attachments) ? message.attachments : [],
        }))
      : [],
  };
}

/** F-100 wiring: the browser half of POST /chats/:id/messages. */
export async function postMessage(
  conversationId: string,
  body: string,
  accessToken: string | null,
  attachment?: UploadedAttachment | undefined,
): Promise<string> {
  if (!accessToken) throw new ChatError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(`/api/chats/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(attachment ? { body, attachment } : { body }),
    });
  } catch {
    throw new ChatError("unknown", "message_request_failed");
  }
  const payload = (await res.json().catch(() => null)) as {
    message_id?: unknown;
    error?: unknown;
    message?: unknown;
  } | null;
  if (!res.ok) throw readError(payload);
  if (typeof payload?.message_id !== "string") {
    throw new ChatError("unknown", "invalid_message_response");
  }
  return payload.message_id;
}

export interface ChatApi {
  list(): Promise<ConversationSummary[]>;
  thread(conversationId: string): Promise<ConversationThread>;
  send(conversationId: string, body: string): Promise<string>;
  sendDocument(conversationId: string, body: string, file: File): Promise<string>;
  upload(conversationId: string, file: File): Promise<UploadedAttachment>;
  link(conversationId: string, attachmentId: string): Promise<AttachmentLink>;
  start(vendorSlug: string): Promise<string>;
  vendors(): Promise<VendorOption[]>;
}

/** The short-lived address of a stored document. */
export interface AttachmentLink {
  url: string;
  file_name: string;
  content_type: string;
}

/** The browser half of POST /chats/:id/attachments — the file goes into the private bucket. */
export async function uploadAttachment(
  conversationId: string,
  file: File,
  accessToken: string | null,
): Promise<UploadedAttachment> {
  if (!accessToken) throw new ChatError("unauthorized", "no_token");
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(`/api/chats/${encodeURIComponent(conversationId)}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
  } catch {
    throw new ChatError("unknown", "attachment_request_failed");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw readError(body);
  const parsed = uploadedAttachmentSchema.safeParse(body);
  if (!parsed.success) {
    throw new ChatError("unknown", "invalid_attachment_response");
  }
  return parsed.data;
}

/** The browser half of GET /chats/:id/attachments/:attachmentId. */
export async function attachmentLink(
  conversationId: string,
  attachmentId: string,
  accessToken: string | null,
): Promise<AttachmentLink> {
  if (!accessToken) throw new ChatError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(
      `/api/chats/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    throw new ChatError("unknown", "attachment_link_failed");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw readError(body);
  if (typeof body?.["url"] !== "string") {
    throw new ChatError("unknown", "invalid_attachment_link");
  }
  return {
    url: body["url"],
    file_name: typeof body["file_name"] === "string" ? body["file_name"] : "",
    content_type: typeof body["content_type"] === "string" ? body["content_type"] : "",
  };
}

/** The token reader is injected so the panel can be rendered in tests without an auth provider. */
export function createChatApi(getAccessToken: () => Promise<string | null>): ChatApi {
  return {
    list: () => rpc<ConversationSummary[]>("my_conversations", {}),
    thread: async (conversationId) => fetchConversation(conversationId, await getAccessToken()),
    send: async (conversationId, body) => postMessage(conversationId, body, await getAccessToken()),
    sendDocument: async (conversationId, body, file) => {
      const token = await getAccessToken();
      const attachment = await uploadAttachment(conversationId, file, token);
      return postMessage(conversationId, body, token, attachment);
    },
    upload: async (conversationId, file) =>
      uploadAttachment(conversationId, file, await getAccessToken()),
    link: async (conversationId, attachmentId) =>
      attachmentLink(conversationId, attachmentId, await getAccessToken()),
    start: (vendorSlug) => rpc<string>("start_conversation", { p_vendor_slug: vendorSlug }),
    vendors: async () => {
      const rows = await rpc<{ slug: string; business_name: string; category: string }[]>(
        "public_vendor_profiles",
        {},
      );
      return rows.map((row) => ({
        slug: row.slug,
        business_name: row.business_name,
        category: row.category,
      }));
    },
  };
}
