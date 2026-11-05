/**
 * F-60 payment data protection: keeps raw card and bank credentials out of Ówàńbè storage, logs
 * and diagnostics. The partner holds the card details; we keep partner references only. The same
 * rules are enforced in the database by
 * supabase/migrations/20261105120000_f60_payment_data_protection.sql — change both or neither.
 *
 * Two shapes are refused: a card number (12-19 digits that pass Luhn, or four groups of four) and a
 * bank account quoted next to the word that means "pay this". Random digit strings — timestamps,
 * epoch milliseconds, uuid hex — are deliberately not refused, so a legitimate audit write cannot
 * be aborted by an unrelated number. Partner tokens (access_code, card_token, reference) are not
 * credentials and stay legal.
 *
 * This moves no money and authorises nothing — the router itself is F-48.
 */

/** Credential vocabulary that must never appear as a key at any depth of a stored or logged object. */
const CREDENTIAL_KEY_PATTERN =
  /(?:^|[^a-z0-9])(pan|card_?[a-z0-9]*number|card_?no|card_?pan|cvv|cvc|cid|expiry|expire_?[a-z0-9]+|exp_?date|account_?number|bank_?account|bank_?code|sort_?code|routing_?number|iban|bvn|nin|ssn|pin|password|secret_?key|api_?key)(?:$|[^a-z0-9])/;

/** 12 is the shortest issuer-prefix pair that still identifies a card; 19 is the ISO 7812 max. */
const PAN_DIGIT_MIN = 12;
const PAN_DIGIT_MAX = 19;

/** Numbers grouped the way a card is printed: 4-4-4-4. No Luhn needed for this shape. */
const GROUPED_CARD = /\d{4}[ .-]\d{4}[ .-]\d{4}[ .-]\d{4}/;

/** One number as a human would type it. ':' and '/' are not card separators, so timestamps survive. */
const DIGIT_RUN = /\d[\d .-]{10,}\d/g;

/** A bank account quoted as one. */
const ACCOUNT_QUOTED = /(?:account|acct|transfer to|beneficiary)[^0-9]{0,24}(\d{7,18})/i;

const REDACTION = "[redacted payment credential]";

/** Stand-in for any field whose name is itself credential vocabulary. */
export const REDACTED_FIELD = REDACTION;

/** The checksum every real card number satisfies. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Runs that must be masked before a string reaches a log. */
function credentialRuns(value: string): string[] {
  const runs = new Set<string>();
  for (const run of value.match(DIGIT_RUN) ?? []) {
    const digits = run.replace(/\D/g, "");
    if (digits.length < PAN_DIGIT_MIN || digits.length > PAN_DIGIT_MAX) continue;
    if (luhnValid(digits) || GROUPED_CARD.test(run)) runs.add(run);
  }
  const quoted = value.match(ACCOUNT_QUOTED);
  if (quoted?.[1]) runs.add(quoted[1]);
  return [...runs];
}

/** True when the text contains anything that must not be stored or logged. */
export function looksLikePaymentCredential(value: string): boolean {
  if (!value) return false;
  return ACCOUNT_QUOTED.test(value) || credentialRuns(value).length > 0;
}

/** True when an object, at any depth, uses a credential key name or carries a credential value. */
export function objectCarriesPaymentCredential(value: unknown): boolean {
  if (typeof value === "string") return looksLikePaymentCredential(value);
  if (typeof value === "number") return looksLikePaymentCredential(String(value));
  if (Array.isArray(value)) return value.some((item) => objectCarriesPaymentCredential(item));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY_PATTERN.test(key.toLowerCase())) return true;
      if (objectCarriesPaymentCredential(item)) return true;
    }
  }
  return false;
}

/** Replace credential-shaped values so a stray one cannot survive into a log line. */
export function redactPaymentCredentials(value: string): string {
  let redacted = value;
  for (const run of credentialRuns(value)) redacted = redacted.split(run).join(REDACTION);
  return redacted;
}

/**
 * Walk one log argument and mask credentials by shape and by key name. Errors are described by the
 * caller first, so their stack text arrives here as a string.
 */
export function sanitizeForLog(value: unknown): unknown {
  if (typeof value === "string") return redactPaymentCredentials(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = CREDENTIAL_KEY_PATTERN.test(key.toLowerCase())
        ? REDACTION
        : sanitizeForLog(item);
    }
    return redacted;
  }
  return value;
}

/** Thrown instead of writing or logging a credential-shaped value. */
export class PaymentCredentialRejected extends Error {
  override name = "PaymentCredentialRejected";

  constructor(readonly field: string) {
    super(`payment_credential_rejected: ${field}`);
  }
}

/** Refuse a single field — a payment reference, an alert body, anything free text. */
export function assertFreeOfPaymentCredentials(field: string, value: unknown): void {
  const offending =
    typeof value === "string" && looksLikePaymentCredential(value)
      ? true
      : objectCarriesPaymentCredential(value);
  if (offending) throw new PaymentCredentialRejected(field);
}

/**
 * A provider event name is the only part of a signed body this app repeats. Anything that is not a
 * bare identifier is dropped rather than logged.
 */
export function safeEventName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9_.]{0,63}$/.test(name)) return "unknown";
  return looksLikePaymentCredential(name) ? "unknown" : name;
}
