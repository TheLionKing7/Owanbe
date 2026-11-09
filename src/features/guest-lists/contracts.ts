/**
 * F-40 guest list contracts. The database (supabase/migrations/20261108120000_f40_guest_list_privacy.sql)
 * is the enforcement point: visibility, tenancy, masking and revocation are all decided there.
 * Everything here is input validation at the trust boundary plus the mirror the UI renders.
 */
import { z } from "zod";

export const GUEST_LIST_VISIBILITIES = ["private", "shared", "public"] as const;
export type GuestListVisibility = (typeof GUEST_LIST_VISIBILITIES)[number];

export const RSVP_RESPONSES = ["invited", "yes", "no", "maybe"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

export const VISIBILITY_LABELS: Record<GuestListVisibility, string> = {
  private: "Private",
  shared: "Shared with selected people",
  public: "Public",
};

export const VISIBILITY_COPY: Record<GuestListVisibility, string> = {
  private:
    "Only you can see this list. Switching to private removes access for everyone you shared it with, straight away.",
  shared:
    "Only the people you picked can open it, and they see names and responses — nothing else.",
  public: "Anyone with the link can see names and responses. Only switch to this when you mean it.",
};

/** True at every visibility, which is why it is stated once rather than per option. */
export const CONTACT_HIDDEN_NOTE =
  "Phone numbers and addresses stay visible to you alone, whatever you choose here.";

export const RESPONSE_LABELS: Record<RsvpResponse, string> = {
  invited: "Invited",
  yes: "Coming",
  no: "Not coming",
  maybe: "Maybe",
};

export const newGuestListSchema = z.object({
  house_id: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Name this guest list")
    .max(120, "Keep the name under 120 characters"),
});
export type NewGuestList = z.input<typeof newGuestListSchema>;

export const newRsvpSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Who is this guest?")
    .max(120, "Keep the name under 120 characters"),
  response: z.enum(RSVP_RESPONSES),
  phone: z.string().trim().max(32, "Keep the phone number under 32 characters").optional(),
  address: z.string().trim().max(300, "Keep the address under 300 characters").optional(),
});
export type NewRsvp = z.input<typeof newRsvpSchema>;

export const shareRequestSchema = z.object({
  grantee_email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "That email address is too long")
    .email("Enter the email address they use on Ówàńbè"),
  expected_version: z.number().int().positive(),
});
export type ShareRequest = z.input<typeof shareRequestSchema>;

export const visibilityRequestSchema = z.object({
  visibility: z.enum(GUEST_LIST_VISIBILITIES),
  expected_version: z.number().int().positive(),
});
export type VisibilityRequest = z.input<typeof visibilityRequestSchema>;

export const revokeRequestSchema = z.object({
  share_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
});
export type RevokeRequest = z.input<typeof revokeRequestSchema>;

/** public.my_guest_lists(): the host's own lists, with counts derived from the rows. */
export interface GuestListSummary {
  list_id: string;
  title: string;
  visibility: GuestListVisibility;
  version: number;
  guest_count: number;
  yes_count: number;
  share_count: number;
  created_at: string;
}

/** public.guest_list_rsvps(): host only. The only shape in this feature that carries contacts. */
export interface GuestRsvp {
  rsvp_id: string;
  display_name: string;
  response: RsvpResponse;
  phone: string | null;
  address: string | null;
  created_at: string;
}

export interface GuestRecipient {
  share_id: string;
  display_name: string;
  granted_at: string;
}

export interface SharedListSummary {
  list_id: string;
  title: string;
  guest_count: number;
}

/** What a recipient or the public sees: the exact column list of the masked SQL projections. */
export interface MaskedGuest {
  display_name: string;
  response: RsvpResponse;
}

export interface PublicGuestRow extends MaskedGuest {
  list_title: string;
}

/** The public page for a list the host made public. */
export function publicGuestListPath(listId: string): string {
  return `/guest-lists/${listId}`;
}

/**
 * The host's "what they will see" preview. It mirrors the SQL projection by constructing a new
 * object from two fields, so a contact field cannot ride along even if the row shape grows.
 */
export function maskPreview(rows: readonly GuestRsvp[]): MaskedGuest[] {
  return rows.map((row) => ({ display_name: row.display_name, response: row.response }));
}
