import { Outlet } from "@/lib/router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { HelpButton } from "@/components/site/HelpButton";

export default function PublicLayout() {
  return (
    <div className="relative mx-auto min-h-screen max-w-page overflow-x-clip">
      <SiteHeader />
      <main id="main">
        <Outlet />
      </main>
      <HelpButton />
    </div>
  );
}
