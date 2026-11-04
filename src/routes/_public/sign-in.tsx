import { createFileRoute } from "@tanstack/react-router";
import SignIn from "@/pages/SignIn";

export const Route = createFileRoute("/_public/sign-in")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Sign in — Ówàńbè" }, { name: "description", content: "Sign in to Ówàńbè." }, { property: "og:title", content: "Sign in — Ówàńbè" }, { property: "og:description", content: "Sign in to Ówàńbè." }] }),
  component: () => <SignIn />,
});
