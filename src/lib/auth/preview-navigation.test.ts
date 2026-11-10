import { describe, expect, it, vi, afterEach } from "vitest";
import { openStandaloneAuth, standaloneAuthPath } from "./preview-navigation";

afterEach(() => vi.restoreAllMocks());

describe("standalone Auth0 navigation", () => {
  it("preserves vendor onboarding on the same app path", () => {
    expect(standaloneAuthPath({ signup: true, returnTo: "/welcome?role=vendor" }))
      .toBe("/sign-up?next=%2Fwelcome%3Frole%3Dvendor");
  });
  it("rejects external and backslash destinations", () => {
    for (const returnTo of ["https://other.test", "//other.test", "/\\other.test"]) {
      expect(standaloneAuthPath({ returnTo })).toBe("/sign-in?next=%2Fhost");
    }
  });
  it("does not open another window when already outside the preview", () => {
    const open = vi.spyOn(window, "open");
    expect(openStandaloneAuth({ returnTo: "/host" })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});