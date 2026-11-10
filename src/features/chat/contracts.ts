/**
 * F-100 chat contracts. The database (supabase/migrations/20261109020000_f100_in_app_chat.sql)
 * decides who may read and write; this module validates input at the trust boundary and describes
 * the rows the projections return.
 */
import { z } from "zod";

export const CHAT_SIDES = ["host", "vendor"] as const;
export type ChatSide = (typeof CHAT_SIDES)[number];

/** The database refuses a body outside 1..4000 characters. */
export const MESSAGE_MAX_LENGTH = 4000;

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message before sending it.")
  .max(MESSAGE_MAX_LENGTH, `Keep the message under ${MESSAGE_MAX_LENGTH} characters.`);

export const startConversationSchema = z.object({
  vendor_slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Choose a vendor to message.")
    .max(60, "That vendor reference is not valid."),
});
export type StartConversationInput = z.input<typeof startConversationSchema>;

/** The bucket refuses anything bigger than this, and so does the database. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The document types a host and a vendor may share. Mirrors the bucket's allowed_mime_types. */
export const ATTACHMENT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const ATTACHMENT_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
] as const;

export const ATTACHMENT_CONTENT_TYPES = [
  ...ATTACHMENT_IMAGE_TYPES,
  ...ATTACHMENT_DOCUMENT_TYPES,
] as const;

/** The file picker's filter. Only these types are offered; nothing else is accepted. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_DOCUMENT_TYPES.join(",");
export const ATTACHMENT_IMAGE_ACCEPT = ATTACHMENT_IMAGE_TYPES.join(",");

export const attachmentContentTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value),
    "Share a document, a spreadsheet, a photo or a plain text file.",
  );

export const attachmentFileNameSchema = z
  .string()
  .trim()
  .min(1, "That file has no name.")
  .max(200, "That file name is too long.");

/** The payload the upload route answers with, and the send route passes on to the database. */
export const uploadedAttachmentSchema = z.object({
  path: z.string().trim().min(1),
  file_name: attachmentFileNameSchema,
  content_type: attachmentContentTypeSchema,
  size_bytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});
export type UploadedAttachment = z.infer<typeof uploadedAttachmentSchema>;

/** A caption may be empty when a document is attached. */
export const captionSchema = z
  .string()
  .trim()
  .max(MESSAGE_MAX_LENGTH, `Keep the message under ${MESSAGE_MAX_LENGTH} characters.`);

/** public.my_conversations(): one row per conversation the caller takes part in. */
export interface ConversationSummary {
  conversation_id: string;
  side: ChatSide;
  counterparty_name: string;
  counterparty_slug: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  message_count: number;
  version: number;
}

/** A document shared inside a conversation. */
export interface ChatAttachment {
  attachment_id: string;
  message_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

/** One message as public.conversation_messages() returns it. */
export interface ChatMessage {
  message_id: string;
  sender_side: ChatSide;
  sender_name: string;
  body: string;
  sent_at: string;
  mine: boolean;
  attachments: ChatAttachment[];
}

/** The conversation with its messages, newest last. */
export interface ConversationThread {
  conversation_id: string;
  side: ChatSide;
  counterparty_name: string;
  counterparty_slug: string | null;
  messages: ChatMessage[];
}

/** A published vendor a host may start a conversation with. */
export interface VendorOption {
  slug: string;
  business_name: string;
  category: string;
}

export function chatPath(conversationId: string): string {
  return `/chat/${conversationId}`;
}

export function formatMessageTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The day a message was sent on, for the separator between message groups. */
export function messageDayLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(parsed, today)) return "Today";
  if (sameDay(parsed, yesterday)) return "Yesterday";
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: parsed.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageAttachment(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/** The label shown on a document card. */
export function attachmentKindLabel(contentType: string): string {
  if (isImageAttachment(contentType)) return "Photo";
  if (contentType === "application/pdf") return "PDF document";
  if (contentType.includes("wordprocessingml") || contentType === "application/msword") {
    return "Word document";
  }
  if (contentType.includes("spreadsheetml") || contentType === "application/vnd.ms-excel") {
    return "Spreadsheet";
  }
  if (contentType.includes("presentationml") || contentType === "application/vnd.ms-powerpoint") {
    return "Presentation";
  }
  if (contentType === "text/csv") return "CSV file";
  if (contentType === "text/plain") return "Text file";
  return "Document";
}
