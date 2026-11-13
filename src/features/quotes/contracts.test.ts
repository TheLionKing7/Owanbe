import { describe, expect, it } from "vitest";
import {
  actionsFor,
  counterDeadlineLabel,
  countdownFrom,
  currencySchema,
  dailyCapacitySchema,
  formatMinor,
  fromMinor,
  isOpen,
  newQuoteSchema,
  quoteLineSchema,
  quoteLinesSchema,
  quoteTotal,
  QUOTE_EXPIRY_HOURS,
  serviceDateSchema,
  sumLines,
  toMinor,
} from "./contracts";

const VENDOR = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const HOST = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

describe("quote money rules", () => {
  it("keeps arithmetic in integer minor units", () => {
    expect(
      sumLines([
        { label: "Venue", line_total_minor: 100_000 },
        { label: "Service", line_total_minor: 25_500 },
      ]),
    ).toBe(125_500);
    expect(
      quoteTotal(
        [{ label: "Venue", line_total_minor: 150_000 }],
        [{ label: "Extra hour", line_total_minor: 25_000 }],
      ),
    ).toBe(175_000);
  });

  it("round-trips an amount through the input field", () => {
    expect(toMinor("1750.00", "NGN")).toBe(175_000);
    expect(fromMinor(175_000, "NGN")).toBe("1750.00");
    expect(toMinor("", "NGN")).toBeNull();
    expect(toMinor("-5", "NGN")).toBeNull();
    expect(toMinor("abc", "NGN")).toBeNull();
  });

  it("uses the currency's own exponent", () => {
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(fromMinor(1500, "JPY")).toBe("1500");
  });

  it("formats a total for display without changing it", () => {
    expect(formatMinor(175_000, "NGN")).toMatch(/1,?750\.00/);
    expect(QUOTE_EXPIRY_HOURS).toBe(24);
  });
});

describe("quote input boundaries", () => {
  it("rejects a line without a name or with a fractional amount", () => {
    expect(quoteLineSchema.safeParse({ label: "  ", line_total_minor: 100 }).success).toBe(false);
    expect(
      quoteLineSchema.safeParse({ label: "x".repeat(121), line_total_minor: 100 }).success,
    ).toBe(false);
    expect(quoteLineSchema.safeParse({ label: "Venue", line_total_minor: -1 }).success).toBe(false);
    expect(quoteLineSchema.safeParse({ label: "Venue", line_total_minor: 10.5 }).success).toBe(
      false,
    );
    expect(quoteLineSchema.safeParse({ label: "Venue", line_total_minor: 100 }).success).toBe(true);
  });

  it("caps the number of lines", () => {
    const lines = Array.from({ length: 101 }, (_, index) => ({
      label: `Line ${index}`,
      line_total_minor: 100,
    }));
    expect(quoteLinesSchema.safeParse(lines).success).toBe(false);
    expect(quoteLinesSchema.safeParse(lines.slice(0, 100)).success).toBe(true);
  });

  it("normalises the currency and refuses anything else", () => {
    expect(currencySchema.parse(" ngn ")).toBe("NGN");
    expect(currencySchema.safeParse("NG").success).toBe(false);
    expect(currencySchema.safeParse("NAIRA").success).toBe(false);
  });

  it("requires an ISO celebration date", () => {
    expect(serviceDateSchema.parse("2026-12-05")).toBe("2026-12-05");
    expect(serviceDateSchema.safeParse("05/12/2026").success).toBe(false);
    expect(serviceDateSchema.safeParse("").success).toBe(false);
  });

  it("validates a whole new quote", () => {
    const input = {
      vendor_house_id: VENDOR,
      host_house_id: HOST,
      service_date: "2026-12-05",
      currency: "NGN",
      title: "Wedding reception",
      inclusions: [{ label: "Venue", line_total_minor: 150_000 }],
      extras: [],
    };
    expect(newQuoteSchema.safeParse(input).success).toBe(true);
    expect(newQuoteSchema.safeParse({ ...input, vendor_house_id: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(dailyCapacitySchema.safeParse(0).success).toBe(false);
    expect(dailyCapacitySchema.safeParse(101).success).toBe(false);
    expect(dailyCapacitySchema.safeParse(2).success).toBe(true);
  });
});

describe("who may act on a quote", () => {
  it("offers the vendor send, revise and withdraw", () => {
    expect(actionsFor("draft", "vendor")).toMatchObject({
      send: true,
      revise: true,
      cancel: true,
      accept: false,
    });
    expect(actionsFor("countered", "vendor")).toMatchObject({
      send: true,
      revise: true,
      cancel: true,
      accept: false,
    });
    expect(actionsFor("sent", "vendor")).toEqual({
      send: false,
      revise: false,
      cancel: true,
      accept: false,
      decline: false,
      counter: false,
    });
  });

  it("offers the host accept, decline and counter only while the quote is open", () => {
    for (const status of ["sent", "countered"] as const) {
      expect(actionsFor(status, "host")).toMatchObject({
        accept: true,
        decline: true,
        counter: true,
        send: false,
      });
    }
    for (const status of ["draft", "accepted", "declined", "expired", "cancelled"] as const) {
      expect(actionsFor(status, "host")).toEqual({
        send: false,
        revise: false,
        cancel: false,
        accept: false,
        decline: false,
        counter: false,
      });
    }
  });

  it("treats a finished quote as closed", () => {
    expect(isOpen("sent")).toBe(true);
    expect(isOpen("accepted")).toBe(false);
  });
});

describe("the deadline the server set", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("describes the time left from the server deadline", () => {
    const countdown = countdownFrom("2026-11-05T12:00:00.000Z", now);
    expect(countdown).toMatchObject({ expired: false, hours: 24, minutes: 0 });
    expect(countdown?.label).toBe("24h 0m left to respond");
  });

  it("drops to minutes under an hour", () => {
    expect(countdownFrom("2026-11-04T12:45:00.000Z", now)?.label).toBe("45m left to respond");
  });

  it("reports an expired offer without starting a timer of its own", () => {
    expect(countdownFrom("2026-11-04T11:59:59.000Z", now)).toMatchObject({
      expired: true,
      remainingMs: 0,
    });
  });

  it("has nothing to count down before a quote is sent", () => {
    expect(countdownFrom(null, now)).toBeNull();
    expect(countdownFrom("not-a-date", now)).toBeNull();
  });
});

describe("the counter's vendor deadline", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("tells the vendor the window is theirs and the host how long the vendor has", () => {
    const countdown = countdownFrom("2026-11-05T12:00:00.000Z", now);
    expect(counterDeadlineLabel("vendor", countdown!)).toBe(
      "You have 24h 0m to respond. After that the offer expires and the date is released.",
    );
    expect(counterDeadlineLabel("host", countdown!)).toBe(
      "The vendor has 24h 0m to respond. After that the offer expires and the date is released.",
    );
  });

  it("says so plainly once the window has closed", () => {
    const countdown = countdownFrom("2026-11-04T11:59:59.000Z", now);
    expect(counterDeadlineLabel("host", countdown!)).toBe(
      "The vendor's time to respond has run out",
    );
    expect(counterDeadlineLabel("vendor", countdown!)).toBe("Your time to respond has run out");
  });
});
