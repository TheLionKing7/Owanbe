import { describe, expect, it } from "vitest";
import { monitoringEnvironment, sanitizeSentryEvent } from "@/lib/monitoring/privacy";

describe("F-79 monitoring privacy", () => {
  it("removes user, request, breadcrumbs, contexts and extra data", () => {
    const result = sanitizeSentryEvent({
      user: { email: "private@example.test" },
      request: { url: "https://app.test/auth/callback?code=private" },
      breadcrumbs: [{ message: "private guest" }],
      contexts: { auth: { token: "private" } },
      extra: { bank: "private" },
      tags: { house: "private" },
    });
    for (const field of ["user", "request", "breadcrumbs", "contexts", "extra", "tags"]) expect(result).not.toHaveProperty(field);
  });
  it("redacts exception messages and removes script query strings and fragments", () => {
    const result = sanitizeSentryEvent({ exception: { values: [{ type: "private", value: "private payment details", stacktrace: { frames: [{ filename: "https://app.test/assets/app.js?token=private#private", lineno: 42, vars: { token: "private" } }] } }] } });
    expect(result.exception?.values?.[0]?.value).toBe("Redacted application error");
    expect(result.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({ filename: "https://app.test/assets/app.js", lineno: 42, colno: undefined, in_app: undefined });
  });
  it("drops callback URLs and unparseable filenames", () => {
    for (const filename of ["https://app.test/auth/callback?code=private", "private payload"]) {
      const result = sanitizeSentryEvent({ exception: { values: [{ stacktrace: { frames: [{ filename }] } }] } });
      expect(result.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBeUndefined();
    }
  });
  it("allows only the approved environment names", () => {
    expect(monitoringEnvironment("production")).toBe("production");
    expect(monitoringEnvironment("staging")).toBe("staging");
    expect(monitoringEnvironment("development")).toBe("development");
    expect(monitoringEnvironment("private" )).toBe("development");
  });
});