import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/host/$section")({ component: () => <HousePage houseId="host" /> });
