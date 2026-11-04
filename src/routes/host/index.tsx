import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/host/")({
  head: () => ({ meta: [
    { title: `Host overview — Ówàńbè` },
    { name: "description", content: "Manage your celebration plans, guests and quotes in your host workspace." },
    { property: "og:title", content: `Host overview — Ówàńbè` },
    { property: "og:description", content: "Manage your celebration plans, guests and quotes in your host workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <HousePage houseId="host" /> });
