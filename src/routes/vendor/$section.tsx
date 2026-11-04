import { createFileRoute } from "@tanstack/react-router";
import HousePage from "@/pages/HousePage";

export const Route = createFileRoute("/vendor/$section")({ component: () => <HousePage houseId="vendor" /> });
