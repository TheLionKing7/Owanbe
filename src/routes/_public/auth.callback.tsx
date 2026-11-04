import { createFileRoute } from "@tanstack/react-router";
import AuthCallback from "@/pages/AuthCallback";

export const Route = createFileRoute("/_public/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Signing in — Ówàńbè" }, { name: "description", content: "Completing sign-in." }, { property: "og:title", content: "Signing in — Ówàńbè" }, { property: "og:description", content: "Completing sign-in." }] }),
  component: AuthCallback,
});
