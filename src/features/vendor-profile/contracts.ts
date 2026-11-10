import { z } from "zod";
import { findCategory, TONES } from "./presets";

const text = (max: number) => z.string().trim().max(max);

export const profileBriefSchema = z
  .object({
    businessName: text(80).min(2, "Add your business name"),
    category: z.string().refine((v) => !!findCategory(v), "Choose a category"),
    offerings: z.array(text(80).min(1)).min(1, "Pick at least one service").max(20),
    details: z.record(z.string(), text(200)).default({}),
    story: text(1500).min(20, "Tell us a little more (at least 20 characters)"),
    tone: z.enum(TONES.map((t) => t.value) as [string, ...string[]]),
    locations: text(120).default(""),
    priceNote: text(160).default(""),
  })
  .strict();

export type ProfileBrief = z.infer<typeof profileBriefSchema>;

export interface ProfileServiceCopy {
  name: string;
  description: string;
}

export interface ProfileCopy {
  headline: string;
  tagline: string;
  about: string;
  services: ProfileServiceCopy[];
  highlights: string[];
}

export type GenerateResult =
  | { ok: true; copy: ProfileCopy; interaction_id: string | null }
  | { ok: false; error: string; retryable: boolean };

/** The draft as plain text, for the clipboard and for the interaction log. */
export function profileCopyText(copy: ProfileCopy): string {
  return [
    copy.headline,
    copy.tagline,
    "",
    copy.about,
    "",
    "Services",
    ...copy.services.map((s) => `• ${s.name}: ${s.description}`),
    "",
    "Why hosts choose us",
    ...copy.highlights.map((h) => `• ${h}`),
  ].join("\n");
}

/** Trims and clamps model output so the UI never shows broken or oversized copy. */
export function normalizeCopy(raw: unknown): ProfileCopy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const services = Array.isArray(r["services"])
    ? (r["services"] as unknown[])
        .map((x) => ({ name: s((x as Record<string, unknown>)?.["name"], 80), description: s((x as Record<string, unknown>)?.["description"], 400) }))
        .filter((x) => x.name && x.description)
        .slice(0, 12)
    : [];
  const highlights = Array.isArray(r["highlights"])
    ? (r["highlights"] as unknown[]).map((h) => s(h, 120)).filter(Boolean).slice(0, 6)
    : [];
  const copy = { headline: s(r["headline"], 100), tagline: s(r["tagline"], 160), about: s(r["about"], 2000), services, highlights };
  return copy.headline && copy.about ? copy : null;
}
