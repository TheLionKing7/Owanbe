import { createFileRoute } from "@tanstack/react-router";
import { attachmentLinkAsCaller } from "@/features/chat/server";

// F-100 wiring: GET /chats/:id/attachments/:attachmentId. The signed link is minted with the
// caller's token, so only the two parties of the conversation can open the document.
export const Route = createFileRoute("/api/chats/$id/attachments/$attachmentId")({
  server: {
    handlers: {
      GET: ({ request, params }) => attachmentLinkAsCaller(request, params.id, params.attachmentId),
    },
  },
});
