import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { listPublicVendors } from "@/features/vendor-profile/public.functions";
import { VENDOR_CATEGORIES, findCategory } from "@/features/vendor-profile/presets";

export const Route = createFileRoute("/_public/vendors/")({
  head: () => ({
    meta: [
      { title: "Find celebration vendors — Ówàńbè" },
      { name: "description", content: "Browse event centres, caterers, MCs, decorators, photographers and more for your Ówàńbè celebration." },
      { property: "og:title", content: "Find celebration vendors — Ówàńbè" },
      { property: "og:description", content: "Browse trusted vendors for your celebration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: () => listPublicVendors(),
  component: VendorsDirectory,
  errorComponent: () => <DirectoryError message="We couldn't load the vendor directory." />,
  notFoundComponent: () => <DirectoryError message="No vendors found." />,
});

function DirectoryError({ message }: { message: string }) {
  const router = useRouter();
  return (
    <section role="alert" className="mx-auto max-w-page px-4 py-16 sm:px-8 lg:mt-16">
      <p className="text-ink-muted">{message}</p>
      <button type="button" className="btn-primary mt-4 h-11 px-5" onClick={() => void router.invalidate()}>Try again</button>
    </section>
  );
}

function VendorsDirectory() {
  const result = Route.useLoaderData();
  const [filter, setFilter] = useState("");
  if (!result.ok) return <DirectoryError message={result.error} />;
  const vendors = filter ? result.vendors.filter((v) => v.category === filter) : result.vendors;

  return (
    <section className="mx-auto max-w-page px-4 py-10 sm:px-8 lg:mt-16">
      <h1 className="font-display text-4xl font-bold text-plum-950">Find your vendors</h1>
      <p className="mt-2 text-lg text-ink-muted">Every profile here is written and published by the vendor's own team.</p>
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip active={!filter} onClick={() => setFilter("")}>All</FilterChip>
        {VENDOR_CATEGORIES.map((c) => (
          <FilterChip key={c.slug} active={filter === c.slug} onClick={() => setFilter(c.slug)}>{c.label}</FilterChip>
        ))}
      </div>
      {vendors.length === 0 ? (
        <div className="mt-10 rounded-3xl bg-card p-8 shadow-card" data-testid="vendors-empty">
          <p className="font-display text-xl font-bold text-plum-950">No vendors here yet</p>
          <p className="mt-2 text-ink-muted">
            {filter ? "No published profiles in this category yet. Try another category." : "Vendors are setting up their profiles. Check back soon."}
          </p>
          <Link to="/vendor/$section" params={{ section: "profile" }} className="mt-4 inline-block font-semibold text-primary underline-offset-4 hover:underline">
            Are you a vendor? Create your profile
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => (
            <li key={v.slug}>
              <Link to="/vendors/$slug" params={{ slug: v.slug }} className="block h-full rounded-3xl bg-card p-6 shadow-card transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">{findCategory(v.category)?.label ?? v.category}</p>
                <h2 className="mt-2 font-display text-2xl font-bold text-plum-950">{v.business_name}</h2>
                <p className="mt-2 line-clamp-3 text-ink-muted">{v.tagline || v.headline}</p>
                {v.locations && (
                  <p className="mt-3 flex items-center gap-1 text-sm text-ink-muted"><MapPin className="h-4 w-4" aria-hidden /> {v.locations}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}
