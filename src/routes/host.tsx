import { createFileRoute } from "@tanstack/react-router";
import HouseLayout from "@/layouts/HouseLayout";

export const Route = createFileRoute("/host")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Host House — Ówàńbè" }, { name: "description", content: "Plan your celebration, compare quotes and manage your guests." }, { property: "og:title", content: "Host House — Ówàńbè" }, { property: "og:description", content: "Plan your celebration with Ówàńbè." }] }),
  component: () => <HouseLayout houseId="host" />,
});
