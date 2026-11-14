/**
 * The guest's own card on this device. Only the session is kept: the platform can rebuild the
 * card from it, and the credential itself never has to be stored twice.
 */
import { clearSecret, readSecret, writeSecret } from "../secure";

const SESSION_KEY = "owanbe.guest.session";

export async function saveGuestSession(session: string): Promise<void> {
  await writeSecret(SESSION_KEY, session);
}

export async function loadGuestSession(): Promise<string | null> {
  return readSecret(SESSION_KEY);
}

export async function clearGuestSession(): Promise<void> {
  await clearSecret(SESSION_KEY);
}
