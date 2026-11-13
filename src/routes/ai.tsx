import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AiConsolePanel } from "@/features/ai/AiConsolePanel";

// F-107 wiring: the /ai page. OwanbeAI's console is not a house tool — the answers a person
// received and the case queue a staff member works are not tied to one house — so the page sits
// outside either house shell. The database refuses anyone who does not hold the 'ai_investigation'
// capability, and the panel says so.
export const Route = createFileRoute("/ai")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "OwanbeAI — Ówàńbè" },
      { name: "description", content: "What OwanbeAI has answered you, and the case queue." },
      { property: "og:title", content: "OwanbeAI — Ówàńbè" },
      {
        property: "og:description",
        content: "What OwanbeAI has answered you, and the case queue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiConsolePage,
});

function AiConsolePage() {
  const { getAccessToken } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
        <Logo showTagline={false} />
        <main id="main" className="mt-8">
          <AiConsolePanel getAccessToken={getAccessToken} />
        </main>
      </div>
    </RequireAuth>
  );
}
