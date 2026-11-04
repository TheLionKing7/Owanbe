import { createFileRoute } from "@tanstack/react-router";
import Home from "@/pages/Home";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "Ówàńbè — Your Celebration. Our Culture. Powered by AI." },
      { name: "description", content: "Plan meaningful Yoruba celebrations, discover trusted vendors and bring your occasion to life with Ówàńbè's AI-powered planning." },
      { property: "og:title", content: "Ówàńbè — Your Celebration. Our Culture. Powered by AI." },
      { property: "og:description", content: "Plan meaningful Yoruba celebrations and discover trusted vendors with AI-powered planning." },
    ],
    links: [{ rel: "preload", as: "image", href: "/images/hero.webp", fetchPriority: "high" }],
  }),
  component: Home,
});
