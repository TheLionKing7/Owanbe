/**
 * Vendor profile copy presets. Each category lists the service options, details and
 * wording hosts in Nigerian and diaspora celebrations commonly look for. Vendors can turn
 * any option on/off and add their own, so these are starting points, not limits.
 * No prices or fees are suggested here; vendors supply their own figures.
 */
export interface DetailField {
  key: string;
  label: string;
  placeholder: string;
}

export interface VendorCategoryPreset {
  slug: string;
  label: string;
  /** What hosts usually check first for this kind of vendor. */
  hostPriorities: string;
  offerings: string[];
  details: DetailField[];
}

export const VENDOR_CATEGORIES: VendorCategoryPreset[] = [
  {
    slug: "event-centers",
    label: "Event Centers",
    hostPriorities: "capacity, steady power, parking, security, location access and what the package includes",
    offerings: ["Hall only", "Hall with chairs & tables", "Full package (hall, decor, catering)", "Outdoor / garden space", "Bridal & changing room", "Backup generator", "Air conditioning", "On-site security", "Parking", "Rehearsal access"],
    details: [
      { key: "capacity", label: "Guest capacity", placeholder: "e.g. 500 seated, 800 standing" },
      { key: "location", label: "Location & landmarks", placeholder: "e.g. Lekki Phase 1, near the toll gate" },
      { key: "parking", label: "Parking", placeholder: "e.g. 120 cars on site" },
      { key: "hours", label: "Hire hours / closing time", placeholder: "e.g. 8 hours, closes 11pm" },
    ],
  },
  {
    slug: "service-apartments",
    label: "Service Apartments",
    hostPriorities: "closeness to the venue, 24-hour power, security and room for out-of-town or diaspora guests",
    offerings: ["Studio units", "1-bedroom", "2-bedroom", "3-bedroom+", "Group / block booking for guests", "24-hour power", "Wi-Fi", "Swimming pool", "Airport pickup", "Housekeeping", "Bridal prep suite"],
    details: [
      { key: "units", label: "Units available", placeholder: "e.g. 12 apartments" },
      { key: "location", label: "Location & nearby venues", placeholder: "e.g. 5 minutes from Eko Hotel" },
      { key: "stay", label: "Minimum stay / check-in", placeholder: "e.g. 1 night, check-in 2pm" },
    ],
  },
  {
    slug: "catering",
    label: "Catering",
    hostPriorities: "menu range, taste, portion size, staff, hygiene and whether they can serve the full guest count on time",
    offerings: ["Nigerian party jollof", "Native / Yoruba dishes (amala, ewedu, ofada)", "Continental", "Small chops", "Asun & grills", "Cocktails & mocktails", "Cakes & desserts", "Food tasting session", "Waiters & servers", "Vegetarian options", "Packed meals / take-away"],
    details: [
      { key: "guests", label: "Guest numbers you handle", placeholder: "e.g. 50 to 2,000 guests" },
      { key: "service", label: "Service style", placeholder: "e.g. buffet, served plates, food stands" },
      { key: "staff", label: "Team on the day", placeholder: "e.g. 20 servers, 4 chefs" },
    ],
  },
  {
    slug: "mc",
    label: "MC / Compère",
    hostPriorities: "language, energy, crowd control, timekeeping and knowing traditional order of events",
    offerings: ["Wedding reception MC", "Traditional engagement (Alaga Ijoko / Iduro)", "Birthday & anniversary", "Corporate events", "Comedy MC", "Funeral & remembrance", "Bilingual hosting", "Programme planning with host"],
    details: [
      { key: "languages", label: "Languages", placeholder: "e.g. English, Yoruba, Pidgin" },
      { key: "style", label: "Hosting style", placeholder: "e.g. lively and witty, or classic and formal" },
      { key: "experience", label: "Experience", placeholder: "e.g. 10 years, 300+ weddings" },
    ],
  },
  {
    slug: "fashion",
    label: "Fashion Designers",
    hostPriorities: "fit, fabric quality, turnaround time, aso-ebi coordination and fittings",
    offerings: ["Bridal gowns", "Traditional wedding attire", "Agbada & men's native", "Aso-ebi for family & friends", "Gele & headwrap tying", "Asoke / aso-oke sourcing", "Ready-to-wear", "Alterations", "Diaspora shipping"],
    details: [
      { key: "turnaround", label: "Usual turnaround", placeholder: "e.g. 3 weeks, rush available" },
      { key: "fittings", label: "Fittings", placeholder: "e.g. 2 fittings, virtual fittings for diaspora" },
      { key: "volume", label: "Aso-ebi capacity", placeholder: "e.g. up to 150 outfits per event" },
    ],
  },
  {
    slug: "photo-video",
    label: "Photo & Video",
    hostPriorities: "style, coverage hours, delivery time, team size and sample work",
    offerings: ["Photography", "Videography", "Drone coverage", "Same-day highlight edit", "Pre-wedding shoot", "Photo booth", "Printed albums", "Live streaming for diaspora guests", "Second shooter"],
    details: [
      { key: "coverage", label: "Coverage", placeholder: "e.g. up to 12 hours" },
      { key: "delivery", label: "Delivery time", placeholder: "e.g. highlights in 48 hours, full set in 3 weeks" },
      { key: "style", label: "Style", placeholder: "e.g. candid, documentary, editorial" },
    ],
  },
  {
    slug: "live-band",
    label: "Live Bands",
    hostPriorities: "genres, band size, own sound system, playing hours and crowd energy",
    offerings: ["Juju", "Fuji", "Highlife", "Afrobeats", "Gospel", "Talking drum / ensemble", "Saxophonist", "Own sound system", "DJ hand-over", "Praise & worship session"],
    details: [
      { key: "size", label: "Band size", placeholder: "e.g. 8-piece band" },
      { key: "duration", label: "Playing time", placeholder: "e.g. 4 hours" },
      { key: "repertoire", label: "Signature songs / repertoire", placeholder: "e.g. classic Juju and modern Afrobeats" },
    ],
  },
  {
    slug: "decor",
    label: "Decor",
    hostPriorities: "theme, florals, stage, lighting, setup and tear-down times",
    offerings: ["Stage & backdrop", "Fresh flowers", "Artificial florals", "Table settings & centrepieces", "Lighting", "Ceiling draping", "Traditional engagement decor", "Entrance & walkway", "Balloon styling", "Setup & tear-down"],
    details: [
      { key: "themes", label: "Themes you love", placeholder: "e.g. royal gold, garden, minimalist" },
      { key: "setup", label: "Setup time", placeholder: "e.g. 6 hours before event" },
      { key: "scale", label: "Event sizes", placeholder: "e.g. 50 to 1,500 guests" },
    ],
  },
  {
    slug: "event-manager",
    label: "Event Managers",
    hostPriorities: "planning experience, vendor network, budget control and calm on-the-day coordination",
    offerings: ["Full planning", "Partial planning", "Day-of coordination", "Vendor sourcing & management", "Budget planning", "Guest management", "Destination / diaspora weddings", "Order of events & programme"],
    details: [
      { key: "experience", label: "Experience", placeholder: "e.g. 8 years, 150 events" },
      { key: "team", label: "Team size on the day", placeholder: "e.g. 6 coordinators" },
      { key: "areas", label: "Areas served", placeholder: "e.g. Lagos, Ibadan, Abuja" },
    ],
  },
  {
    slug: "chauffeur",
    label: "Chauffeur Services",
    hostPriorities: "vehicle condition, punctuality, professional drivers and convoy coordination",
    offerings: ["Bridal car", "Luxury sedans", "SUVs", "Buses for guests", "Convoy / motorcade", "Airport transfers", "Vintage cars", "Decorated cars", "Hourly hire", "Full-day hire"],
    details: [
      { key: "fleet", label: "Fleet", placeholder: "e.g. 2 Rolls-Royce, 6 SUVs, 3 buses" },
      { key: "areas", label: "Areas covered", placeholder: "e.g. Lagos and Ogun" },
      { key: "drivers", label: "Drivers", placeholder: "e.g. uniformed, vetted drivers" },
    ],
  },
  {
    slug: "protocol-security",
    label: "Protocol & Security",
    hostPriorities: "trained staff, crowd control, gate and invitation checks, VIP handling and discretion",
    offerings: ["Ushers & hostesses", "Protocol officers", "Bouncers", "Crowd control", "Gate & invitation checks", "VIP escort", "Car park marshals", "Gift table security", "Uniformed staff"],
    details: [
      { key: "team", label: "Team size available", placeholder: "e.g. up to 60 staff" },
      { key: "training", label: "Training & vetting", placeholder: "e.g. ex-service, background checked" },
      { key: "areas", label: "Areas covered", placeholder: "e.g. Lagos, Abuja, Port Harcourt" },
    ],
  },
];

export const TONES = [
  { value: "warm", label: "Warm & welcoming" },
  { value: "luxury", label: "Elegant & luxurious" },
  { value: "lively", label: "Lively & fun" },
  { value: "professional", label: "Professional & precise" },
] as const;

export type Tone = (typeof TONES)[number]["value"];

export function findCategory(slug: string): VendorCategoryPreset | undefined {
  return VENDOR_CATEGORIES.find((c) => c.slug === slug);
}
