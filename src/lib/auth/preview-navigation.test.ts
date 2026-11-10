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
  it("redirects the top window when embedded in a frame", () => {
    const top = { location: { href: "" } };
    vi.spyOn(window, "top", "get").mockReturnValue(top as unknown as Window);
    const open = vi.spyOn(window, "open");
    expect(openStandaloneAuth({ signup: true, returnTo: "/host" })).toBe(true);
    expect(top.location.href).toBe(`${window.location.origin}/sign-up?next=%2Fhost`);
    expect(open).not.toHaveBeenCalled();
  });
  it("falls back to a new tab when the top window cannot be navigated", () => {
    const top = { location: {} };
    Object.defineProperty(top.location, "href", { set() { throw new DOMException("blocked"); } });
    vi.spyOn(window, "top", "get").mockReturnValue(top as unknown as Window);
    const opened = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(opened);
    expect(openStandaloneAuth({ returnTo: "/host" })).toBe(true);
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/sign-in?next=%2Fhost`, "_blank");
    expect(opened.opener).toBeNull();
  });
});