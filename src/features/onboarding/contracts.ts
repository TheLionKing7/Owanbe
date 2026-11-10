/**
 * F-7 onboarding: the rules the sign-up wizard follows. The database enforces the same rules
 * (public.save_onboarding / public.complete_onboarding); these exist so the form can explain a
 * problem before it is sent, never instead of the server check.
 */
import { VENDOR_CATEGORIES } from "@/features/vendor-profile/presets";

export type OnboardingRole = "host" | "vendor";
export type HostIntent = "hosting" | "arranging";

/** Row returned by public.my_onboarding(). */
export interface OnboardingState {
  role: OnboardingRole;
  display_name: string | null;
  phone_e164: string | null;
  phone_verified: boolean;
  city: string | null;
  host_intent: HostIntent | null;
  event_type: string | null;
  event_date: string | null;
  business_category: string | null;
  has_vendor_house: boolean;
  completed_at: string | null;
}

export type OnboardingStep = "role" | "about" | "plans" | "business" | "done";

export const ROLE_COPY: Record<OnboardingRole, { title: string; body: string }> = {
  host: {
    title: "I'm planning a celebration",
    body: "For your own celebration, or as a professional planner for a client: plan, find vendors and request quotes.",
  },
  vendor: {
    title: "I run an events business",
    body: "Event centers, caterers, MCs, decorators and photographers: get found and take bookings.",
  },
};

export const EVENT_TYPES = [
  "Wedding",
  "Traditional engagement",
  "Birthday",
  "Naming ceremony",
  "Burial & remembrance",
  "Housewarming",
  "Graduation",
  "Corporate event",
  "Other celebration",
] as const;

export const BUSINESS_CATEGORIES = VENDOR_CATEGORIES.map((c) => c.label);

export function stepsFor(role: OnboardingRole | null): OnboardingStep[] {
  if (role === "vendor") return ["role", "about", "business", "done"];
  return ["role", "about", "plans", "done"];
}

/** Where to resume: the first step whose required details are missing. */
export function resumeStep(
  state: OnboardingState | null,
  chosenRole: OnboardingRole | null,
): OnboardingStep {
  const role = state?.role ?? chosenRole;
  if (!role) return "role";
  if (state?.completed_at) return "done";
  if (!state || !hasContact(state)) return "about";
  if (role === "host") return state.host_intent ? "done" : "plans";
  return state.business_category && state.has_vendor_house ? "done" : "business";
}

export function hasContact(
  s: Pick<OnboardingState, "display_name" | "phone_e164" | "city">,
): boolean {
  return (
    (s.display_name?.trim().length ?? 0) >= 2 && !!s.phone_e164 && (s.city?.trim().length ?? 0) >= 2
  );
}

/**
 * A phone number as E.164. A local Nigerian number ("0801 234 5678") becomes +234…; any other
 * country needs its + prefix. Returns null when it can't be a valid number.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const plus = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (!plus) {
    // Local Nigerian format: 0 + 10 digits.
    if (/^0[789][01]\d{8}$/.test(digits)) digits = `234${digits.slice(1)}`;
    else if (/^234\d{10}$/.test(digits)) {
      // already has the country code without the +
    } else return null;
  }
  // A Nigerian number written with +234 and its leading 0 kept: drop the 0.
  if (/^2340\d{10}$/.test(digits)) digits = `234${digits.slice(4)}`;
  const e164 = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export interface AboutForm {
  name: string;
  phone: string;
  city: string;
}

export function validateAbout(f: AboutForm): Partial<Record<keyof AboutForm, string>> {
  const errors: Partial<Record<keyof AboutForm, string>> = {};
  if (f.name.trim().length < 2) errors.name = "Add your name (at least 2 characters).";
  if (!normalizePhone(f.phone))
    errors.phone = "Use a full phone number, e.g. 0801 234 5678 or +44 7700 900123.";
  if (f.city.trim().length < 2) errors.city = "Add the city you're in.";
  return errors;
}

export interface PlansForm {
  intent: HostIntent | "";
  eventType: string;
  eventDate: string;
}

export function validatePlans(
  f: PlansForm,
  today = new Date(),
): Partial<Record<keyof PlansForm, string>> {
  const errors: Partial<Record<keyof PlansForm, string>> = {};
  if (!f.intent) errors.intent = "Choose one so we can set things up for you.";
  if (f.eventDate) {
    const day = new Date(`${f.eventDate}T00:00:00`);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (Number.isNaN(day.getTime())) errors.eventDate = "Pick a valid date.";
    else if (day < start) errors.eventDate = "The date has already passed.";
  }
  return errors;
}

export interface BusinessForm {
  businessName: string;
  category: string;
}

export function validateBusiness(f: BusinessForm): Partial<Record<keyof BusinessForm, string>> {
  const errors: Partial<Record<keyof BusinessForm, string>> = {};
  if (f.businessName.trim().length < 2)
    errors.businessName = "Add your business name (at least 2 characters).";
  if (!f.category) errors.category = "Choose what your business does.";
  return errors;
}

/** The OwanbePlanner opener a host lands with, built only from what they told us. */
export function plannerPrompt(
  s: Pick<OnboardingState, "host_intent" | "event_type" | "event_date" | "city">,
): string {
  const what = s.event_type ? s.event_type.toLowerCase() : "celebration";
  const who = s.host_intent === "arranging" ? `a ${what} I'm arranging for a client` : `my ${what}`;
  const when = s.event_date
    ? ` on ${new Date(`${s.event_date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
    : "";
  const where = s.city ? ` in ${s.city}` : "";
  return `Help me plan ${who}${where}${when}.`;
}

/** Only in-app paths are allowed as a destination after onboarding. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/welcome")
    ? next
    : fallback;
}
