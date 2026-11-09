import { describe, expect, it } from "vitest";
import { CURRENCY_MINOR_UNITS, formatMoney, minorUnitsFor, toMajorUnits } from "./currency";

describe("minorUnitsFor", () => {
  it("knows the minor unit of every currency the platform accepts", () => {
    expect(minorUnitsFor("NGN")).toBe(2);
    expect(minorUnitsFor("GBP")).toBe(2);
    expect(minorUnitsFor("JPY")).toBe(0);
    expect(minorUnitsFor("XOF")).toBe(0);
    expect(minorUnitsFor("BHD")).toBe(3);
  });

  it("reads a currency in any case and with stray spaces", () => {
    expect(minorUnitsFor("ngn")).toBe(2);
    expect(minorUnitsFor("  Ghs ")).toBe(2);
  });

  it("refuses a currency it does not know", () => {
    expect(minorUnitsFor("XYZ")).toBeNull();
    expect(minorUnitsFor("")).toBeNull();
  });

  it("does not read a prototype property as a currency", () => {
    expect(minorUnitsFor("constructor")).toBeNull();
    expect(minorUnitsFor("toString")).toBeNull();
  });

  it("holds every currency it names", () => {
    for (const [code, units] of Object.entries(CURRENCY_MINOR_UNITS)) {
      expect(minorUnitsFor(code)).toBe(units);
    }
  });
});

describe("toMajorUnits", () => {
  it("scales by the currency's own power of ten", () => {
    expect(toMajorUnits(100000, "NGN")).toBe(1000);
    expect(toMajorUnits(1000, "JPY")).toBe(1000);
    expect(toMajorUnits(1000, "BHD")).toBe(1);
  });

  it("returns null for a currency it does not know rather than a wrong number", () => {
    expect(toMajorUnits(1000, "XYZ")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("writes the amount a person reads", () => {
    const naira = formatMoney(100000, "NGN");
    expect(naira).toContain("1,000");
    expect(naira).toContain("₦");
  });

  it("keeps a zero-decimal currency whole", () => {
    expect(formatMoney(1000, "JPY")).toContain("1,000");
  });

  it("falls back to the raw amount for a currency it does not know", () => {
    expect(formatMoney(250, "XYZ")).toBe("250 XYZ");
  });
});
