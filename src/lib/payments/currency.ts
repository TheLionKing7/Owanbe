/**
 * Money is an integer number of minor units beside an ISO 4217 currency (F-102). This file is the
 * one place that knows how many minor units a currency has, so an amount is never scaled by the
 * wrong power of ten on its way to a provider or into a sentence a person reads.
 */

/** How many minor units one major unit has, for the currencies the platform accepts. */
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  AED: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
  GHS: 2,
  KES: 2,
  NGN: 2,
  USD: 2,
  ZAR: 2,
  JPY: 0,
  XOF: 0,
  BHD: 3,
  KWD: 3,
};

/** The minor-unit count of a currency, or null when the platform does not know the currency. */
export function minorUnitsFor(currency: string): number | null {
  const code = currency.trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, code)) return null;
  return CURRENCY_MINOR_UNITS[code] ?? null;
}

/** The amount a person reads, in major units. Null when the currency is unknown. */
export function toMajorUnits(amountMinor: number, currency: string): number | null {
  const units = minorUnitsFor(currency);
  if (units === null) return null;
  return amountMinor / 10 ** units;
}

/** The amount in the currency's minor unit, from an amount in major units. Null when unknown. */
export function toMinorUnits(amountMajor: number, currency: string): number | null {
  const units = minorUnitsFor(currency);
  if (units === null) return null;
  return Math.round(amountMajor * 10 ** units);
}

/** The amount a person reads, in the currency's own sign. */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const major = toMajorUnits(amountMinor, code);
  if (major === null) return `${amountMinor} ${code}`;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: code,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${code}`;
  }
}
