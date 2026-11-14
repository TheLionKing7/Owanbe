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

/**
 * The models the platform runs on, in the order they are tried. If the first is busy or down
 * (rate limit, server error, model unavailable) the next one answers. All are zero-retention.
 */
export const AI_MODEL_CHAINS = {
  planner: ["openai/gpt-6-astra", "openai/gpt-6-luna", "openai/gpt-6-sol"],
  vendorCopy: ["openai/gpt-6-luna", "openai/gpt-6-astra", "openai/gpt-5.5"],
  investigation: ["openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai/gpt-6-luna"],
} as const;

/** The first choice per surface; kept for callers that only need one name. */
export const AI_MODELS = {
  planner: AI_MODEL_CHAINS.planner[0],
  vendorCopy: AI_MODEL_CHAINS.vendorCopy[0],
  investigation: AI_MODEL_CHAINS.investigation[0],
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

export type AiFailure = { code: AiFailureCode; retryable: boolean; model?: string };

export type AiOutcome<T> =
  { ok: true; value: T; model: string } | { ok: false; failure: AiFailure };

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

  let last: AiFailure = { code: "unknown", retryable: true };
  for (const model of AI_MODEL_CHAINS[request.model]) {
    const outcome = await tryModel(apiKey, model, request);
    if (outcome.ok) return outcome;
    last = outcome.failure;
    // Only a busy or broken model is worth handing to the next one. Credits and bad requests end here.
    if (!shouldFallBack(last.code)) return outcome;
  }
  return { ok: false, failure: last };
}

export function shouldFallBack(code: AiFailureCode): boolean {
  return code === "rate_limited" || code === "unavailable" || code === "unknown";
}

async function tryModel<S extends z.ZodTypeAny>(
  apiKey: string,
  model: string,
  request: AiRequest<S>,
): Promise<AiOutcome<z.infer<S>>> {
  try {
    const result = streamText({
      model: gateway(apiKey).responses(model),
      system: request.system,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema }),
      maxRetries: 0,
      providerOptions: {
        openai: { forceReasoning: true, reasoningEffort: "low", store: false },
      },
    });
    const value = await result.output;
    // The model that answered, not the one the chain tried first: the interaction log has to name
    // the model that actually produced the answer.
    return { ok: true, value, model };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return { ok: false, failure: { code: "incomplete", retryable: true, model } };
    }
    const status = APICallError.isInstance(error) ? error.statusCode : undefined;
    console.error("[ai] gateway error", model, status);
    if (status === 429)
      return { ok: false, failure: { code: "rate_limited", retryable: true, model } };
    if (status === 402) return { ok: false, failure: { code: "credits", retryable: false, model } };
    if (status === 403 || status === 404) {
      return { ok: false, failure: { code: "unavailable", retryable: false, model } };
    }
    if (status === 400)
      return { ok: false, failure: { code: "incomplete", retryable: false, model } };
    return { ok: false, failure: { code: "unknown", retryable: true, model } };
  }
}
