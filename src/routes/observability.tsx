import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ObservabilityPanel } from "@/features/observability/ObservabilityPanel";

// F-126 wiring: the /observability page. Platform staff are not in a house, so the page sits
// outside either house shell; the database refuses anyone who does not hold the 'operations'
// capability, and the panel says so.
export const Route = createFileRoute("/observability")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operations dashboard — Ówàńbè" },
      { name: "description", content: "The platform's operational counters." },
      { property: "og:title", content: "Operations dashboard — Ówàńbè" },
      { property: "og:description", content: "The platform's operational counters." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ObservabilityPage,
});

function ObservabilityPage() {
  const { getAccessToken } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
        <Logo showTagline={false} />
        <main id="main" className="mt-8">
          <ObservabilityPanel getAccessToken={getAccessToken} />
        </main>
      </div>
    </RequireAuth>
  );
}
