import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { FundsPanel } from "@/features/funds/FundsPanel";

// F-109 wiring: the /funds page. Platform staff are not in a house, so the page sits outside
// either house shell; the database refuses anyone who does not hold a staff grant, and the panel
// says so.
export const Route = createFileRoute("/funds")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recovery fund — Ówàńbè" },
      { name: "description", content: "The recovery fund and the requests against it." },
      { property: "og:title", content: "Recovery fund — Ówàńbè" },
      { property: "og:description", content: "The recovery fund and the requests against it." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FundsPage,
});

function FundsPage() {
  const { getAccessToken } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
        <Logo showTagline={false} />
        <main id="main" className="mt-8">
          <FundsPanel getAccessToken={getAccessToken} />
        </main>
      </div>
    </RequireAuth>
  );
}
