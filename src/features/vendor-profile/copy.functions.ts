import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { profileBriefSchema, type GenerateResult } from "./contracts";

/** Signed-in vendors only: verifies the Auth0 token server-side before any AI call. */
export const draftProfileCopy = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => profileBriefSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateResult> => {
    const { validateRequestToken } = await import("@/lib/auth/validate-token.server");
    const { bearerToken } = await import("@/lib/db/caller.server");
    const authorization = getRequestHeader("authorization") ?? null;
    try {
      await validateRequestToken(authorization);
    } catch {
      return {
        ok: false,
        error: "Please sign in again to use the writing assistant.",
        retryable: false,
      };
    }
    const { generateProfileCopy, logCopyInteraction } = await import("./copy.server");
    const result = await generateProfileCopy(data);
    if (!result.ok) return result;

    // The draft is logged as an interaction so the vendor can report it. A draft that cannot be
    // logged is still shown; it simply carries no report.
    const token = bearerToken(authorization);
    const interactionId = token ? await logCopyInteraction(token, data, result.copy) : null;
    return { ok: true, copy: result.copy, interaction_id: interactionId };
  });
