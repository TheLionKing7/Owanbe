import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/vendor/")({
  head: () => ({ meta: [
    { title: `Vendor overview — Ówàńbè` },
    { name: "description", content: "Manage vendor enquiries, quotes and bookings in your vendor workspace." },
    { property: "og:title", content: `Vendor overview — Ówàńbè` },
    { property: "og:description", content: "Manage vendor enquiries, quotes and bookings in your vendor workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <HousePage houseId="vendor" /> });
