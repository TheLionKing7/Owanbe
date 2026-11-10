import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, type AiApi } from "./api";
import { AiInvestigationPanel } from "./AiInvestigationPanel";
import type { InvestigationResult } from "./contracts";

const BOOKING_ID = "7a2e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const INTERACTION_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CASE_ID = "8b3f0d5b-3c4d-5f6a-9b8c-2d3e4f5a6b7c";

function answer(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    interaction_id: INTERACTION_ID,
    disclosure: "AI investigation",
    summary: "The payment trail looks normal.",
    finding: "no_issue",
    case_id: null,
    ...overrides,
  };
}

function stubApi(overrides: Partial<AiApi> = {}): AiApi {
  return {
    status: vi.fn(async () => ({ available: true, reason: null })),
    investigate: vi.fn(async () => answer()),
    report: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe("AiInvestigationPanel", () => {
  it("shows nothing to a caller who may not use OwanbeAI", async () => {
    const api = stubApi({
      status: vi.fn(async () => ({ available: false, reason: "no_grant" as const })),
    });
    const { container } = render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="ai-investigation-panel"]')).toBeNull();
    expect(api.investigate).not.toHaveBeenCalled();
  });

  it("shows nothing when the platform is not configured for it", async () => {
    const api = stubApi({
      status: vi.fn(async () => {
        throw new AiError("locked", "closed");
      }),
    });
    const { container } = render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await waitFor(() => expect(api.status).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="ai-investigation-panel"]')).toBeNull();
  });

  it("labels the answer as the AI's own work", async () => {
    const api = stubApi();
    render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    const panel = await screen.findByTestId("ai-investigation-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByTestId("ai-investigation-disclosure").textContent).toContain(
      "AI investigation",
    );
  });

  it("asks the question the staff member asked", async () => {
    const api = stubApi();
    render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await screen.findByTestId("ai-investigation-ask");
    fireEvent.change(screen.getByTestId("ai-investigation-question"), {
      target: { value: "Why is the money still held?" },
    });
    fireEvent.click(screen.getByTestId("ai-investigation-ask"));

    await waitFor(() => expect(api.investigate).toHaveBeenCalled());
    expect(api.investigate).toHaveBeenCalledWith(BOOKING_ID, "Why is the money still held?");
  });

  it("shows what the investigation found and the case it opened", async () => {
    const api = stubApi({
      investigate: vi.fn(async () =>
        answer({
          finding: "case_opened",
          summary: "A failed charge is still counted as paid.",
          case_id: CASE_ID,
        }),
      ),
    });
    render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await screen.findByTestId("ai-investigation-ask");
    fireEvent.click(screen.getByTestId("ai-investigation-ask"));

    const result = await screen.findByTestId("ai-investigation-result");
    expect(result.textContent).toContain("A failed charge is still counted as paid.");
    expect(screen.getByTestId("ai-investigation-finding").textContent).toContain(
      "A case was opened",
    );
    expect(screen.getByTestId("ai-investigation-case").textContent).toContain(CASE_ID);
  });

  it("says the investigation is closed when the platform says so", async () => {
    const api = stubApi({
      investigate: vi.fn(async () => {
        throw new AiError("locked", "closed");
      }),
    });
    render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await screen.findByTestId("ai-investigation-ask");
    fireEvent.click(screen.getByTestId("ai-investigation-ask"));

    const error = await screen.findByTestId("ai-investigation-error");
    expect(error.textContent).toContain("zero-data-retention");
  });

  it("reports the investigation that was shown", async () => {
    const api = stubApi();
    render(<AiInvestigationPanel bookingId={BOOKING_ID} api={api} />);

    await screen.findByTestId("ai-investigation-ask");
    fireEvent.click(screen.getByTestId("ai-investigation-ask"));
    await screen.findByTestId("ai-investigation-result");

    fireEvent.click(screen.getByTestId("ai-investigation-report-open"));
    fireEvent.change(screen.getByTestId("ai-investigation-report-category"), {
      target: { value: "wrong_facts" },
    });
    fireEvent.click(screen.getByTestId("ai-investigation-report-submit"));

    await waitFor(() => expect(api.report).toHaveBeenCalled());
    expect(api.report).toHaveBeenCalledWith(INTERACTION_ID, "wrong_facts", undefined);
    expect(await screen.findByTestId("ai-investigation-reported")).toBeTruthy();
  });
});
