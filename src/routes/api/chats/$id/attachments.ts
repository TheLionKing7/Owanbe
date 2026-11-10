import { createFileRoute } from "@tanstack/react-router";
import { uploadAttachmentAsCaller } from "@/features/chat/server";

// F-100 wiring: POST /chats/:id/attachments. The file is stored in the private bucket with the
// caller's own token, so the storage policies decide whether they may write there.
export const Route = createFileRoute("/api/chats/$id/attachments")({
  server: {
    handlers: {
      POST: ({ request, params }) => uploadAttachmentAsCaller(request, params.id),
    },
  },
});
