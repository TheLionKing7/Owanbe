import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Logo } from "@/components/site/Logo";
import { useAuth } from "@/lib/auth/AuthProvider";
import { PlannerPanel } from "@/features/planner/PlannerPanel";

// F-101 wiring: the /planner page. The planner is a Host house tool, so the page sits outside
// either house shell; the database refuses anyone who is not in a Host house.
export const Route = createFileRoute("/planner")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "OwanbePlanner — Ówàńbè" },
      { name: "description", content: "Plan your celebration with OwanbePlanner." },
      { property: "og:title", content: "OwanbePlanner — Ówàńbè" },
      { property: "og:description", content: "Plan your celebration with OwanbePlanner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlannerPage,
});

function PlannerPage() {
  const { getAccessToken } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
        <Logo showTagline={false} />
        <main id="main" className="mt-8">
          <PlannerPanel getAccessToken={getAccessToken} />
        </main>
      </div>
    </RequireAuth>
  );
}
