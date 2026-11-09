import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannerError, type PlannerApi } from "./api";
import { PlannerPanel } from "./PlannerPanel";
import { AVAILABILITY_UNKNOWN_LABEL, PLANNER_DISCLOSURE } from "./contracts";

const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";

function answer() {
  return {
    interaction_id: INTERACTION_ID,
    disclosure: PLANNER_DISCLOSURE,
    plan: {
      summary: "Two ways to do the day.",
      options: [
        {
          title: "The intimate plan",
          summary: "A smaller afternoon celebration with a band.",
          vendors: [
            {
              slug: "adeola-cakes",
              business_name: "Adeola Cakes",
              category: "Cakes",
              price_label: "Packages from ₦500,000",
              price_known: true,
              availability_label: AVAILABILITY_UNKNOWN_LABEL,
              budget_fit: "within_budget" as const,
            },
          ],
          steps: [{ title: "Book the hall", detail: "Confirm the afternoon slot." }],
        },
      ],
      removed_vendors: 1,
      unknown_prices: 0,
    },
    grounding: { removed_vendors: 1, unknown_prices: 0 },
  };
}

function stubApi(overrides: Partial<PlannerApi> = {}): PlannerApi {
  return {
    generate: vi.fn(async () => answer()),
    report: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fillForm() {
  fireEvent.change(screen.getByTestId("planner-event-type"), { target: { value: "Wedding" } });
  fireEvent.change(screen.getByTestId("planner-city"), { target: { value: "Lagos" } });
  fireEvent.change(screen.getByTestId("planner-guests"), { target: { value: "150" } });
  fireEvent.change(screen.getByTestId("planner-budget"), { target: { value: "500000" } });
  fireEvent.change(screen.getByTestId("planner-brief"), {
    target: { value: "A traditional wedding with a small band." },
  });
}

afterEach(cleanup);

describe("PlannerPanel", () => {
  it("labels itself as AI-generated before anything is asked", () => {
    render(<PlannerPanel api={stubApi()} />);
    expect(screen.getByText(PLANNER_DISCLOSURE)).toBeInTheDocument();
  });

  it("asks the planner with what the host told it", async () => {
    const api = stubApi();
    render(<PlannerPanel api={api} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));

    await waitFor(() => expect(api.generate).toHaveBeenCalled());
    expect(api.generate).toHaveBeenCalledWith({
      event_type: "Wedding",
      city: "Lagos",
      guest_count: 150,
      budget_minor: 50_000_000,
      budget_currency: "NGN",
      brief: "A traditional wedding with a small band.",
    });
  });

  it("will not ask the planner with an empty form", async () => {
    const api = stubApi();
    render(<PlannerPanel api={api} />);
    fireEvent.click(screen.getByTestId("planner-submit"));

    expect(await screen.findByTestId("planner-error")).toHaveTextContent("Tell us the celebration");
    expect(api.generate).not.toHaveBeenCalled();
  });

  it("shows the answer with the disclosure and the vendor's own price", async () => {
    render(<PlannerPanel api={stubApi()} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));

    expect(await screen.findByTestId("planner-result")).toBeInTheDocument();
    expect(screen.getByTestId("planner-disclosure")).toHaveTextContent(PLANNER_DISCLOSURE);
    expect(screen.getByText("The intimate plan")).toBeInTheDocument();
    expect(screen.getByText("Packages from ₦500,000")).toBeInTheDocument();
    expect(screen.getByText(AVAILABILITY_UNKNOWN_LABEL)).toBeInTheDocument();
    expect(screen.getByText("Within your budget")).toBeInTheDocument();
  });

  it("says what it left out", async () => {
    render(<PlannerPanel api={stubApi()} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));

    expect(await screen.findByTestId("planner-grounding")).toHaveTextContent(
      "1 vendor we could not confirm was left out",
    );
  });

  it("explains a refusal and keeps what the host wrote", async () => {
    const api = stubApi({
      generate: vi.fn(async () => {
        throw new PlannerError("rate_limited", "raw text");
      }),
    });
    render(<PlannerPanel api={api} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));

    expect(await screen.findByTestId("planner-error")).toHaveTextContent("Give it a few seconds");
    expect(screen.getByTestId("planner-brief")).toHaveValue(
      "A traditional wedding with a small band.",
    );
  });

  it("reports an answer", async () => {
    const api = stubApi();
    render(<PlannerPanel api={api} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));
    await screen.findByTestId("planner-result");

    fireEvent.click(screen.getByTestId("planner-report-open"));
    fireEvent.change(screen.getByTestId("planner-report-category"), {
      target: { value: "price_or_availability" },
    });
    fireEvent.change(screen.getByTestId("planner-report-note"), {
      target: { value: "The price is wrong" },
    });
    fireEvent.click(screen.getByTestId("planner-report-submit"));

    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith(
        INTERACTION_ID,
        "price_or_availability",
        "The price is wrong",
      ),
    );
    expect(await screen.findByTestId("planner-reported")).toHaveTextContent("Thank you");
  });

  it("takes the question the host arrived with", () => {
    render(
      <PlannerPanel
        api={stubApi()}
        initialBrief="Help me plan my wedding in Lagos on 12 December 2026."
      />,
    );
    expect(screen.getByTestId("planner-brief")).toHaveValue(
      "Help me plan my wedding in Lagos on 12 December 2026.",
    );
  });

  it("says when there is nothing to build on", async () => {
    const api = stubApi({
      generate: vi.fn(async () => ({
        ...answer(),
        plan: {
          summary: "No vendor has published a profile yet.",
          options: [],
          removed_vendors: 0,
          unknown_prices: 0,
        },
      })),
    });
    render(<PlannerPanel api={api} />);
    fillForm();
    fireEvent.click(screen.getByTestId("planner-submit"));

    expect(await screen.findByTestId("planner-no-options")).toHaveTextContent(
      "There is nothing to build on yet",
    );
  });
});
