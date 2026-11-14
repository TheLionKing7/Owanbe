import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConsoleError, type AiConsoleApi } from "./console.api";
import { AiConsolePanel } from "./AiConsolePanel";
import type { AiAnswer, AiCase } from "./console-contracts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const INTERACTION_ID = "33333333-3333-4333-8333-333333333333";

function aCase(overrides: Partial<AiCase> = {}): AiCase {
  return {
    case_id: CASE_ID,
    case_reference: "CASE-0123456789AB",
    subject: "The last tranche is still held after the window opened",
    reason: "The host paid in full and the completion window has opened.",
    status: "open",
    priority: "high",
    source: "ai_investigation",
    opened_by: null,
    ai_interaction_id: INTERACTION_ID,
    booking_id: null,
    created_at: "2026-11-13T09:00:00.000Z",
    updated_at: "2026-11-13T09:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

function anAnswer(overrides: Partial<AiAnswer> = {}): AiAnswer {
  return {
    interaction_id: INTERACTION_ID,
    created_at: "2026-11-13T09:00:00.000Z",
    surface: "payment_investigation",
    request_summary: "Why has the last tranche not been released?",
    response_text: "The first tranche went out and the last one is still held.",
    reason: "The payment arrived and the window has not closed.",
    outcome: "opened_case",
    model: "openai/gpt-6-astra",
    booking_id: null,
    case_id: CASE_ID,
    case_reference: "CASE-0123456789AB",
    reported_at: null,
    report_category: null,
    ...overrides,
  };
}

function stubApi(overrides: Partial<AiConsoleApi> = {}): AiConsoleApi {
  return {
    cases: vi.fn(async () => [aCase()]),
    answers: vi.fn(async () => [anAnswer()]),
    mine: vi.fn(async () => [anAnswer()]),
    updateCase: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe("AiConsolePanel", () => {
  it("shows what OwanbeAI has answered the caller", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    const answers = await screen.findAllByTestId("ai-console-my-answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.textContent).toContain("still held");
  });

  it("says when OwanbeAI has answered nobody yet", async () => {
    const api = stubApi({ mine: vi.fn(async () => []) });
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-mine-empty")).textContent).toContain(
      "has not answered you yet",
    );
  });

  it("shows a reported answer as reported", async () => {
    const api = stubApi({
      mine: vi.fn(async () => [
        anAnswer({ reported_at: "2026-11-13T10:00:00.000Z", report_category: "wrong_facts" }),
      ]),
    });
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-my-reported")).textContent).toContain(
      "You reported this answer",
    );
  });

  it("shows the case queue with what the case says", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    const cases = await screen.findAllByTestId("ai-console-case");
    expect(cases).toHaveLength(1);
    expect(cases[0]?.textContent).toContain("CASE-0123456789AB");
    expect(screen.getByTestId("ai-console-case-subject").textContent).toContain(
      "The last tranche is still held",
    );
  });

  it("says the queue is for staff when the database refuses it", async () => {
    const api = stubApi({
      cases: vi.fn(async () => {
        throw new AiConsoleError("forbidden", "forbidden");
      }),
      answers: vi.fn(async () => {
        throw new AiConsoleError("forbidden", "forbidden");
      }),
    });
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-forbidden")).textContent).toContain(
      "AI investigation grant",
    );
  });

  it("works a case and says what it did", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    await screen.findAllByTestId("ai-console-case");
    fireEvent.click(screen.getByTestId("ai-console-case-work"));
    fireEvent.change(screen.getByTestId("ai-console-case-status"), {
      target: { value: "investigating" },
    });
    fireEvent.change(screen.getByTestId("ai-console-case-note"), {
      target: { value: "Looking at the release window now." },
    });
    fireEvent.click(screen.getByTestId("ai-console-case-save"));

    await waitFor(() => expect(api.updateCase).toHaveBeenCalled());
    expect(api.updateCase).toHaveBeenCalledWith({
      case_id: CASE_ID,
      status: "investigating",
      note: "Looking at the release window now.",
    });
  });

  it("offers only the moves the database allows", async () => {
    const api = stubApi({ cases: vi.fn(async () => [aCase({ status: "closed" })]) });
    render(<AiConsolePanel api={api} />);

    await screen.findAllByTestId("ai-console-case");
    fireEvent.click(screen.getByTestId("ai-console-case-work"));

    const select = screen.getByTestId("ai-console-case-status") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
  });

  it("says what the database said when the move was refused", async () => {
    const api = stubApi({
      updateCase: vi.fn(async () => {
        throw new AiConsoleError(
          "validation",
          "A case cannot go from where it is to where you asked.",
        );
      }),
    });
    render(<AiConsolePanel api={api} />);

    await screen.findAllByTestId("ai-console-case");
    fireEvent.click(screen.getByTestId("ai-console-case-work"));
    fireEvent.change(screen.getByTestId("ai-console-case-status"), {
      target: { value: "closed" },
    });
    fireEvent.click(screen.getByTestId("ai-console-case-save"));

    expect((await screen.findByTestId("ai-console-case-error")).textContent).toContain(
      "cannot go from where it is",
    );
  });

  it("shows the answers the platform gave", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    const answers = await screen.findAllByTestId("ai-console-answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.textContent).toContain("openai/gpt-6-astra");
  });

  it("says when there are no answers at all", async () => {
    const api = stubApi({ answers: vi.fn(async () => []) });
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-answers-empty")).textContent).toContain(
      "not answered anybody yet",
    );
  });

  it("says what the console does not do", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-disclosure")).textContent).toContain(
      "no payment, no hold and no booking is touched",
    );
  });

  it("labels itself as AI answers", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    expect((await screen.findByTestId("ai-console-label")).textContent).toContain("AI answers");
  });

  it("labels every answer it shows", async () => {
    const api = stubApi();
    render(<AiConsolePanel api={api} />);

    const labels = await screen.findAllByTestId(
      `ai-console-answer-label-${INTERACTION_ID.slice(0, 8)}`,
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.textContent).toContain("AI investigation");
    }
  });

  it("still labels an answer from a surface it does not know", async () => {
    const api = stubApi({
      answers: vi.fn(async () => [anAnswer({ surface: "a_surface_we_added" })]),
    });
    render(<AiConsolePanel api={api} />);

    const labels = await screen.findAllByTestId(
      `ai-console-answer-label-${INTERACTION_ID.slice(0, 8)}`,
    );
    expect(labels.some((label) => label.textContent?.includes("AI answer"))).toBe(true);
  });
});
