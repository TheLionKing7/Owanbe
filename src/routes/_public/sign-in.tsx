import { createFileRoute } from "@tanstack/react-router";
import SignIn from "@/pages/SignIn";

export const Route = createFileRoute("/_public/sign-in")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Ówàńbè" }, { name: "description", content: "Sign in to Ówàńbè." }, { property: "og:title", content: "Sign in — Ówàńbè" }, { property: "og:description", content: "Sign in to Ówàńbè." }] }),
  component: () => <SignIn />,
});
