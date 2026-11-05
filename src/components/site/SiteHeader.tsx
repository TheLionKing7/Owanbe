import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "@/lib/router";
import { ChevronDown, Home, Menu, Search, X } from "lucide-react";
import { Logo } from "./Logo";
import { NAV_MENUS, type NavMenu } from "@/data/home";
import { useAuth } from "@/lib/auth/AuthProvider";

function DropdownMenu({ menu, open, onToggle, onClose }: { menu: NavMenu; open: boolean; onToggle: () => void; onClose: () => void }) {
  const id = `menu-${menu.label.toLowerCase()}`;
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex h-9 items-center gap-[7px] rounded-full px-1 text-[14.5px] font-semibold text-plum-950 transition-colors hover:text-plum-600"
      >
        {menu.label}
        <ChevronDown aria-hidden className={`h-4 w-4 stroke-[2.5] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul id={id} role="menu" className="absolute left-1/2 top-11 z-30 w-56 -translate-x-1/2 rounded-2xl bg-white p-2 shadow-card ring-1 ring-plum-900/5">
          {menu.links.map((link) => (
            <li key={link.label} role="none">
              <Link role="menuitem" to={link.to} onClick={onClose} className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-ink hover:bg-plum-100 hover:text-plum-800">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SiteHeader() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { status, logout } = useAuth();
  const signedIn = status === "signedIn";
  // Only the homepage overlays the header on the hero artwork; every other page keeps it in normal flow.
  const overlayHero = location.pathname === "/";

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  return (
    <header className={`relative z-20 flex ${overlayHero ? "lg:absolute lg:inset-x-0 lg:top-0" : ""} items-start justify-between px-4 pt-3 sm:px-6 lg:px-[48px] lg:pt-[17px]`}>
      <Logo />

      <nav ref={navRef} aria-label="Main" className="mr-auto mt-[24px] hidden items-center gap-[clamp(14px,1.76vw,27px)] pl-[clamp(28px,6.3vw,97px)] xl:flex">
        <NavLink to="/" end className={({ isActive }) => `flex h-9 items-center gap-2 rounded-full px-[16px] text-[14.5px] font-semibold transition-colors ${isActive ? "bg-plum-800 text-white shadow-pill" : "text-plum-950 hover:text-plum-600"}`}>
          <Home aria-hidden className="h-[17px] w-[17px] fill-current stroke-[1.5]" />
          Home
        </NavLink>
        {NAV_MENUS.map((menu) => (
          <DropdownMenu
            key={menu.label}
            menu={menu}
            open={openMenu === menu.label}
            onToggle={() => setOpenMenu((cur) => (cur === menu.label ? null : menu.label))}
            onClose={() => setOpenMenu(null)}
          />
        ))}
      </nav>

      <div className="mt-[22px] hidden shrink-0 items-center xl:flex">
        <Link to="/discover" aria-label="Search" className="grid h-10 w-10 place-items-center rounded-full text-plum-900 hover:bg-white/50">
          <Search aria-hidden className="h-[21px] w-[21px] stroke-[2.25]" />
        </Link>
        <span aria-hidden className="mx-[9px] h-6 w-px bg-plum-900/40" />
        {signedIn ? (
          <>
            <button type="button" onClick={() => void logout()} className="btn-outline h-[41px] whitespace-nowrap px-[19px] text-[14.5px]">
              Sign Out
            </button>
            <Link to="/host" className="btn-primary ml-3 h-[41px] whitespace-nowrap px-[19px] text-[14.5px]">
              My Ówàńbè
            </Link>
          </>
        ) : (
          <>
            <Link to="/sign-in" className="btn-outline h-[41px] whitespace-nowrap px-[19px] text-[14.5px]">
              Sign In
            </Link>
            <Link to="/get-started" className="btn-primary ml-3 h-[41px] whitespace-nowrap px-[19px] text-[14.5px]">
              Get Started
            </Link>
          </>
        )}
      </div>

      <button
        type="button"
        className="ml-auto mt-2 grid h-11 w-11 place-items-center rounded-full bg-white/80 text-plum-900 shadow-card xl:hidden"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen}
        aria-controls="mobile-nav"
        onClick={() => setMobileOpen((v) => !v)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {mobileOpen && (
        <div id="mobile-nav" className="absolute inset-x-3 top-[72px] z-30 max-h-[80vh] overflow-y-auto rounded-3xl bg-white p-4 shadow-card xl:hidden">
          <nav aria-label="Mobile">
            <Link to="/" className="flex min-h-[48px] items-center gap-2 rounded-xl px-3 font-semibold text-plum-800">
              <Home className="h-4 w-4" /> Home
            </Link>
            {NAV_MENUS.map((menu) => (
              <details key={menu.label} className="group">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between rounded-xl px-3 font-semibold text-plum-950">
                  {menu.label}
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="pb-2 pl-3">
                  {menu.links.map((link) => (
                    <li key={link.label}>
                      <Link to={link.to} className="flex min-h-[44px] items-center rounded-xl px-3 text-sm text-ink-muted hover:bg-plum-100">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-plum-900/10 pt-4">
            {signedIn ? (
              <>
                <button type="button" onClick={() => void logout()} className="btn-outline h-12">Sign Out</button>
                <Link to="/host" className="btn-primary h-12">My Ówàńbè</Link>
              </>
            ) : (
              <>
                <Link to="/sign-in" className="btn-outline h-12">Sign In</Link>
                <Link to="/get-started" className="btn-primary h-12">Get Started</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
