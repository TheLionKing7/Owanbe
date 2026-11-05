import { createFileRoute, Link, notFound, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { PublicVendorProfile } from "@/features/vendor-profile/profile-data";
import { CheckCircle2, MapPin, Wallet } from "lucide-react";
import { getPublicVendor } from "@/features/vendor-profile/public.functions";
import { findCategory } from "@/features/vendor-profile/presets";

export const Route = createFileRoute("/_public/vendors/$slug")({
  loader: async ({ params }): Promise<PublicVendorProfile> => {
    const result = await getPublicVendor({ data: { slug: params.slug } });
    if (!result.ok) throw new Error(result.error);
    const vendor = result.vendors[0];
    if (!vendor) throw notFound();
    return vendor;
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.business_name} — Ówàńbè vendor` : "Vendor — Ówàńbè";
    const description = loaderData ? (loaderData.tagline || loaderData.headline).slice(0, 160) : "A celebration vendor on Ówàńbè.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary" },
        ...(loaderData ? [] : [{ name: "robots", content: "noindex" }]),
      ],
    };
  },
  component: VendorProfilePage,
  errorComponent: VendorError,
  notFoundComponent: () => (
    <section className="mx-auto max-w-page px-4 py-16 sm:px-8 lg:mt-16">
      <h1 className="font-display text-3xl font-bold text-plum-950">This vendor isn't available</h1>
      <p className="mt-2 text-ink-muted">The profile may have been hidden by the vendor.</p>
      <Link to="/vendors" className="mt-4 inline-block font-semibold text-primary underline-offset-4 hover:underline">Browse all vendors</Link>
    </section>
  ),
});

function VendorError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section role="alert" className="mx-auto max-w-page px-4 py-16 sm:px-8 lg:mt-16">
      <p className="text-ink-muted">{error instanceof Error && error.message ? error.message : "We couldn't load this vendor."}</p>
      <button type="button" className="btn-primary mt-4 h-11 px-5" onClick={() => void router.invalidate()}>Try again</button>
    </section>
  );
}

function VendorProfilePage() {
  const v = Route.useLoaderData();
  return (
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-8 lg:mt-16">
      <Link to="/vendors" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">← All vendors</Link>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">{findCategory(v.category)?.label ?? v.category}</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-plum-950 sm:text-5xl">{v.business_name}</h1>
      <p className="mt-3 font-display text-2xl text-plum-800">{v.headline}</p>
      {v.tagline && <p className="mt-2 text-lg text-ink-muted">{v.tagline}</p>}
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
        {v.locations && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden /> {v.locations}</span>}
        {v.price_note && <span className="flex items-center gap-1"><Wallet className="h-4 w-4" aria-hidden /> {v.price_note}</span>}
      </div>

      <section className="mt-8 rounded-3xl bg-card p-6 shadow-card">
        <h2 className="font-display text-2xl font-bold text-plum-950">About</h2>
        <p className="mt-3 whitespace-pre-line text-ink">{v.about}</p>
      </section>

      {v.services.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-2xl font-bold text-plum-950">Services</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {v.services.map((s, i) => (
              <li key={i} className="rounded-2xl bg-card p-5 shadow-card">
                <h3 className="font-semibold text-plum-900">{s.name}</h3>
                <p className="mt-2 text-sm text-ink-muted">{s.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.highlights.length > 0 && (
        <section className="mt-6 rounded-3xl bg-card p-6 shadow-card">
          <h2 className="font-display text-2xl font-bold text-plum-950">Why hosts choose {v.business_name}</h2>
          <ul className="mt-3 space-y-2">
            {v.highlights.map((h, i) => (
              <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-secondary" aria-hidden /> {h}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 rounded-3xl bg-muted p-6">
        <p className="font-semibold text-plum-950">Interested in {v.business_name}?</p>
        <p className="mt-1 text-sm text-ink-muted">Ask for a quote from your Host house. Prices and dates are only confirmed in a quote.</p>
        <Link to="/host/$section" params={{ section: "quotes" }} className="btn-primary mt-4 inline-flex h-11 items-center px-5">Request a quote</Link>
      </div>
    </article>
  );
}
