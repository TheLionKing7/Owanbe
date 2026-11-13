/**
 * The door device's memory. The pairing, the cache of the admission minimum and the queue of
 * check-ins taken while offline all live in the device's locked drawer: a door phone that is lost
 * does not hand out a guest list.
 */
import type { PairingPayload } from "../../../src/features/tickets/pairing";
import {
  emptyScannerCache,
  type CachedAdmission,
  type QueuedCheckin,
  type ScannerCache,
} from "../../../src/features/tickets/scanner";
import { clearSecret, readSecret, writeSecret } from "../secure";

const PAIRING_KEY = "owanbe.door.pairing";
const CACHE_KEY = "owanbe.door.cache";
const QUEUE_KEY = "owanbe.door.queue";

export interface Pairing extends PairingPayload {
  saved_at: string;
}

export async function savePairing(pairing: PairingPayload): Promise<Pairing> {
  const saved: Pairing = { ...pairing, saved_at: new Date().toISOString() };
  await writeSecret(PAIRING_KEY, JSON.stringify(saved));
  return saved;
}

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await readSecret(PAIRING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Pairing;
    if (!parsed.grant_id || !parsed.device_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPairing(): Promise<void> {
  await clearSecret(PAIRING_KEY);
}

export async function saveCache(cache: ScannerCache): Promise<void> {
  await writeSecret(CACHE_KEY, JSON.stringify(cache));
}

export async function loadCache(): Promise<ScannerCache> {
  const raw = await readSecret(CACHE_KEY);
  if (!raw) return emptyScannerCache();
  try {
    const parsed = JSON.parse(raw) as ScannerCache | CachedAdmission[];
    // A cache saved before the device kept track of its sync is treated as never synced, so the
    // door has to reach the platform before it may admit anyone from it.
    if (Array.isArray(parsed)) return { entries: parsed, synced_at: null };
    if (!parsed || !Array.isArray(parsed.entries)) return emptyScannerCache();
    return { entries: parsed.entries, synced_at: parsed.synced_at ?? null };
  } catch {
    return emptyScannerCache();
  }
}

export async function saveQueue(queue: readonly QueuedCheckin[]): Promise<void> {
  await writeSecret(QUEUE_KEY, JSON.stringify(queue));
}

export async function loadQueue(): Promise<QueuedCheckin[]> {
  const raw = await readSecret(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueuedCheckin[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
