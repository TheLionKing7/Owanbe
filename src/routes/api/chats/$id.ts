import { createFileRoute } from "@tanstack/react-router";
import { conversationAsCaller } from "@/features/chat/server";

// F-100 wiring: GET /chats/:id. The caller's token is forwarded to the database function, which
// re-checks that they take part in the conversation; this route grants nothing by itself.
export const Route = createFileRoute("/api/chats/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => conversationAsCaller(request, params.id),
    },
  },
});
