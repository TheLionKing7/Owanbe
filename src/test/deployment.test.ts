import { describe, expect, it } from "vitest";
import { checkEnvIsolation, missingServerEnv } from "@/config/server-env";
import { paystackSignature, verifyPaystackSignature } from "@/lib/payments/paystack.server";

describe("F-79 environment isolation", () => {
  it("staging may not use live Paystack keys", () => {
    expect(checkEnvIsolation({ APP_ENV: "staging", PAYSTACK_SECRET_KEY: "sk_live_x", PAYSTACK_PUBLIC_KEY: "pk_test_x" })).toContain(
      "staging must not use a live Paystack secret key",
    );
  });
  it("production must use live Paystack keys", () => {
    expect(checkEnvIsolation({ APP_ENV: "production", PAYSTACK_SECRET_KEY: "sk_test_x", PAYSTACK_PUBLIC_KEY: "pk_live_x" })).toEqual([
      "production must use a live Paystack secret key",
    ]);
  });
  it("lists missing required settings", () => {
    expect(missingServerEnv({ APP_ENV: "development" })).toContain("PAYSTACK_SECRET_KEY");
    expect(missingServerEnv({ APP_ENV: "development" })).not.toContain("STRIPE_SECRET_KEY");
  });
});

describe("Paystack webhook signature", () => {
  it("accepts the correct HMAC-SHA512 signature and rejects others", async () => {
    const body = '{"event":"charge.success"}';
    const sig = await paystackSignature(body, "sk_test_abc");
    expect(await verifyPaystackSignature(body, sig, "sk_test_abc")).toBe(true);
    expect(await verifyPaystackSignature(body, sig, "sk_test_other")).toBe(false);
    expect(await verifyPaystackSignature(body + " ", sig, "sk_test_abc")).toBe(false);
    expect(await verifyPaystackSignature(body, null, "sk_test_abc")).toBe(false);
  });
});
