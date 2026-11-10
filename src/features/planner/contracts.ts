/**
 * F-101 OwanbePlanner AI: the planner's shapes and the rules that keep its answers honest.
 *
 * The model may only arrange facts the platform can verify: the published vendor profiles and
 * what the host told us. Everything it says about a price, an availability or a budget fit is
 * checked here, in code, before the plan reaches a host.
 *
 *   * a price is shown only when the vendor published it in their own price note
 *   * availability is always unknown: the platform holds no per-date vendor calendar
 *   * a budget fit is stated only when the vendor's own note carries a parsable amount
 *   * a vendor the model invented is dropped rather than shown
 */
import { z } from "zod";
import { AI_DISCLOSURE } from "@/features/ai/contracts";

/** The label that sits on every planner output, so a plan is never read as a person's advice. */
export const PLANNER_DISCLOSURE = AI_DISCLOSURE.planner;

/** One generation per host per 30 seconds. The database enforces the same backstop. */
export const PLANNER_COOLDOWN_SECONDS = 30;

/** Shown when the vendor published no readable price. */
export const PRICE_UNKNOWN_LABEL = "Price unknown — request a quote";

/** The honest answer for every vendor: the platform has no per-date availability. */
export const AVAILABILITY_UNKNOWN_LABEL = "Availability unknown — ask the vendor";

export const plannerInputSchema = z.object({
  event_type: z.string().trim().min(1, "Tell us what you are celebrating.").max(60),
  city: z.string().trim().min(1, "Tell us the city.").max(60),
  guest_count: z.number().int().min(1, "Tell us how many guests are coming.").max(5000),
  budget_minor: z.number().int().positive("Enter a budget above zero."),
  budget_currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, for example NGN."),
  brief: z.string().trim().min(1, "Tell us what you want from this celebration.").max(500),
});
export type PlannerInput = z.infer<typeof plannerInputSchema>;

/** A published vendor profile, as the planner may use it. */
export interface VendorFact {
  slug: string;
  business_name: string;
  category: string;
  locations: string;
  price_note: string;
  services: string[];
  highlights: string[];
}

/** The shape the model is asked for. Nothing here is trusted until it is grounded. */
export const rawPlanSchema = z.object({
  summary: z.string(),
  options: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      vendor_slugs: z.array(z.string()),
      steps: z.array(z.object({ title: z.string(), detail: z.string() })),
    }),
  ),
});
export type RawPlan = z.infer<typeof rawPlanSchema>;

export type BudgetFit = "within_budget" | "above_budget" | "unknown";

export interface GroundedVendor {
  slug: string;
  business_name: string;
  category: string;
  /** The vendor's own words, or the unknown-price label. Never a number we made up. */
  price_label: string;
  price_known: boolean;
  availability_label: string;
  budget_fit: BudgetFit;
}

export interface GroundedOption {
  title: string;
  summary: string;
  vendors: GroundedVendor[];
  steps: { title: string; detail: string }[];
}

export interface GroundedPlan {
  summary: string;
  options: GroundedOption[];
  /** Vendors the model named that no published profile backs. */
  removed_vendors: number;
  /** Vendors whose price could not be read from their own note. */
  unknown_prices: number;
}

// ---------------------------------------------------------------------------
// Reading a vendor's own price note
// ---------------------------------------------------------------------------
const CURRENCY_TOKENS: { pattern: string; currency: string }[] = [
  { pattern: "\u20a6", currency: "NGN" },
  { pattern: "\bNGN\b", currency: "NGN" },
  { pattern: "\bnaira?s?\b", currency: "NGN" },
  { pattern: "US\\$", currency: "USD" },
  { pattern: "\\$", currency: "USD" },
  { pattern: "\bdollars?\b", currency: "USD" },
  { pattern: "\bUSD\b", currency: "USD" },
  { pattern: "\u00a3", currency: "GBP" },
  { pattern: "\bpounds?\b", currency: "GBP" },
  { pattern: "\bGBP\b", currency: "GBP" },
  { pattern: "\u20ac", currency: "EUR" },
  { pattern: "\beuros?\b", currency: "EUR" },
  { pattern: "\bEUR\b", currency: "EUR" },
];

export interface ParsedPrice {
  amount_minor: number;
  currency: string;
}

/** A price per unit cannot be compared with a total budget. */
const PER_UNIT = /\bper\s+(guest|person|head|table|plate|day|night)\b|\/\s*(guest|person|head)\b/i;

/**
 * The amount in a vendor's own price note, when it can be read without guessing.
 * Returns null when the note states no price, states a price per unit, or names a different
 * number of guests than the host is planning for.
 */
