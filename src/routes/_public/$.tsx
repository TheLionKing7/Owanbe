import { createFileRoute } from "@tanstack/react-router";
import PlaceholderPage from "@/pages/PlaceholderPage";
import NotFound from "@/pages/NotFound";

const KNOWN = ["discover", "vendors", "culture", "about", "help", "get-started"];

function CatchAll() {
  const { _splat } = Route.useParams();
  const first = (_splat ?? "").split("/")[0] ?? "";
  if (KNOWN.includes(first) && !(first !== "discover" && first !== "vendors" && _splat?.includes("/"))) return <PlaceholderPage />;
  return <NotFound />;
}

export const Route = createFileRoute("/_public/$")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Ówàńbè" },
      { name: "description", content: "Ówàńbè — celebration commerce for Yoruba celebrations." },
      { property: "og:title", content: "Ówàńbè" },
      { property: "og:description", content: "Celebration commerce for Yoruba celebrations." },
    ],
  }),
  component: CatchAll,
});
