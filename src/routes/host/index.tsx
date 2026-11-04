import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/host/")({ component: () => <HousePage houseId="host" /> });
