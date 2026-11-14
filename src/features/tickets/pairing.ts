/**
 * F-108 pairing. A host hands a door device to a named person; the device needs the grant, the
 * device name the grant is bound to, and the moment the grant ends. That is all the pairing code
 * carries, and it is the same code on the web and on the phone.
 */

export interface PairingPayload {
  grant_id: string;
  device_id: string;
  expires_at: string;
}

export const PAIRING_PREFIX = "owanbe://pair";

const GRANT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The code the host copies for the person at the door. */
export function pairingCode(payload: PairingPayload): string {
  const grant = encodeURIComponent(payload.grant_id);
  const device = encodeURIComponent(payload.device_id);
  const expires = encodeURIComponent(payload.expires_at);
  return `${PAIRING_PREFIX}?grant=${grant}&device=${device}&expires=${expires}`;
}

/** What the door device reads off the code. Anything else is not a pairing code. */
export function parsePairingCode(value: string): PairingPayload | null {
  const text = value.trim();
  if (!text.startsWith(PAIRING_PREFIX)) return null;
  const query = text.slice(text.indexOf("?") + 1);
  const parts = new Map<string, string>();
  try {
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index < 0) continue;
      parts.set(
        decodeURIComponent(pair.slice(0, index)),
        decodeURIComponent(pair.slice(index + 1)),
      );
    }
  } catch {
    return null;
  }
  const grant_id = parts.get("grant");
  const device_id = parts.get("device");
  const expires_at = parts.get("expires");
  if (!grant_id || !device_id || !expires_at) return null;
  if (!GRANT_PATTERN.test(grant_id)) return null;
  if (device_id.length > 120) return null;
  return { grant_id, device_id, expires_at };
}
