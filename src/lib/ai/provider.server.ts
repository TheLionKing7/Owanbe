/**
 * Server-only: the platform's one AI provider.
 *
 * The blueprint keeps the provider configuration away from the product logic
 * (blueprint/architecture.md:211), so the model, the gateway and the rules that guard a call live
 * here and every AI surface calls the same function. Before F-107 each surface built its own
 * client, which meant the rules were written twice and could drift.
 *
 * Two rules this file owns:
 *   * a request marked sensitive is refused while no zero-retention contract is confirmed, so
 *     payment data cannot leave for a model that has not contracted to keep nothing. The
 *     database decides whether the contract is confirmed; nothing here assumes it.
 *   * the provider is never asked to keep the exchange: every call sets store to false.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

/** The models the platform runs on. One place, so a change is one line. */
export const AI_MODELS = {
  planner: "openai/gpt-6-astra",
  vendorCopy: "openai/gpt-6-astra",
  investigation: "openai/gpt-6-astra",
} as const;

export type AiModelName = keyof typeof AI_MODELS;

export type AiFailureCode =
  | "unconfigured"
  | "zdr_required"
  | "rate_limited"
  | "credits"
  | "unavailable"
  | "incomplete"
  | "unknown";

export type AiFailure = { code: AiFailureCode; retryable: boolean };

export type AiOutcome<T> = { ok: true; value: T } | { ok: false; failure: AiFailure };

export type AiRequest<S extends z.ZodTypeAny> = {
  model: AiModelName;
  system: string;
  prompt: string;
  schema: S;
  /** The request carries data the platform classifies as sensitive: payment records, party details. */
  sensitive?: boolean;
  /** Whether a zero-retention contract is confirmed. The database decides; nothing here assumes it. */
  zdrConfirmed?: boolean;
};

/** Whether the platform can talk to the model at all. */
export function aiConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env["LOVABLE_API_KEY"]?.trim());
}

/** The one gateway client. The product code never builds its own. */
function gateway(apiKey: string) {
  return createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}

/**
 * One structured answer from the model.
 *
 * The failure is a code, not a sentence: every surface has its own wording for the same
 * problem, and the wording belongs to the surface, not to the provider.
 */
export async function generateStructured<S extends z.ZodTypeAny>(
  request: AiRequest<S>,
): Promise<AiOutcome<z.infer<S>>> {
  const apiKey = process.env["LOVABLE_API_KEY"]?.trim();
  if (!apiKey) return { ok: false, failure: { code: "unconfigured", retryable: false } };

  if (request.sensitive && !request.zdrConfirmed) {
    return { ok: false, failure: { code: "zdr_required", retryable: false } };
  }

  try {
    const result = streamText({
      model: gateway(apiKey).responses(AI_MODELS[request.model]),
      system: request.system,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema }),
      maxRetries: 0,
      providerOptions: {
        openai: { forceReasoning: true, reasoningEffort: "low", store: false },
      },
    });
    const value = await result.output;
    return { ok: true, value };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return { ok: false, failure: { code: "incomplete", retryable: true } };
    }
    const status = APICallError.isInstance(error) ? error.statusCode : undefined;
    console.error("[ai] gateway error", status);
    if (status === 429) return { ok: false, failure: { code: "rate_limited", retryable: true } };
    if (status === 402) return { ok: false, failure: { code: "credits", retryable: false } };
    if (status === 403) return { ok: false, failure: { code: "unavailable", retryable: false } };
    return { ok: false, failure: { code: "unknown", retryable: true } };
  }
}
