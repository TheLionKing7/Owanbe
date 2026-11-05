import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicVendorProfile } from "./profile-data";

export type PublicVendorsResult = { ok: true; vendors: PublicVendorProfile[] } | { ok: false; error: string };

/** Public read: only published profiles, through the safe database projection and the public key. */
async function callPublic(slug: string | null): Promise<PublicVendorsResult> {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key = process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["EXTERNAL_SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) return { ok: false, error: "The vendor directory isn't available right now." };
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/public_vendor_profiles`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!res.ok) {
      console.error("public_vendor_profiles failed", res.status);
      return { ok: false, error: "The vendor directory isn't available right now." };
    }
    return { ok: true, vendors: (await res.json()) as PublicVendorProfile[] };
  } catch (err) {
    console.error("public_vendor_profiles error", err);
    return { ok: false, error: "We couldn't reach the vendor directory. Please try again." };
  }
}

export const listPublicVendors = createServerFn({ method: "GET" }).handler(() => callPublic(null));

export const getPublicVendor = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().regex(/^[a-z0-9-]{3,60}$/) }).parse(input))
  .handler(({ data }) => callPublic(data.slug));
