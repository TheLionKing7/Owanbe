import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { getPublicGuestList } from "@/features/guest-lists/public.functions";
import { RESPONSE_LABELS } from "@/features/guest-lists/contracts";

export const Route = createFileRoute("/_public/guest-lists/$id")({
  loader: async ({ params }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
      throw notFound();
    }
    const result = await getPublicGuestList({ data: { listId: params.id } });
    if (!result.ok && result.unavailable) throw notFound();
    if (!result.ok) throw new Error(result.error);
    return { title: result.title, guests: result.guests };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.title ? `${loaderData.title} — guest list` : "Guest list — Ówàńbè";
    return {
      meta: [
        { title },
        // A guest list is personal data even when the host publishes it: keep it out of search.
        { name: "robots", content: "noindex, nofollow" },
        {
          name: "description",
          content: "Names and responses shared by the host of this celebration.",
        },
      ],
    };
  },
  component: PublicGuestListPage,
  errorComponent: GuestListError,
  notFoundComponent: () => (
    <section className="mx-auto max-w-page px-4 py-16 sm:px-8 lg:mt-16">
      <h1 className="font-display text-3xl font-bold text-plum-950">
        This guest list isn't available
      </h1>
      <p className="mt-2 text-ink-muted">
        The host may have made it private again, or the link may be wrong.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block font-semibold text-primary underline-offset-4 hover:underline"
      >
        Back to Ówàńbè
      </Link>
    </section>
  ),
});

function GuestListError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section role="alert" className="mx-auto max-w-page px-4 py-16 sm:px-8 lg:mt-16">
      <p className="text-ink-muted">
        {error instanceof Error && error.message
          ? error.message
          : "We couldn't load this guest list."}
      </p>
      <button
        type="button"
        className="btn-primary mt-4 h-11 px-5"
        onClick={() => void router.invalidate()}
      >
        Try again
      </button>
    </section>
  );
}

function PublicGuestListPage() {
  const { title, guests } = Route.useLoaderData();
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-8 lg:mt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">Guest list</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-plum-950">
        {title ?? "A celebration guest list"}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        The host shared this list publicly. It shows names and responses only. Phone numbers and
        addresses are never part of a shared or public view.
      </p>
      <section className="surface mt-6 p-5 sm:p-6">
        {guests.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="public-guests-empty">
            No guests have been added to this list yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="public-guests">
            {guests.map((row, index) => (
              <li
                key={`${row.display_name}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink-subtle/10 px-4 py-3"
              >
                <span className="text-sm font-semibold text-ink">{row.display_name}</span>
                <span className="text-sm text-ink-muted">{RESPONSE_LABELS[row.response]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
