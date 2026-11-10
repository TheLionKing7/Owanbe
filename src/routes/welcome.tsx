import { createFileRoute } from "@tanstack/react-router";
import Welcome from "@/pages/Welcome";

export const Route = createFileRoute("/welcome")({
  ssr: false,
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Set up your account — Ówàńbè" },
      { name: "description", content: "Finish setting up your Ówàńbè account." },
      { property: "og:title", content: "Set up your account — Ówàńbè" },
      { property: "og:description", content: "Finish setting up your Ówàńbè account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Welcome />,
});
