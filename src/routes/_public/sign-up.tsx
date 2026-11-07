import { createFileRoute } from "@tanstack/react-router";
import SignUp from "@/pages/SignUp";

export const Route = createFileRoute("/_public/sign-up")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Create your account — Ówàńbè" }, { name: "description", content: "Join Ówàńbè as a host or vendor." }, { property: "og:title", content: "Create your account — Ówàńbè" }, { property: "og:description", content: "Join Ówàńbè as a host or vendor." }] }),
  component: SignUp,
});
