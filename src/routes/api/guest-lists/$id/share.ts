import { createFileRoute } from "@tanstack/react-router";
import { shareGuestListAsCaller } from "@/features/guest-lists/share.server";

// F-40: the host shares a guest list with one platform user. The caller's token is forwarded to the
// database function, which re-checks that they own the list; this route grants nothing by itself.
export const Route = createFileRoute("/api/guest-lists/$id/share")({
  server: {
    handlers: {
      POST: ({ request, params }) => shareGuestListAsCaller(request, params.id),
    },
  },
});
