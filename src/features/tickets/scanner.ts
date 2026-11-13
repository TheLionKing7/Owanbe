/**
 * F-108 scanner rules. The door device keeps a cache of the admission minimum for one guest list:
 * a card's name, its state and its expiry, and the hash the card is matched by. No phone number,
 * no address, no other guest's details.
 *
 * The rules live here, away from any screen, so the phone app and the tests reason about the same
 * thing: what a scanned card means when the device cannot reach the platform.
 */

export interface CachedAdmission {
  credential_hash: string;
  display_name: string;
  status: "issued" | "admitted" | "revoked";
  expires_at: string;
  cache_expires_at: string;
}

export type OfflineOutcome = "admitted" | "duplicate" | "expired" | "unknown";

export interface OfflineVerdict {
  outcome: OfflineOutcome;
  /** The guest's name, when the card is one the device knows. Never a contact detail. */
  name: string | null;
}

const CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;

/** A card's credential is a 64 character hex string; anything else is not a card. */
export function isCredentialShape(value: string): boolean {
  return CREDENTIAL_PATTERN.test(value.trim());
}

/** The platform hashes the card before it stores it, so the device hashes it the same way. */
export async function hashCredential(
  credential: string,
  sha256: (value: string) => Promise<string>,
): Promise<string | null> {
  const trimmed = credential.trim();
  if (!isCredentialShape(trimmed)) return null;
  return (await sha256(trimmed)).trim().toLowerCase();
}

/**
 * What a scanned card means when the device is offline. The cache is the whole truth then: a card
 * it does not know is unknown, a card past its expiry is expired, a card already admitted here is
 * a duplicate, and anything else is admitted.
 */
export function verifyAgainstCache(
  cache: readonly CachedAdmission[],
  credentialHash: string,
  now: Date = new Date(),
): OfflineVerdict {
  const entry = cache.find((row) => row.credential_hash === credentialHash);
  if (!entry) return { outcome: "unknown", name: null };
  if (entry.status === "revoked") return { outcome: "unknown", name: null };
  if (new Date(entry.expires_at).getTime() <= now.getTime()) {
    return { outcome: "expired", name: entry.display_name };
  }
  if (entry.status === "admitted") return { outcome: "duplicate", name: entry.display_name };
  return { outcome: "admitted", name: entry.display_name };
}

/** The cache is stale once the grant behind it has expired; the device must ask again. */
export function cacheIsStale(cache: readonly CachedAdmission[], now: Date = new Date()): boolean {
  if (cache.length === 0) return true;
  return cache.some((row) => new Date(row.cache_expires_at).getTime() <= now.getTime());
}

/** A check-in the device recorded while it could not reach the platform. */
export interface QueuedCheckin {
  credential: string;
  occurred_at: string;
}

/**
 * The queue is append-only and bounded: a device that cannot reach the platform for a long time
 * must not grow without limit, and the oldest waiting entry is the one dropped.
 */
export const MAX_QUEUED_CHECKINS = 500;

export function queueCheckin(
  queue: readonly QueuedCheckin[],
  entry: QueuedCheckin,
): QueuedCheckin[] {
  const next = [...queue, entry];
  return next.length > MAX_QUEUED_CHECKINS ? next.slice(next.length - MAX_QUEUED_CHECKINS) : next;
}

/**
 * What the platform answered for a queued check-in. The server cannot undo a duplicate it finds,
 * so the door is told what the record now says.
 */
export function reconcileQueuedCheckin(
  entry: QueuedCheckin,
  outcome: { result: string; display_name?: string | null },
): OfflineVerdict {
  const result = outcome.result;
  if (result === "admitted") return { outcome: "admitted", name: outcome.display_name ?? null };
  if (result === "duplicate") return { outcome: "duplicate", name: outcome.display_name ?? null };
  if (result === "expired") return { outcome: "expired", name: outcome.display_name ?? null };
  return { outcome: "unknown", name: null };
}
