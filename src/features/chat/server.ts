/**
 * F-100 server-only boundary for GET /chats/:id and POST /chats/:id/messages.
 *
 * The caller's own token is forwarded to PostgREST, so `conversation_messages` and `send_message`
 * run as that user and the database decides whether they take part in the conversation. No
 * service-role key is read here, and a secret key would act as the server rather than the caller,
 * so it is refused rather than used.
 *
 * The same rule applies to the document tools: the file goes into the private bucket with the
 * caller's token, so the storage policies decide whether the caller may write there, and the
 * signed link is minted with the caller's token too.
 */
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  attachmentFileNameSchema,
  captionSchema,
  messageBodySchema,
  uploadedAttachmentSchema,
  type MessageKind,
  type ThreadQuote,
} from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQLSTATE raised by the migration → what the browser is told. Raw database text is not returned. */
const STATUS_BY_CODE: Record<string, { status: number; error: string; message: string }> = {
  "42501": {
    status: 403,
    error: "forbidden",
    message: "You are not part of this conversation, so you cannot read or reply to it.",
  },
  P0002: { status: 404, error: "not_found", message: "We could not find that conversation." },
  "22023": { status: 400, error: "validation", message: "Check your message and try again." },
  "28000": { status: 401, error: "unauthorized", message: "Sign in to use chat." },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function callerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.split(".").length === 3 ? token : null;
}

/** The publishable key only: a secret key would answer as the server, not as the caller. */
function callerCredentials(): { url: string; key: string } | null {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

async function callAsCaller(
  rpc: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const credentials = callerCredentials();
  if (!credentials) throw new Error("unconfigured");
  return fetch(`${credentials.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: credentials.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function failure(res: Response): Promise<Response> {
  let code = "";
  try {
    code = String(((await res.json()) as { code?: unknown }).code ?? "");
  } catch {
    code = "";
  }
  const mapped = STATUS_BY_CODE[code];
  if (mapped) return json({ error: mapped.error, message: mapped.message }, mapped.status);
  console.error("chat rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

/** GET /chats/:id — the conversation and its messages. */
export async function conversationAsCaller(
  request: Request,
  conversationId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(conversationId)) {
    return json({ error: "validation", message: "That conversation link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use chat." }, 401);
  }

  let res: Response;
  let attachments: Response;
  let quotes: Response;
  try {
    [res, attachments, quotes] = await Promise.all([
      callAsCaller("conversation_messages", token, { p_conversation: conversationId }),
      callAsCaller("conversation_attachments", token, { p_conversation: conversationId }),
      callAsCaller("thread_quotes", token, { p_conversation: conversationId }),
    ]);
  } catch {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so chat stays locked.",
      },
      503,
    );
  }
  if (!res.ok) return failure(res);
  if (!attachments.ok) return failure(attachments);
  if (!quotes.ok) return failure(quotes);

  const rows = (await res.json()) as {
    conversation_id: string;
    side: string;
    counterparty_name: string;
    counterparty_slug: string | null;
    message_id: string | null;
    kind: string;
    sender_side: string;
    sender_name: string;
    body: string;
    quote_id: string | null;
    revision: number | null;
    sent_at: string;
    mine: boolean;
  }[];
  const first = rows[0];
  if (!first) {
    return json({ error: "not_found", message: "We could not find that conversation." }, 404);
  }

  const attachmentRows = (await attachments.json()) as {
    message_id: string;
    attachment_id: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
  }[];

  const quoteRows = (await quotes.json()) as ThreadQuote[];

  return json(
    {
      conversation_id: first.conversation_id,
      side: first.side,
      counterparty_name: first.counterparty_name,
      counterparty_slug: first.counterparty_slug ?? null,
      messages: rows
        .filter((row) => typeof row.message_id === "string")
        .map((row) => ({
          message_id: row.message_id as string,
          kind: (row.kind ?? "text") as MessageKind,
          sender_side: row.sender_side,
          sender_name: row.sender_name,
          body: row.body,
          quote_id: row.quote_id ?? null,
          revision: row.revision ?? null,
          sent_at: row.sent_at,
          mine: Boolean(row.mine),
          attachments: attachmentRows
            .filter((attachment) => attachment.message_id === row.message_id)
            .map((attachment) => ({
              attachment_id: attachment.attachment_id,
              message_id: attachment.message_id,
              file_name: attachment.file_name,
              content_type: attachment.content_type,
              size_bytes: Number(attachment.size_bytes),
            })),
        })),
      quotes: Array.isArray(quoteRows) ? quoteRows : [],
    },
    200,
  );
}

/** POST /chats/:id/messages — sends one message, or one message with a document attached. */
export async function sendMessageAsCaller(
  request: Request,
  conversationId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(conversationId)) {
    return json({ error: "validation", message: "That conversation link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use chat." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "validation", message: "Check your message and try again." }, 400);
  }
  const payload = (body as { body?: unknown; attachment?: unknown } | null) ?? {};

  const attachment = payload.attachment
    ? uploadedAttachmentSchema.safeParse(payload.attachment)
    : null;
  if (attachment && !attachment.success) {
    return json(
      {
        error: "validation",
        message: attachment.error.issues[0]?.message ?? "That file cannot be shared.",
      },
      400,
    );
  }

  const text = attachment?.success ? captionSchema : messageBodySchema;
  const parsed = text.safeParse(payload.body);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Check your message and try again.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = attachment?.success
      ? await callAsCaller("send_document", token, {
          p_conversation: conversationId,
          p_body: parsed.data,
          p_file_name: attachment.data.file_name,
          p_content_type: attachment.data.content_type,
          p_size_bytes: attachment.data.size_bytes,
          p_storage_path: attachment.data.path,
        })
      : await callAsCaller("send_message", token, {
          p_conversation: conversationId,
          p_body: parsed.data,
        });
  } catch {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so chat stays locked.",
      },
      503,
    );
  }
  if (!res.ok) return failure(res);

  const messageId = (await res.json()) as unknown;
  if (typeof messageId !== "string") {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  return json({ message_id: messageId }, 201);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const BUCKET = "chat-attachments";

/** A file name safe to put in a storage path: no separators, no control characters. */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : "file";
}

/** The path a file of this conversation is stored under. */
function storagePathFor(conversationId: string, fileName: string): string {
  return `conversations/${conversationId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
}

/** The uploaded file, once its type and size have been checked here. */
async function readUploadedFile(request: Request): Promise<UploadedFile | Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "validation", message: "That file could not be read." }, 400);
  }
  const entry = form.get("file");
  if (!entry || typeof entry !== "object" || !("arrayBuffer" in entry)) {
    return json({ error: "validation", message: "Choose a file to share." }, 400);
  }
  const file = entry as File;
  const name = attachmentFileNameSchema.safeParse(file.name);
  if (!name.success) {
    return json({ error: "validation", message: "That file has no name." }, 400);
  }
  const contentType = (file.type || "").toLowerCase();
  if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return json(
      {
        error: "validation",
        message: "Share a document, a spreadsheet, a photo or a plain text file.",
      },
      400,
    );
  }
  if (file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES) {
    return json({ error: "validation", message: "Share a file of 10 MB or less." }, 400);
  }
  return {
    name: name.data,
    type: contentType,
    size: file.size,
    bytes: await file.arrayBuffer(),
  };
}

