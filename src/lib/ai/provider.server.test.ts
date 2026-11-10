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

  it("uses each surface's first-choice model", () => {
    expect(Object.values(AI_MODELS).every((m) => m.startsWith("openai/"))).toBe(true);
  });
});

import { AI_MODEL_CHAINS, shouldFallBack } from "./provider.server";
describe("multi-model fallback", () => {
  it("offers GPT Luna 6 and at least two models per surface", () => {
    for (const chain of Object.values(AI_MODEL_CHAINS)) expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(AI_MODEL_CHAINS.vendorCopy[0]).toBe("openai/gpt-6-luna");
  });
  it("falls back on busy models but never on credits", () => {
    expect(shouldFallBack("rate_limited")).toBe(true);
    expect(shouldFallBack("credits")).toBe(false);
    expect(shouldFallBack("zdr_required")).toBe(false);
  });
});
