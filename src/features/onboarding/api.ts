/**
 * F-7 persistence boundary: public.my_onboarding, public.save_onboarding and
 * public.complete_onboarding (supabase/migrations/20261107090000_f7_onboarding.sql), plus the
 * existing public.open_vendor_house. Every call runs as the signed-in user.
 */
import type { HostIntent, OnboardingRole, OnboardingState } from "./contracts";

export type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export type OnboardingErrorCode =
  "unavailable" | "role_locked" | "incomplete" | "invalid" | "network" | "unknown";

export class OnboardingError extends Error {
  constructor(
    public readonly code: OnboardingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const ONBOARDING_ERROR_COPY: Record<OnboardingErrorCode, string> = {
  unavailable: "Account setup isn't switched on yet. You can carry on to your house.",
  role_locked: "Your account is already set up. You can open the other house from inside the app.",
  incomplete: "A required detail is missing. Check the step and try again.",
  invalid: "One of the details isn't valid. Check the highlighted fields.",
  network:
    "We couldn't reach Ówàńbè. Check your connection and try again; nothing you typed is lost.",
  unknown: "Something went wrong saving your details. Try again in a moment.",
};

export function classifyOnboardingError(message: string): OnboardingErrorCode {
  if (/could not find the function|schema cache|does not exist/i.test(message))
    return "unavailable";
  if (message.includes("role_locked")) return "role_locked";
  if (message.includes("onboarding_incomplete") || message.includes("onboarding_not_started"))
    return "incomplete";
  if (/invalid_|_check|event_date_in_past/.test(message)) return "invalid";
  if (/fetch|network|timeout|failed to fetch/i.test(message)) return "network";
  return "unknown";
}

export interface SaveInput {
  role: OnboardingRole;
  displayName?: string | null;
  phone?: string | null;
  city?: string | null;
  hostIntent?: HostIntent | null;
  eventType?: string | null;
  eventDate?: string | null;
  businessCategory?: string | null;
}

export interface OnboardingApi {
  load(): Promise<OnboardingState | null>;
  save(input: SaveInput): Promise<void>;
  complete(): Promise<void>;
  openVendorHouse(businessName: string): Promise<void>;
}

async function guard<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OnboardingError(classifyOnboardingError(message), message);
  }
}

export function onboardingApi(rpc: Rpc): OnboardingApi {
  return {
    load: () =>
      guard(async () => {
        const rows = await rpc<OnboardingState[] | null>("my_onboarding");
        return rows?.[0] ?? null;
      }),
    save: (input) =>
      guard(() =>
        rpc<void>("save_onboarding", {
          p_role: input.role,
          p_display_name: input.displayName ?? null,
          p_phone: input.phone ?? null,
          p_city: input.city ?? null,
          p_host_intent: input.hostIntent ?? null,
          p_event_type: input.eventType ?? null,
          p_event_date: input.eventDate || null,
          p_business_category: input.businessCategory ?? null,
        }),
      ),
    complete: () => guard(() => rpc<string>("complete_onboarding").then(() => undefined)),
    openVendorHouse: (businessName) =>
      guard(() =>
        rpc<string>("open_vendor_house", { p_display_name: businessName }).then(() => undefined),
      ),
  };
}
