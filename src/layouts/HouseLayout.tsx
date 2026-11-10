import { NavLink, Outlet } from "@/lib/router";
import { LogOut } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Logo } from "@/components/site/Logo";
import { HOUSES, type HouseId } from "@/lib/houses";
import { OpenVendorHouse } from "@/features/vendor-profile/OpenVendorHouse";
import { OnboardingGate } from "@/features/onboarding/OnboardingGate";
import { forgetOnboarding } from "@/features/onboarding/gate-cache";

/** Shell for the Host and Vendor houses: each has its own navigation and never mixes with the other. */
export default function HouseLayout({ houseId }: { houseId: HouseId }) {
  return (
    <RequireAuth>
      <OnboardingGate houseId={houseId}>
        <HouseShell houseId={houseId} />
      </OnboardingGate>
    </RequireAuth>
  );
}

function HouseShell({ houseId }: { houseId: HouseId }) {
  const { user, houses, logout } = useAuth();
  const house = HOUSES[houseId];
  const myHouse = houses.find((h) => h.kind === houseId);
  const other = HOUSES[houseId === "host" ? "vendor" : "host"];
  return (
    <div className="mx-auto min-h-screen max-w-page lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-plum-900/10 bg-white/80 px-4 py-4 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <Logo showTagline={false} className="lg:items-start" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-plum-500" data-testid="house-name">
          {house.name}
        </p>
        {myHouse && (
          <p className="mt-1 truncate text-sm font-semibold text-ink" data-testid="my-house">
            {myHouse.display_name}
            {myHouse.role === "staff" && <span className="ml-1 font-normal text-ink-muted">(staff)</span>}
          </p>
        )}
        <nav aria-label={`${house.name} navigation`} className="mt-3">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {house.nav.map((item) => (
              <li key={item.slug || "overview"} className="shrink-0">
                <NavLink
                  to={item.slug ? `${house.basePath}/${item.slug}` : house.basePath}
                  end={!item.slug}
                  className={({ isActive }) =>
                    `flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold transition-colors ${isActive ? "bg-plum-800 text-white" : "text-ink hover:bg-plum-100"}`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <NavLink to={other.basePath} className="mt-6 hidden min-h-[44px] items-center rounded-xl border border-plum-900/10 px-3 text-sm font-medium text-ink-muted hover:bg-plum-100 lg:flex">
          Switch to {other.name}
        </NavLink>
        <div className="mt-6 hidden border-t border-plum-900/10 pt-4 lg:block">
          <p className="truncate text-sm font-semibold text-ink" data-testid="signed-in-as">
            {user?.display_name ?? user?.email ?? "Signed in"}
          </p>
          <button type="button" onClick={() => {
              forgetOnboarding();
              void logout();
            }} className="mt-2 flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink-muted hover:bg-plum-100">
            <LogOut aria-hidden className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="px-4 py-6 sm:px-8 lg:py-10">
        {myHouse ? (
          <Outlet />
        ) : houseId === "vendor" ? (
          <OpenVendorHouse />
        ) : (
          <section role="status" className="max-w-xl rounded-3xl bg-white p-8 shadow-card" data-testid="no-house">
            <h1 className="font-display text-3xl font-bold text-plum-950">No {house.name} yet</h1>
            <p className="mt-3 text-ink-muted">
              Your Host house is being set up. Please refresh in a moment.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
