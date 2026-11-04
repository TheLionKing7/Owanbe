import { createFileRoute } from "@tanstack/react-router";
import HouseLayout from "@/layouts/HouseLayout";

export const Route = createFileRoute("/vendor")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Vendor House — Ówàńbè" }, { name: "description", content: "Get discovered, respond to enquiries and run your bookings." }, { property: "og:title", content: "Vendor House — Ówàńbè" }, { property: "og:description", content: "Run your celebration business with Ówàńbè." }] }),
  component: () => <HouseLayout houseId="vendor" />,
});
