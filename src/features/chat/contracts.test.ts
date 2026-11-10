import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_IMAGE_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  attachmentContentTypeSchema,
  attachmentKindLabel,
  captionSchema,
  chatPath,
  formatFileSize,
  isImageAttachment,
  messageBodySchema,
  messageDayLabel,
  startConversationSchema,
  uploadedAttachmentSchema,
} from "./contracts";

describe("chat contracts", () => {
  it("refuses an empty message before it reaches the server", () => {
    const parsed = messageBodySchema.safeParse("   ");
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toBe(
      "Write a message before sending it.",
    );
  });

  it("refuses a message longer than the database allows", () => {
    const parsed = messageBodySchema.safeParse("a".repeat(4001));
    expect(parsed.success).toBe(false);
  });

  it("keeps a message inside the limit", () => {
    const parsed = messageBodySchema.safeParse("  Can you do 12 December?  ");
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data : "").toBe("Can you do 12 December?");
  });

  it("requires a vendor before a conversation can start", () => {
    expect(startConversationSchema.safeParse({ vendor_slug: "" }).success).toBe(false);
    expect(startConversationSchema.safeParse({ vendor_slug: "adeola-cakes" }).success).toBe(true);
  });

  it("points at the conversation page", () => {
    expect(chatPath("6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b")).toBe(
      "/chat/6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b",
    );
  });
});

describe("chat attachments", () => {
  it("accepts the document types the bucket allows", () => {
    expect(attachmentContentTypeSchema.safeParse("application/pdf").success).toBe(true);
    expect(
      attachmentContentTypeSchema.safeParse(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ).success,
    ).toBe(true);
    expect(attachmentContentTypeSchema.safeParse("image/jpeg").success).toBe(true);
  });

  it("refuses a type the bucket would not take", () => {
    const parsed = attachmentContentTypeSchema.safeParse("application/x-msdownload");
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toBe(
      "Share a document, a spreadsheet, a photo or a plain text file.",
    );
  });

  it("refuses a file larger than the bucket allows", () => {
    const parsed = uploadedAttachmentSchema.safeParse({
      path: "conversations/6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b/quote.pdf",
      file_name: "quote.pdf",
      content_type: "application/pdf",
      size_bytes: ATTACHMENT_MAX_BYTES + 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps a caption optional when a document is attached", () => {
    expect(captionSchema.safeParse("").success).toBe(true);
    expect(captionSchema.safeParse("Here is the quote").success).toBe(true);
  });

  it("offers only the safe types in the file picker", () => {
    expect(ATTACHMENT_ACCEPT).not.toContain("image/*");
    expect(ATTACHMENT_ACCEPT).toContain("application/pdf");
    expect(ATTACHMENT_IMAGE_ACCEPT).toBe("image/jpeg,image/png,image/webp,image/heic");
  });

  it("names the kind of document on the card", () => {
    expect(attachmentKindLabel("application/pdf")).toBe("PDF document");
    expect(attachmentKindLabel("image/png")).toBe("Photo");
    expect(isImageAttachment("image/png")).toBe(true);
    expect(isImageAttachment("application/pdf")).toBe(false);
  });

  it("shows a readable file size", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("separates the days of the conversation", () => {
    expect(messageDayLabel(new Date().toISOString())).toBe("Today");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(messageDayLabel(yesterday)).toBe("Yesterday");
  });
});
