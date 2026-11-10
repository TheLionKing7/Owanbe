import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ChatThread } from "@/features/chat/ChatThread";

// F-100 wiring: the /chat/:id page. A conversation belongs to two houses, so it sits outside
// either house shell and never switches the house the user is working in.
export const Route = createFileRoute("/chat/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Conversation — Ówàńbè" },
      // A conversation is private to two parties: keep it out of search engines.
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "A private conversation on Ówàńbè." },
      { property: "og:title", content: "Conversation — Ówàńbè" },
      { property: "og:description", content: "A private conversation on Ówàńbè." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { id } = Route.useParams();
  const { getAccessToken } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
        <Logo showTagline={false} />
        <main id="main" className="mt-8">
          <ChatThread conversationId={id} getAccessToken={getAccessToken} />
        </main>
      </div>
    </RequireAuth>
  );
}