/** POST /chats/:id/attachments — puts the file in the private bucket, as the caller. */
export async function uploadAttachmentAsCaller(
  request: Request,
  conversationId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(conversationId)) {
    return json({ error: "validation", message: "That conversation link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use chat." }, 401);
  }

  const file = await readUploadedFile(request);
  if (file instanceof Response) return file;

  const credentials = callerCredentials();
  if (!credentials) {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so chat stays locked.",
      },
      503,
    );
  }

  const path = storagePathFor(conversationId, file.name);
  let res: Response;
  try {
    res = await fetch(`${credentials.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: credentials.key,
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file.bytes,
    });
  } catch {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return json(
        {
          error: "forbidden",
          message: "You are not part of this conversation, so you cannot share files in it.",
        },
        403,
      );
    }
    console.error("chat attachment upload failed", res.status);
    return json(
      { error: "unknown", message: "That file could not be shared. Try again in a moment." },
      502,
    );
  }

  return json({ path, file_name: file.name, content_type: file.type, size_bytes: file.size }, 201);
}

/** GET /chats/:id/attachments/:attachmentId — a short-lived link to the file. */
export async function attachmentLinkAsCaller(
  request: Request,
  conversationId: string,
  attachmentId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(attachmentId)) {
    return json({ error: "validation", message: "That document link is not valid." }, 400);
  }
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to use chat." }, 401);
  }
  const credentials = callerCredentials();
  if (!credentials) {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so chat stays locked.",
      },
      503,
    );
  }

  let lookup: Response;
  try {
    lookup = await callAsCaller("conversation_attachment", token, {
      p_conversation: conversationId,
      p_attachment: attachmentId,
    });
  } catch {
    return json(
      {
        error: "unconfigured",
        message: "Sign-in is not configured in this environment, so chat stays locked.",
      },
      503,
    );
  }
  if (!lookup.ok) return failure(lookup);

  const rows = (await lookup.json()) as {
    attachment_id: string;
    file_name: string;
    content_type: string;
    size_bytes: number;
    storage_path: string;
  }[];
  const attachment = rows[0];
  if (!attachment) {
    return json({ error: "not_found", message: "We could not find that document." }, 404);
  }

  let signed: Response;
  try {
    signed = await fetch(
      `${credentials.url}/storage/v1/object/sign/${BUCKET}/${attachment.storage_path}`,
      {
        method: "POST",
        headers: {
          apikey: credentials.key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 300 }),
      },
    );
  } catch {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  if (!signed.ok) {
    if (signed.status === 401 || signed.status === 403) {
      return json(
        {
          error: "forbidden",
          message: "You are not part of this conversation, so you cannot read this document.",
        },
        403,
      );
    }
    console.error("chat attachment sign failed", signed.status);
    return json({ error: "unknown", message: "That document could not be opened." }, 502);
  }

  const payload = (await signed.json()) as { signedURL?: unknown };
  if (typeof payload.signedURL !== "string") {
    return json({ error: "unknown", message: "That document could not be opened." }, 502);
  }

  return json(
    {
      url: `${credentials.url}/storage/v1${payload.signedURL}`,
      file_name: attachment.file_name,
      content_type: attachment.content_type,
    },
    200,
  );
}