export function parsePriceNote(note: string, guestCount?: number): ParsedPrice | null {
  const text = (note ?? "").trim();
  if (!text) return null;
  if (PER_UNIT.test(text)) return null;

  const tokens: { index: number; currency: string }[] = [];
  for (const { pattern, currency } of CURRENCY_TOKENS) {
    const regex = new RegExp(pattern, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      tokens.push({ index: match.index, currency });
    }
  }
  if (tokens.length === 0) return null;
  tokens.sort((a, b) => a.index - b.index);

  const numbers: { index: number; value: number }[] = [];
  const numberRegex = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?/gi;
  let found: RegExpExecArray | null;
  while ((found = numberRegex.exec(text)) !== null) {
    const raw = (found[1] ?? "").replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const suffix = (found[2] ?? "").toLowerCase();
    const scaled =
      suffix === "k" || suffix === "thousand"
        ? value * 1_000
        : suffix === "m" || suffix === "million"
          ? value * 1_000_000
          : value;
    numbers.push({ index: found.index, value: scaled });
  }
  if (numbers.length === 0) return null;

  // The nearest number to the first currency token, within fifteen characters either way.
  const token = tokens.at(0);
  if (!token) return null;
  const near = numbers
    .map((number) => ({ number, distance: Math.abs(number.index - token.index) }))
    .filter((entry) => entry.distance <= 15)
    .sort((a, b) => a.distance - b.distance)
    .at(0);
  if (!near) return null;

  // A note priced for a different guest count says nothing about this host's budget.
  if (typeof guestCount === "number") {
    const guestMatch = /(\d[\d,]*)\s*guests?/i.exec(text);
    const guests = (guestMatch?.[1] ?? "").replace(/,/g, "");
    if (guests && Number(guests) !== guestCount) return null;
  }

  return {
    amount_minor: Math.round(near.number.value * 100),
    currency: token.currency,
  };
}

/** Whether a vendor's own price sits inside the host's budget. Unknown stays unknown. */
export function budgetFitFor(price: ParsedPrice | null, input: PlannerInput): BudgetFit {
  if (!price) return "unknown";
  if (price.currency !== input.budget_currency) return "unknown";
  return price.amount_minor <= input.budget_minor ? "within_budget" : "above_budget";
}

/** The price line a host reads: the vendor's own words, or the honest unknown. */
export function priceLabelFor(
  note: string,
  guestCount?: number,
): {
  label: string;
  known: boolean;
  price: ParsedPrice | null;
} {
  const price = parsePriceNote(note, guestCount);
  if (!price) return { label: PRICE_UNKNOWN_LABEL, known: false, price: null };
  return { label: (note ?? "").trim(), known: true, price };
}

// ---------------------------------------------------------------------------
// Keeping the model's prose honest
// ---------------------------------------------------------------------------
const PRICE_CLAIM =
  /(?:\u20a6|NGN|\$|US\$|\u00a3|\u20ac|USD|GBP|EUR|naira?s?|dollars?|pounds?|euros?)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|thousand|million)?|\d[\d,]*(?:\.\d+)?\s?(?:\u20a6|NGN|\$|US\$|\u00a3|\u20ac|USD|GBP|EUR|naira?s?|dollars?|pounds?|euros?)/gi;

const AVAILABILITY_CLAIM =
  /\b(?:is|are|was|were)\s+(?:available|booked|fully booked|free|unavailable)\b/gi;

/**
 * The model's own words, with any price it invented and any availability it claimed removed.
 * A plan that cannot name a price says so; it never carries a number the platform cannot back.
 */
export function scrubPlanText(text: string): string {
  const withoutPrices = (text ?? "").replace(PRICE_CLAIM, "a price to confirm");
  const tidied = withoutPrices.replace(
    /\b(?:from|at|for|around|about|only|just|starting at|starting from)\s+a price to confirm/gi,
    "a price to confirm",
  );
  return tidied.replace(AVAILABILITY_CLAIM, "may be available");
}

// ---------------------------------------------------------------------------
// Grounding the model's answer
// ---------------------------------------------------------------------------
/**
 * Turns the model's answer into what the host may see. A vendor with no published profile is
 * dropped, a vendor's name is theirs, a price is theirs or it is unknown, and availability is
 * always unknown because the platform holds no per-date calendar.
 */
export function groundPlan(raw: RawPlan, facts: VendorFact[], input: PlannerInput): GroundedPlan {
  const bySlug = new Map(facts.map((fact) => [fact.slug, fact]));
  let removedVendors = 0;
  let unknownPrices = 0;

  const options: GroundedOption[] = raw.options.slice(0, 6).map((option) => {
    const vendors: GroundedVendor[] = [];
    const seen = new Set<string>();
    for (const slug of option.vendor_slugs ?? []) {
      const fact = bySlug.get(slug);
      if (!fact) {
        removedVendors += 1;
        continue;
      }
      if (seen.has(slug)) continue;
      seen.add(slug);
      const { label, known, price } = priceLabelFor(fact.price_note, input.guest_count);
      if (!known) unknownPrices += 1;
      vendors.push({
        slug: fact.slug,
        business_name: fact.business_name,
        category: fact.category,
        price_label: label,
        price_known: known,
        availability_label: AVAILABILITY_UNKNOWN_LABEL,
        budget_fit: budgetFitFor(price, input),
      });
    }
    return {
      title: scrubPlanText(option.title ?? "").slice(0, 120),
      summary: scrubPlanText(option.summary ?? "").slice(0, 400),
      vendors,
      steps: (option.steps ?? []).slice(0, 8).map((step) => ({
        title: scrubPlanText(step.title ?? "").slice(0, 120),
        detail: scrubPlanText(step.detail ?? "").slice(0, 400),
      })),
    };
  });

  return {
    summary: scrubPlanText(raw.summary ?? "").slice(0, 600),
    options,
    removed_vendors: removedVendors,
    unknown_prices: unknownPrices,
  };
}

/** The plan as it is logged: the titles and summaries the host saw, and the vendors cited. */
export function planSummaryForLog(plan: GroundedPlan): {
  title: string;
  summary: string;
  vendor_slugs: string[];
}[] {
  return plan.options.map((option) => ({
    title: option.title,
    summary: option.summary,
    vendor_slugs: option.vendors.map((vendor) => vendor.slug),
  }));
}
