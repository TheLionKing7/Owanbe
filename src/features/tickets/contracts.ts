/**
 * F-108 ticketing contracts. The database (supabase/migrations/20261113150000_f108_ticketing.sql)
 * is the enforcement point: who may issue or revoke a link, who may claim it, and what a scanner
 * is allowed to see are all decided there. Everything here is input validation at the trust
 * boundary plus the mirror the interface renders.
 */
import { z } from "zod";

export const INVITATION_STATUSES = ["issued", "claimed", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** A standard link admits one person; a couple's link admits two. */
export const CLAIM_LIMITS = [1, 2] as const;
export type ClaimLimit = (typeof CLAIM_LIMITS)[number];

export const ADMISSION_RESULTS = ["admitted", "duplicate", "expired", "unknown"] as const;
export type AdmissionResult = (typeof ADMISSION_RESULTS)[number];

export const CHECKIN_MODES = ["online", "queued_offline"] as const;
export type CheckinMode = (typeof CHECKIN_MODES)[number];

export const ADMISSION_STATES = ["issued", "admitted", "revoked"] as const;
export type AdmissionState = (typeof ADMISSION_STATES)[number];

export const RESULT_COPY: Record<AdmissionResult, string> = {
  admitted: "Admitted",
  duplicate: "Already admitted",
  expired: "This card has expired",
  unknown: "This card is not on the list",
};

export const INVITATION_STATUS_COPY: Record<InvitationStatus, string> = {
  issued: "Waiting for a claim",
  claimed: "Claimed",
  revoked: "Revoked",
};

/** The host's issue form. */
export const issueInvitationSchema = z.object({
  guest_list_id: z.string().uuid("Choose a guest list"),
  claim_limit: z.union([z.literal(1), z.literal(2)]),
  claim_deadline: z.string().min(1, "Choose the last day to claim"),
  admission_expires_at: z.string().min(1, "Choose the day the card stops working"),
});
export type IssueInvitationInput = z.input<typeof issueInvitationSchema>;

/** The guest's claim. The phone is stored only as a hash, and the guest needs no account. */
export const claimRequestSchema = z.object({
  token: z.string().trim().min(32, "That invitation link is not valid"),
  display_name: z
    .string()
    .trim()
    .min(1, "Who is this invitation for?")
    .max(120, "Keep the name under 120 characters"),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a phone number we can reach you on")
    .max(32, "Keep the phone number under 32 characters"),
  device_id: z.string().trim().max(120).optional(),
});
export type ClaimRequest = z.input<typeof claimRequestSchema>;

/** Reading the card back with the guest's own session. */
export const guestSessionSchema = z.object({
  guest_session: z.string().trim().min(32, "That card could not be found"),
});
export type GuestSessionRequest = z.input<typeof guestSessionSchema>;

/** The host hands a door device to a named person on the platform. */
export const scannerGrantSchema = z.object({
  guest_list_id: z.string().uuid("Choose a guest list"),
  device_id: z
    .string()
    .trim()
    .min(1, "Give the device a name you will recognise")
    .max(120, "Keep the device name under 120 characters"),
  grantee_email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "That email address is too long")
    .email("Enter the email address they use on Ówàńbè"),
  expires_at: z.string().min(1, "Choose the last day this device may admit guests"),
});
export type ScannerGrantInput = z.input<typeof scannerGrantSchema>;

export const versionRequestSchema = z.object({
  expected_version: z.number().int().positive(),
});
export type VersionRequest = z.input<typeof versionRequestSchema>;

/** public.create_invitation(): the raw link exists once, in the host's hands. */
export interface IssuedInvitation {
  invitation_id: string;
  token: string;
  claim_limit: ClaimLimit;
  generation: number;
  claim_deadline: string;
  admission_expires_at: string;
  version: number;
}

/** public.host_invitations(): the host's own view. The token is a fingerprint, never the token. */
export interface HostInvitation {
  invitation_id: string;
  claim_limit: ClaimLimit;
  generation: number;
  status: InvitationStatus;
  claim_deadline: string;
  admission_expires_at: string;
  claimed_count: number;
  token_fingerprint: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** public.claim_invitation(): the guest's session, the card, and when it stops working. */
export interface ClaimedInvitation {
  guest_session: string;
  admission_credential: string;
  event_title: string;
  slot: number;
  claim_limit: ClaimLimit;
  claim_deadline: string;
  admission_expires_at: string;
}

/** public.my_claimed_card(): the guest's own card, read with the guest's own session. */
export interface GuestCard {
  event_title: string;
  display_name: string;
  slot: number;
  status: AdmissionState;
  expires_at: string;
  admission_credential: string | null;
}

/** public.host_scanner_grants(): who may admit, on which device, until when. */
export interface ScannerGrant {
  grant_id: string;
  device_id: string;
  grantee_user_id: string;
  granted_by: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  version: number;
}

/** public.host_checkins(): the door's record, including the admissions queued while offline. */
export interface HostCheckin {
  checkin_id: string;
  display_name: string | null;
  result: AdmissionResult;
  mode: CheckinMode;
  device_id: string;
  occurred_at: string;
  created_at: string;
}

/** public.record_checkin(): what the door did with one scanned card. */
export interface CheckinOutcome {
  checkin_id: string;
  result: AdmissionResult;
  display_name: string | null;
  conflict: boolean;
  occurred_at: string;
}

/** The link a host shares. The token is in the path, so it is never stored in a query string. */
export function inviteLink(token: string): string {
  return `/invite/${token}`;
}

/** The claim limit in words, because "2" means a couple and "1" means a single guest. */
export function claimLimitCopy(limit: ClaimLimit): string {
  return limit === 2 ? "Two people (a couple's link)" : "One person";
}
