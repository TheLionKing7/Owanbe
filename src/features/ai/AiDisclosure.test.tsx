import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiLabel, AiReportControl } from "./AiDisclosure";
import { AI_DISCLOSURE } from "./contracts";

afterEach(cleanup);

describe("AiLabel", () => {
  it("shows the words the surface puts on its own output", () => {
    render(<AiLabel label={AI_DISCLOSURE.investigation} testId="disclosure" />);
    expect(screen.getByTestId("disclosure")).toHaveTextContent(AI_DISCLOSURE.investigation);
  });
});

describe("AiReportControl", () => {
  it("reports an answer with the category and the note", async () => {
    const onReport = vi.fn(async () => undefined);
    render(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    fireEvent.click(screen.getByTestId("answer-report-open"));
    fireEvent.change(screen.getByTestId("answer-report-category"), {
      target: { value: "wrong_facts" },
    });
    fireEvent.change(screen.getByTestId("answer-report-note"), {
      target: { value: "The city is wrong" },
    });
    fireEvent.click(screen.getByTestId("answer-report-submit"));

    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith("answer-1", "wrong_facts", "The city is wrong"),
    );
    expect(await screen.findByTestId("answer-reported")).toHaveTextContent("Thank you");
  });

  it("shows the surface's own words for a refusal and offers to try again", async () => {
    const onReport = vi.fn(async () => {
      throw new Error("refused");
    });
    render(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "That answer is not yours to report."}
        testIdPrefix="answer"
      />,
    );

    fireEvent.click(screen.getByTestId("answer-report-open"));
    fireEvent.click(screen.getByTestId("answer-report-submit"));

    expect(await screen.findByTestId("answer-report-error")).toHaveTextContent(
      "That answer is not yours to report.",
    );
    expect(screen.getByTestId("answer-report-form")).toBeInTheDocument();
  });

  it("says nothing is left to report once the report is logged", async () => {
    const onReport = vi.fn(async () => undefined);
    render(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    fireEvent.click(screen.getByTestId("answer-report-open"));
    fireEvent.click(screen.getByTestId("answer-report-submit"));
    await screen.findByTestId("answer-reported");

    expect(screen.queryByTestId("answer-report-open")).not.toBeInTheDocument();
  });

  it("starts again when a new answer arrives", async () => {
    const onReport = vi.fn(async () => undefined);
    const { rerender } = render(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    fireEvent.click(screen.getByTestId("answer-report-open"));
    fireEvent.click(screen.getByTestId("answer-report-submit"));
    await screen.findByTestId("answer-reported");

    rerender(
      <AiReportControl
        interactionId="answer-2"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    expect(await screen.findByTestId("answer-report-open")).toBeInTheDocument();
    expect(screen.queryByTestId("answer-reported")).not.toBeInTheDocument();
  });

  it("keeps the form open while the answer on screen does not change", () => {
    const onReport = vi.fn(async () => undefined);
    const { rerender } = render(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    fireEvent.click(screen.getByTestId("answer-report-open"));
    fireEvent.change(screen.getByTestId("answer-report-note"), {
      target: { value: "The city is wrong" },
    });

    rerender(
      <AiReportControl
        interactionId="answer-1"
        onReport={onReport}
        errorMessage={() => "We could not send that."}
        testIdPrefix="answer"
      />,
    );

    expect(screen.getByTestId("answer-report-form")).toBeInTheDocument();
    expect(screen.getByTestId("answer-report-note")).toHaveValue("The city is wrong");
  });
});
