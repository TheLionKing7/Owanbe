/**
 * What the door does with a card. The rules are the ones the web app and the tests already use:
 * the platform decides when it can be reached, and the cache decides when it cannot.
 */
import * as Crypto from "expo-crypto";
import {
  hashCredential,
  queueCheckin,
  reconcileQueuedCheckin,
  verifyAgainstCache,
  type OfflineVerdict,
  type QueuedCheckin,
  type ScannerCache,
} from "../../../src/features/tickets/scanner";

export interface CheckinOutcome {
  result: string;
  display_name?: string | null;
}

export async function sha256Hex(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export interface AdmitResult {
  verdict: OfflineVerdict;
  /** True when the card was admitted from the cache and is waiting to be sent to the platform. */
  queued: boolean;
  queue: QueuedCheckin[];
}

/**
 * A card is admitted against the platform when the platform can be reached, and against the
 * cache when it cannot. An offline admission is kept in the queue and sent when the device is
 * back online, so the host still sees who came in.
 *
 * The cache is only good while it came from the platform and the door window behind it is open.
 * A door that has never synced, or whose window has closed, is told to sync instead of admitting.
 */
export async function admitCard(input: {
  credential: string;
  cache: ScannerCache;
  queue: readonly QueuedCheckin[];
  online: (credential: string) => Promise<CheckinOutcome>;
  now?: Date;
}): Promise<AdmitResult> {
  const now = input.now ?? new Date();
  const hash = await hashCredential(input.credential, sha256Hex);
  if (!hash)
    return { verdict: { outcome: "unknown", name: null }, queued: false, queue: [...input.queue] };

  const occurred_at = now.toISOString();
  try {
    const outcome = await input.online(input.credential);
    return {
      verdict: reconcileQueuedCheckin({ credential: input.credential, occurred_at }, outcome),
      queued: false,
      queue: [...input.queue],
    };
  } catch (caught) {
    if (!isOffline(caught)) throw caught;
  }

  const verdict = verifyAgainstCache(input.cache, hash, now);
  if (verdict.outcome !== "admitted") {
    return { verdict, queued: false, queue: [...input.queue] };
  }
  const queue = queueCheckin(input.queue, { credential: input.credential, occurred_at });
  return { verdict, queued: true, queue };
}

/**
 * The queue is sent to the platform one entry at a time. What comes back is what the record says
 * now, because the platform cannot undo a duplicate it finds.
 */
export async function flushQueue(input: {
  queue: readonly QueuedCheckin[];
  online: (credential: string, occurredAt: string) => Promise<CheckinOutcome>;
}): Promise<{ remaining: QueuedCheckin[]; verdicts: OfflineVerdict[] }> {
  const remaining: QueuedCheckin[] = [];
  const verdicts: OfflineVerdict[] = [];
  for (const entry of input.queue) {
    try {
      const outcome = await input.online(entry.credential, entry.occurred_at);
      verdicts.push(reconcileQueuedCheckin(entry, outcome));
    } catch (caught) {
      if (!isOffline(caught)) throw caught;
      remaining.push(entry);
    }
  }
  return { remaining, verdicts };
}

/** Only a lost connection means "try again later"; anything else is the platform's refusal. */
export function isOffline(caught: unknown): boolean {
  if (caught instanceof Error && caught.message === "no_connection") return true;
  return caught instanceof TypeError;
}
