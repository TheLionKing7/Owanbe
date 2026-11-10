import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ login: vi.fn(), status: "signedOut" }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/site/Logo", () => ({ Logo: () => null }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams()],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
import SignUp from "./SignUp";

beforeEach(() => { auth.login.mockReset(); navigate.mockReset(); auth.status = "signedOut"; });
afterEach(cleanup);
describe("sign-up account paths", () => {
  it("sends an event planning business through Vendor onboarding", async () => {
    auth.login.mockResolvedValue(undefined);
    render(<SignUp />);
    fireEvent.click(screen.getByTestId("signup-vendor"));
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith({ returnTo: "/welcome?role=vendor", signup: true }));
    await waitFor(() => expect(screen.getByTestId("signup-vendor")).not.toBeDisabled());
  });
  it("keeps a failed registration retryable without navigating", async () => {
    auth.login.mockRejectedValue(new Error("auth_open_page_blocked"));
    render(<SignUp />);
    fireEvent.click(screen.getByTestId("signup-host"));
    await screen.findByRole("alert");
    expect(screen.getByTestId("signup-host")).not.toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
  });
});