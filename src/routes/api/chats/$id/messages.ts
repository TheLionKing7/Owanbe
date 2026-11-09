import { createFileRoute } from "@tanstack/react-router";
import { sendMessageAsCaller } from "@/features/chat/server";

// F-100 wiring: POST /chats/:id/messages. The caller's token is forwarded to the database function,
// which re-checks that they take part in the conversation and hold the chat capability.
export const Route = createFileRoute("/api/chats/$id/messages")({
  server: {
    handlers: {
      POST: ({ request, params }) => sendMessageAsCaller(request, params.id),
    },
  },
});
