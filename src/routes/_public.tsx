import { createFileRoute } from "@tanstack/react-router";
import PublicLayout from "@/layouts/PublicLayout";

export const Route = createFileRoute("/_public")({ component: PublicLayout });
