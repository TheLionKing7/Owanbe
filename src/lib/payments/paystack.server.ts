/**
 * Paystack webhook verification (F-79 wiring). Paystack signs the raw request body with
 * HMAC-SHA512 using the secret key and sends it in the `x-paystack-signature` header.
 * Uses Web Crypto so it runs on the edge runtime.
 */
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function paystackSignature(rawBody: string, secretKey: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secretKey), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
}

export async function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string | undefined): Promise<boolean> {
  if (!signature || !secretKey) return false;
  const expected = await paystackSignature(rawBody, secretKey);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
