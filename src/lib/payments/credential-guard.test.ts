import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFreeOfPaymentCredentials,
  looksLikePaymentCredential,
  luhnValid,
  objectCarriesPaymentCredential,
  PaymentCredentialRejected,
  redactPaymentCredentials,
  safeEventName,
  sanitizeForLog,
} from "./credential-guard";

describe("credential shapes that must never be stored", () => {
  // The published test card, not a real account: if this is refused, no PAN passes.
  it.each([
    "4242424242424242",
    "4242 4242 4242 4242",
    "4242-4242-4242-4242",
    "5555 5555 5555 4444",
    "reference 378282246310005 for this booking",
  ])("refuses %s", (value) => {
    expect(looksLikePaymentCredential(value)).toBe(true);
  });

  it.each([
    "119951394_df38b17d-4c55-4b98-a4a4-0f9d4b1c8f2a",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "2026-12-05T09:00:00.000Z",
    "ps_参考_9",
    "175000",
    "auth0|f38-viki",
    // Numbers that are merely long. Refusing these would abort somebody's legitimate audit write.
    "1730000000000",
    "invoice 20261105120000",
    "2026-11-05 09:00:00.000",
    "",
  ])("accepts the partner-shaped %s", (value) => {
    expect(looksLikePaymentCredential(value)).toBe(false);
  });

  it("checks the card checksum, not the digit count", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242424242424243")).toBe(false);
    expect(luhnValid("4242 4242 4242 4242")).toBe(false);
    // Four groups of four are refused even when the checksum fails.
    expect(looksLikePaymentCredential("1234 5678 9012 3456")).toBe(true);
    expect(looksLikePaymentCredential("1234 5678 9012 3457")).toBe(true);
  });

  it("refuses a bank account quoted as one", () => {
    expect(looksLikePaymentCredential("transfer to 0123456789")).toBe(true);
    expect(looksLikePaymentCredential("account 1234567890")).toBe(true);
    expect(looksLikePaymentCredential("counterparty_house 1234567890")).toBe(false);
  });
});

describe("objects headed for jsonb or a log line", () => {
  it("refuses a credential key at any depth", () => {
    expect(objectCarriesPaymentCredential({ quote: { card_number: "x" } })).toBe(true);
    expect(objectCarriesPaymentCredential({ lines: [{ CVV: "123" }] })).toBe(true);
    expect(objectCarriesPaymentCredential({ nested: { bvn: "12345678901" } })).toBe(true);
  });

  it("allows the partner tokens we are meant to keep", () => {
    expect(
      objectCarriesPaymentCredential({
        reference: "119951394_df38b17d",
        access_code: "YmxhY2tldA",
        card_token: "T_2k9s1nb8t8",
        authorization_url: "https://checkout.paystack.com/abc",
        invoice_status: "paid",
      }),
    ).toBe(false);
  });

  it("refuses a credential value hiding under a harmless key", () => {
    expect(objectCarriesPaymentCredential({ note: "card is 4242 4242 4242 4242" })).toBe(true);
  });

  it("masks rather than dropping the rest of the line", () => {
    const redacted = redactPaymentCredentials(
      "charge failed for 4242 4242 4242 4242 after 2 attempts (ref 119951394_x)",
    );
    expect(redacted).toContain("[redacted payment credential]");
    expect(redacted).not.toContain("4242");
    expect(redacted).toContain("ref 119951394_x");
  });

  it("masks credential keys inside a logged object", () => {
    expect(sanitizeForLog({ pan: "4111111111111111", house: "h-1" })).toEqual({
      pan: "[redacted payment credential]",
      house: "h-1",
    });
  });

  it("throws with the offending field and nothing else", () => {
    const error = () => assertFreeOfPaymentCredentials("payment_reference", "4242424242424242");
    expect(error).toThrow(PaymentCredentialRejected);
    expect(error).toThrow(/^payment_credential_rejected: payment_reference$/);
    expect(() =>
      assertFreeOfPaymentCredentials("payment_reference", "119951394_df38"),
    ).not.toThrow();
  });
});

describe("the only provider field this app repeats", () => {
  it.each([
    ["charge.success", "charge.success"],
    ["  charge.success  ", "charge.success"],
    ["assignment", "assignment"],
  ])("keeps %s as %s", (input, expected) => {
    expect(safeEventName(input)).toBe(expected);
  });

  it.each([
    "charge.success?pan=4242424242424242",
    "a".repeat(200),
    "not an identifier",
    "4242424242424242",
    "",
    undefined,
    null,
    42,
  ])("replaces %s with unknown", (input) => {
    expect(safeEventName(input)).toBe("unknown");
  });
});

describe("proof of absence", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");

  it("no migration declares a credential column", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(join(migrationsDir, file), "utf8").toLowerCase();
      for (const block of sql.split("create table").slice(1)) {
        const columns = block.split(");")[0] ?? "";
        for (const line of columns.split("\n")) {
          const name = line.match(
            /^\s{2}([a-z_][a-z0-9_]*)\s+(text|bigint|integer|boolean|numeric|uuid|jsonb|timestamptz|date)\b/,
          );
          const column = name?.[1];
          if (column && CREDENTIAL_COLUMN.test(column)) {
            offenders.push(`${file}: ${column}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

const CREDENTIAL_COLUMN =
  /^(pan|card_.*|cvv|cvc|cid|expiry|exp_.*|account_.*|bank_.*|iban|bvn|nin|ssn|pin|password|secret_.*|api_.*)$/;
