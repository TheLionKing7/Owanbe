import { describe, expect, it } from "vitest";
import { safeAuthorization } from "./paystack.server";

describe("safeAuthorization", () => {
  it("keeps only the reference and display fields", () => {
    const out = safeAuthorization({ authorization_code: "AUTH_abc123", last4: "4081", bin: "408408", brand: "visa", exp_month: "12", exp_year: "2030", reusable: true });
    expect(out).toEqual({ authorizationCode: "AUTH_abc123", cardBrand: "visa", last4: "4081", expMonth: "12", expYear: "2030", reusable: true });
    expect(JSON.stringify(out)).not.toContain("408408");
  });
  it("rejects anything that is not a Paystack reference", () => {
    expect(safeAuthorization({ authorization_code: "4084084084084081" })).toBeNull();
  });
});
