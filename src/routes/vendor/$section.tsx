import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/vendor/$section")({
  head: ({ params }) => ({ meta: [
    { title: `Vendor ${params.section} — Ówàńbè` },
    { name: "description", content: "Manage vendor enquiries, quotes and bookings in your vendor workspace." },
    { property: "og:title", content: `Vendor ${params.section} — Ówàńbè` },
    { property: "og:description", content: "Manage vendor enquiries, quotes and bookings in your vendor workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <HousePage houseId="vendor" /> });
