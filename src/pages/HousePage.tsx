import { useLocation, useParams, useSearchParams } from "@/lib/router";
import { HOUSES, findNavItem, type HouseId } from "@/lib/houses";
import NotFound from "./NotFound";

export default function HousePage({ houseId }: { houseId: HouseId }) {
  const house = HOUSES[houseId];
  const { section } = useParams();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const item = findNavItem(house, section);
  if (!item) return <NotFound />;

  const query = params.get("q");
  return (
    <section aria-labelledby="house-page-title">
      <p className="text-sm text-ink-muted">{house.tagline}</p>
      <h1 id="house-page-title" className="mt-2 font-display text-4xl font-bold text-plum-950">
        {item.label}
      </h1>
      <p className="mt-3 text-lg text-ink-muted">{item.description}</p>
      {query && (
        <p className="mt-6 rounded-2xl bg-white p-4 shadow-card">
          Planning: <strong className="text-plum-800">{query}</strong>
        </p>
      )}
      <p className="mt-8 text-sm text-ink-subtle" data-path={pathname}>
        This workspace is scaffolded; its tools arrive with later features.
      </p>
    </section>
  );
}
