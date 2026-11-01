import { NavLink, Outlet } from "react-router-dom";
import { Logo } from "@/components/site/Logo";
import { HOUSES, type HouseId } from "@/lib/houses";

/** Shell for the Host and Vendor houses: each has its own navigation and never mixes with the other. */
export default function HouseLayout({ houseId }: { houseId: HouseId }) {
  const house = HOUSES[houseId];
  const other = HOUSES[houseId === "host" ? "vendor" : "host"];
  return (
    <div className="mx-auto min-h-screen max-w-page lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-plum-900/10 bg-white/80 px-4 py-4 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <Logo showTagline={false} className="lg:items-start" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-plum-500" data-testid="house-name">
          {house.name}
        </p>
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
      </aside>
      <main id="main" className="px-4 py-6 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
