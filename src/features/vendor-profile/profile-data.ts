import type { ProfileCopy } from "./contracts";

/** Brief fields the vendor typed; stored so the studio reopens exactly where they left off. */
export interface SavedBrief {
  offerings?: string[];
  customOfferings?: string[];
  details?: Record<string, string>;
  story?: string;
  tone?: string;
}

/** Row of public.vendor_profiles as the owning house sees it. */
export interface VendorProfileRow {
  house_id: string;
  slug: string;
  business_name: string;
  category: string;
  locations: string;
  price_note: string;
  brief: SavedBrief;
  headline: string;
  tagline: string;
  about: string;
  services: ProfileCopy["services"];
  highlights: string[];
  published: boolean;
  updated_at: string;
}

/** Safe public projection returned by public.public_vendor_profiles(). */
export interface PublicVendorProfile {
  slug: string;
  business_name: string;
  category: string;
  locations: string;
  price_note: string;
  headline: string;
  tagline: string;
  about: string;
  services: ProfileCopy["services"];
  highlights: string[];
  published_at: string | null;
}

export interface SaveInput {
  businessName: string;
  category: string;
  locations: string;
  priceNote: string;
  brief: SavedBrief;
  copy: ProfileCopy;
}

/** Builds the payload for public.save_vendor_profile; trims and drops empty services/highlights. */
export function toSavePayload(input: SaveInput) {
  return {
    business_name: input.businessName.trim(),
    category: input.category,
    locations: input.locations.trim(),
    price_note: input.priceNote.trim(),
    brief: input.brief,
    headline: input.copy.headline.trim(),
    tagline: input.copy.tagline.trim(),
    about: input.copy.about.trim(),
    services: input.copy.services
      .map((s) => ({ name: s.name.trim(), description: s.description.trim() }))
      .filter((s) => s.name && s.description)
      .slice(0, 12),
    highlights: input.copy.highlights.map((h) => h.trim()).filter(Boolean).slice(0, 6),
  };
}

/** A profile can go live only with a name, category, headline and about text. */
export function publishProblem(input: SaveInput): string | null {
  if (input.businessName.trim().length < 2) return "Add your business name before publishing.";
  if (!input.category) return "Choose your vendor category before publishing.";
  if (!input.copy.headline.trim()) return "Add a headline before publishing.";
  if (!input.copy.about.trim()) return "Add an about section before publishing.";
  return null;
}

export function saveErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("forbidden")) return "Your role in this house can't edit the profile. Ask the owner for the profile permission.";
  if (msg.includes("save_vendor_profile") || msg.includes("schema cache")) return "Profile saving isn't switched on yet. The database update still needs to be run.";
  if (msg.includes("check constraint")) return "Some text is too long or missing. Shorten it and try again.";
  return "We couldn't save your profile. Check your connection and try again.";
}
