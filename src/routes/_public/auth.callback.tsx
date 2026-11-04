import { createFileRoute } from "@tanstack/react-router";
import AuthCallback from "@/pages/AuthCallback";

export const Route = createFileRoute("/_public/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Signing in — Ówàńbè" }, { name: "description", content: "Completing sign-in." }, { property: "og:title", content: "Signing in — Ówàńbè" }, { property: "og:description", content: "Completing sign-in." }] }),
  component: AuthCallback,
});
