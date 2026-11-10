import { createFileRoute } from "@tanstack/react-router";
import SignUp from "@/pages/SignUp";

export const Route = createFileRoute("/_public/sign-up")({
  ssr: false,
  head: () => ({ meta: [{ property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }, { title: "Create your account — Ówàńbè" }, { name: "description", content: "Join Ówàńbè as a celebration host, professional event planner or vendor." }, { property: "og:title", content: "Create your account — Ówàńbè" }, { property: "og:description", content: "Create your Host or Vendor house, including event planning and management businesses." }] }),
  component: SignUp,
});
