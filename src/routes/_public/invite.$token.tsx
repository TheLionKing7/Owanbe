import { createFileRoute, Link } from "@tanstack/react-router";
import { InviteClaim } from "@/features/tickets/InviteClaim";

export const Route = createFileRoute("/_public/invite/$token")({
  head: () => ({
    meta: [
      { title: "Your invitation — Ówàńbè" },
      {
        name: "description",
        content: "Confirm your invitation to this celebration and get your entry code.",
      },
      { property: "og:title", content: "Your invitation — Ówàńbè" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      // An invitation link is personal: keep it out of search engines.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:px-8 lg:mt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">Invitation</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-plum-950">You are invited</h1>
      {token.trim().length >= 32 ? (
        <div className="mt-6">
          <InviteClaim token={token.trim()} />
        </div>
      ) : (
        <section className="surface mt-6 p-5 sm:p-6" data-testid="invite-invalid">
          <h2 className="font-display text-xl font-bold text-plum-950">
            This invitation link is not valid
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            The link may have been copied incompletely. Ask the host for a fresh link.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block font-semibold text-primary underline-offset-4 hover:underline"
          >
            Back to Ówàńbè
          </Link>
        </section>
      )}
    </article>
  );
}
