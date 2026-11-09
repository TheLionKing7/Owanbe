import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MaskedGuest, RsvpResponse } from "./contracts";

export type PublicGuestListResult =
  | { ok: true; title: string | null; guests: MaskedGuest[] }
  | { ok: false; unavailable: true }
  | { ok: false; unavailable?: false; error: string };

/**
 * Public read of a list the host made public, through the masked database projection and the
 * publishable key. The projection declares no phone or address column, so there is nothing here
 * that could carry a contact detail into a public page.
 */
async function callPublic(listId: string): Promise<PublicGuestListResult> {
  const url = process.env["EXTERNAL_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["EXTERNAL_SUPABASE_PUBLISHABLE_KEY"] ??
    process.env["EXTERNAL_SUPABASE_ANON_KEY"] ??
    process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || key.startsWith("sb_secret_")) {
    return { ok: false, error: "Guest lists aren't available right now." };
  }
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/public_guest_list`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_list: listId }),
    });
    // One answer for "missing" and "not public": the page must not reveal which lists exist.
    if (res.status === 404) return { ok: false, unavailable: true };
    if (!res.ok) {
      console.error("public_guest_list failed", res.status);
      return { ok: false, error: "Guest lists aren't available right now." };
    }
    const rows = (await res.json()) as {
      list_title: string;
      display_name: string;
      response: RsvpResponse;
    }[];
    return {
      ok: true,
      title: rows[0]?.list_title ?? null,
      guests: rows.map((row) => ({ display_name: row.display_name, response: row.response })),
    };
  } catch (err) {
    console.error("public_guest_list error", err);
    return { ok: false, error: "We couldn't reach this guest list. Please try again." };
  }
}

export const getPublicGuestList = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ listId: z.string().uuid() }).parse(input))
  .handler(({ data }) => callPublic(data.listId));
