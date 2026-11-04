/**
 * Navigation scaffolding for the two separate "houses".
 * Host house: people planning a celebration. Vendor house: businesses serving them.
 * Each entry records the blueprint feature that will fill the page in.
 */
export type HouseId = "host" | "vendor";

export interface HouseNavItem {
  slug: string; // "" = house home
  label: string;
  description: string;
  feature?: string;
}

export interface House {
  id: HouseId;
  name: string;
  tagline: string;
  basePath: `/${HouseId}`;
  nav: HouseNavItem[];
}

export const HOUSES: Record<HouseId, House> = {
  host: {
    id: "host",
    name: "Host House",
    tagline: "Plan your celebration, compare quotes and manage your guests.",
    basePath: "/host",
    nav: [
      { slug: "", label: "Overview", description: "Your celebrations at a glance." },
      { slug: "plan", label: "AI Planner", description: "Turn your ideas into a perfect plan." },
      { slug: "events", label: "My Events", description: "Every occasion you are planning." },
      { slug: "enquiries", label: "Enquiries", description: "Conversations with vendors." },
      { slug: "quotes", label: "Quotes", description: "Compare and accept vendor quotes." },
      { slug: "payments", label: "Payments", description: "Deposits, balances and receipts." },
      { slug: "guests", label: "Guests", description: "Invitations, RSVPs and guest access." },
    ],
  },
  vendor: {
    id: "vendor",
    name: "Vendor House",
    tagline: "Get discovered, respond to enquiries and run your bookings.",
    basePath: "/vendor",
    nav: [
      { slug: "", label: "Overview", description: "Your business at a glance." },
      { slug: "enquiries", label: "Enquiries", description: "New requests from hosts." },
      { slug: "quotes", label: "Quotes", description: "Send and track your quotes." },
      { slug: "calendar", label: "Calendar", description: "Bookings and availability." },
      { slug: "profile", label: "Profile & Showcase", description: "How hosts see your work." },
      { slug: "team", label: "Team", description: "Staff roles and permissions." },
      { slug: "payouts", label: "Payouts", description: "Earnings and payout history." },
    ],
  },
};

export function findNavItem(house: House, slug: string | undefined): HouseNavItem | undefined {
  return house.nav.find((item) => item.slug === (slug ?? ""));
}
