import { useLocation, useParams, useSearchParams } from "@/lib/router";
import { HOUSES, findNavItem, type HouseId } from "@/lib/houses";
import { useAuth } from "@/lib/auth/AuthProvider";
import { QuotesPanel } from "@/features/quotes/QuotesPanel";
import { VendorCalendarPanel } from "@/features/holds/VendorCalendarPanel";
import { HouseAlerts } from "@/features/holds/HouseAlerts";
import { ProfileCopyStudio } from "@/features/vendor-profile/ProfileCopyStudio";
import NotFound from "./NotFound";

export default function HousePage({ houseId }: { houseId: HouseId }) {
  const house = HOUSES[houseId];
  const { section } = useParams();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const { houses } = useAuth();
  const item = findNavItem(house, section);
  if (!item) return <NotFound />;

  const myHouse = houses.find((entry) => entry.kind === houseId);
  const query = params.get("q");
  const holdsDates =
    myHouse !== undefined &&
    (myHouse.capabilities.includes("calendar") || myHouse.capabilities.includes("quotes"));
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
      {item.slug === "quotes" && myHouse && (
        <div className="mt-8 space-y-6">
          <HouseAlerts house={myHouse} />
          <QuotesPanel
            house={myHouse}
            side={houseId}
            hostHint={params.get("host")}
            dateHint={params.get("date")}
          />
        </div>
      )}
      {item.slug === "calendar" && myHouse && holdsDates && (
        <div className="mt-8 space-y-6">
          <HouseAlerts house={myHouse} />
          <VendorCalendarPanel house={myHouse} />
        </div>
      )}
      {item.slug === "calendar" && myHouse && !holdsDates && (
        <p className="mt-8 text-sm text-ink-muted" data-testid="calendar-no-capability">
          Your role in this house does not include the calendar. Ask the owner for the calendar
          capability.
        </p>
      )}
      {item.slug === "profile" && houseId === "vendor" && (
        <div className="mt-8">
          <ProfileCopyStudio defaultName={myHouse?.display_name ?? ""} />
        </div>
      )}
      {item.slug !== "quotes" && item.slug !== "calendar" && item.slug !== "profile" && (
        <p className="mt-8 text-sm text-ink-subtle" data-path={pathname}>
          This workspace is scaffolded; its tools arrive with later features.
        </p>
      )}
    </section>
  );
}
