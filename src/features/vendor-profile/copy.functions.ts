import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { profileBriefSchema, type GenerateResult } from "./contracts";

/** Signed-in vendors only: verifies the Auth0 token server-side before any AI call. */
export const draftProfileCopy = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => profileBriefSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateResult> => {
    const { validateRequestToken } = await import("@/lib/auth/validate-token.server");
    try {
      await validateRequestToken(getRequestHeader("authorization") ?? null);
    } catch {
      return { ok: false, error: "Please sign in again to use the writing assistant.", retryable: false };
    }
    const { generateProfileCopy } = await import("./copy.server");
    return generateProfileCopy(data);
  });
