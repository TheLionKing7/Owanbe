import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_UNKNOWN_LABEL,
  PRICE_UNKNOWN_LABEL,
  budgetFitFor,
  groundPlan,
  parsePriceNote,
  planSummaryForLog,
  priceLabelFor,
  scrubPlanText,
  type PlannerInput,
  type RawPlan,
  type VendorFact,
} from "./contracts";

const INPUT: PlannerInput = {
  event_type: "Wedding",
  city: "Lagos",
  guest_count: 150,
  budget_minor: 5_000_000_00,
  budget_currency: "NGN",
  brief: "A traditional wedding with a small band.",
};

const FACT: VendorFact = {
  slug: "adeola-cakes",
  business_name: "Adeola Cakes",
  category: "Cakes",
  locations: "Lagos",
  price_note: "Packages from ₦500,000",
  services: ["Wedding cake"],
  highlights: ["Bespoke designs"],
};

function rawPlan(overrides: Partial<RawPlan> = {}): RawPlan {
  return {
    summary: "Two ways to do the day.",
    options: [
      {
        title: "The intimate plan",
        summary: "A smaller afternoon celebration with a band.",
        vendor_slugs: ["adeola-cakes", "ghost-vendor"],
        steps: [{ title: "Book the hall", detail: "Confirm the afternoon slot with the venue." }],
      },
    ],
    ...overrides,
  };
}

describe("parsePriceNote", () => {
  it("reads the amount in a vendor's own note", () => {
    expect(parsePriceNote("Packages from ₦500,000")).toEqual({
      amount_minor: 50_000_000,
      currency: "NGN",
    });
  });

  it("reads a shortened amount", () => {
    expect(parsePriceNote("From ₦1.2m")).toEqual({ amount_minor: 120_000_000, currency: "NGN" });
  });

  it("reads a price in another currency", () => {
    expect(parsePriceNote("From $2,500")).toEqual({ amount_minor: 250_000, currency: "USD" });
  });

  it("has no price to read when the vendor states none", () => {
    expect(parsePriceNote("Contact us for pricing")).toBeNull();
    expect(parsePriceNote("")).toBeNull();
  });

  it("will not read a price that is per guest", () => {
    expect(parsePriceNote("₦500,000 per guest")).toBeNull();
  });

  it("will not read a price written for another number of guests", () => {
    expect(parsePriceNote("₦500,000 for 200 guests", 150)).toBeNull();
    expect(parsePriceNote("₦500,000 for 200 guests", 200)?.amount_minor).toBe(50_000_000);
  });
});

describe("budgetFitFor", () => {
  it("says a price is within the budget", () => {
    expect(
      budgetFitFor({ amount_minor: 100, currency: "NGN" }, { ...INPUT, budget_minor: 200 }),
    ).toBe("within_budget");
  });

  it("says a price is above the budget", () => {
    expect(
      budgetFitFor({ amount_minor: 300, currency: "NGN" }, { ...INPUT, budget_minor: 200 }),
    ).toBe("above_budget");
  });

  it("does not guess when the currencies differ", () => {
    expect(budgetFitFor({ amount_minor: 100, currency: "USD" }, INPUT)).toBe("unknown");
  });

  it("does not guess when there is no price", () => {
    expect(budgetFitFor(null, INPUT)).toBe("unknown");
  });
});

describe("priceLabelFor", () => {
  it("shows the vendor's own words when they carry a price", () => {
    const result = priceLabelFor("Packages from ₦500,000", 150);
    expect(result.known).toBe(true);
    expect(result.label).toBe("Packages from ₦500,000");
  });

  it("labels an unknown price as unknown", () => {
    const result = priceLabelFor("Contact us for pricing", 150);
    expect(result.known).toBe(false);
    expect(result.label).toBe(PRICE_UNKNOWN_LABEL);
  });
});

describe("scrubPlanText", () => {
  it("removes a price the model invented", () => {
    expect(scrubPlanText("The venue starts from ₦500,000.")).toBe(
      "The venue starts a price to confirm.",
    );
  });

  it("removes a claim that a vendor is available", () => {
    expect(scrubPlanText("The hall is available on 12 December.")).toBe(
      "The hall may be available on 12 December.",
    );
  });

  it("leaves ordinary prose alone", () => {
    expect(scrubPlanText("Book the band early.")).toBe("Book the band early.");
  });
});

describe("groundPlan", () => {
  it("drops a vendor no published profile backs", () => {
    const plan = groundPlan(rawPlan(), [FACT], INPUT);
    expect(plan.options.at(0)?.vendors.map((vendor) => vendor.slug)).toEqual(["adeola-cakes"]);
    expect(plan.removed_vendors).toBe(1);
  });

  it("keeps the vendor's own name, price note and an unknown availability", () => {
    const plan = groundPlan(rawPlan(), [FACT], INPUT);
    const vendor = plan.options.at(0)?.vendors.at(0);
    expect(vendor?.business_name).toBe("Adeola Cakes");
    expect(vendor?.price_label).toBe("Packages from ₦500,000");
    expect(vendor?.price_known).toBe(true);
    expect(vendor?.availability_label).toBe(AVAILABILITY_UNKNOWN_LABEL);
    expect(vendor?.budget_fit).toBe("within_budget");
  });

  it("labels a price it cannot read as unknown", () => {
    const plan = groundPlan(rawPlan(), [{ ...FACT, price_note: "Price on request" }], INPUT);
    const vendor = plan.options.at(0)?.vendors.at(0);
    expect(vendor?.price_label).toBe(PRICE_UNKNOWN_LABEL);
    expect(vendor?.price_known).toBe(false);
    expect(vendor?.budget_fit).toBe("unknown");
    expect(plan.unknown_prices).toBe(1);
  });

  it("scrubs the model's prose", () => {
    const plan = groundPlan(
      rawPlan({
        options: [
          {
            title: "Under ₦500,000",
            summary: "The hall is available and costs ₦400,000.",
            vendor_slugs: ["adeola-cakes"],
            steps: [{ title: "Pay", detail: "Bring ₦400,000 on the day." }],
          },
        ],
      }),
      [FACT],
      INPUT,
    );
    expect(plan.options.at(0)?.title).toBe("Under a price to confirm");
    expect(plan.options.at(0)?.summary).toContain("may be available");
    expect(plan.options.at(0)?.summary).not.toContain("400,000");
    expect(plan.options.at(0)?.steps.at(0)?.detail).not.toContain("400,000");
  });

  it("keeps at most six options", () => {
    const options = Array.from({ length: 9 }, (_, index) => ({
      title: `Option ${index}`,
      summary: "A plan.",
      vendor_slugs: ["adeola-cakes"],
      steps: [],
    }));
    const plan = groundPlan(rawPlan({ options }), [FACT], INPUT);
    expect(plan.options).toHaveLength(6);
  });
});

describe("planSummaryForLog", () => {
  it("logs the titles, summaries and the vendors cited", () => {
    const plan = groundPlan(rawPlan(), [FACT], INPUT);
    expect(planSummaryForLog(plan)).toEqual([
      {
        title: "The intimate plan",
        summary: "A smaller afternoon celebration with a band.",
        vendor_slugs: ["adeola-cakes"],
      },
    ]);
  });
});
