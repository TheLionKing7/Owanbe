import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ responses: () => "model" }),
}));

import { AI_MODELS, aiConfigured, generateStructured } from "./provider.server";

const schema = z.object({ summary: z.string() });

beforeEach(() => {
  streamText.mockReset();
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the shared AI provider", () => {
  it("is not configured without the gateway key", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    expect(aiConfigured()).toBe(false);

    const outcome = await generateStructured({
      model: "planner",
      system: "s",
      prompt: "p",
      schema,
    });

    expect(outcome).toEqual({ ok: false, failure: { code: "unconfigured", retryable: false } });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("refuses a sensitive request while no zero-retention contract is confirmed", async () => {
    const outcome = await generateStructured({
      model: "investigation",
      system: "s",
      prompt: "p",
      schema,
      sensitive: true,
    });

    expect(outcome).toEqual({ ok: false, failure: { code: "zdr_required", retryable: false } });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("answers a sensitive request once the contract is confirmed", async () => {
    streamText.mockReturnValue({
      output: Promise.resolve({ summary: "The money is still held." }),
    });

    const outcome = await generateStructured({
      model: "investigation",
      system: "s",
      prompt: "p",
      schema,
      sensitive: true,
      zdrConfirmed: true,
    });

    expect(outcome).toEqual({ ok: true, value: { summary: "The money is still held." } });
  });

  it("never asks the provider to keep the exchange", async () => {
    streamText.mockReturnValue({ output: Promise.resolve({ summary: "A." }) });

    await generateStructured({ model: "planner", system: "s", prompt: "p", schema });

    const call = streamText.mock.calls.at(0);
    expect(call?.[0]?.providerOptions).toMatchObject({ openai: { store: false } });
  });

  it("says the answer came back incomplete", async () => {
    const { NoObjectGeneratedError } = await import("ai");
    streamText.mockImplementation(() => {
      throw new NoObjectGeneratedError({
        text: "not json",
        response: { id: "r", timestamp: new Date(0), modelId: "m" },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          inputTokenDetails: {
            noCacheTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        },
        finishReason: "other",
      });
    });

    const outcome = await generateStructured({
      model: "planner",
      system: "s",
      prompt: "p",
      schema,
    });

    expect(outcome).toEqual({ ok: false, failure: { code: "incomplete", retryable: true } });
  });

  it("runs every surface on the same model", () => {
    expect(new Set(Object.values(AI_MODELS)).size).toBe(1);
  });
});
