import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeClient, renderApp } from "./fakeAuth";

describe("F-76 authentication", () => {
  it("keeps houses locked when Auth0/Supabase are not configured (fail closed)", async () => {
    renderApp("/host", null);
    expect(await screen.findByText("Sign-in isn't available yet")).toBeInTheDocument();
    expect(screen.queryByTestId("house-name")).toBeNull();
  });

  it("sends a signed-out visitor to Auth0 with the page they wanted", async () => {
    const client = fakeClient("signedOut");
    renderApp("/vendor/quotes?x=1", client);
    expect(await screen.findByText("Redirecting to sign in…")).toBeInTheDocument();
    await waitFor(() => expect(client.login).toHaveBeenCalledWith({ returnTo: "/vendor/quotes?x=1", signup: false }));
    expect(screen.queryByTestId("house-name")).toBeNull();
    expect(client.ensureAppUser).not.toHaveBeenCalled();
  });

  it("admits a user only after the server session gate (ensure_user) succeeds", async () => {
    const client = fakeClient("signedIn");
    renderApp("/host", client);
    expect(await screen.findByTestId("house-name")).toHaveTextContent("Host House");
    expect(client.restoreSession).toHaveBeenCalledTimes(1);
    expect(client.ensureAppUser).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("signed-in-as")).toHaveTextContent("Alice A.");
  });

  it("refuses a suspended account even with a valid Auth0 session", async () => {
    renderApp("/host", fakeClient("suspended"));
    expect(await screen.findByText("Your account is not active")).toBeInTheDocument();
    expect(screen.getByText(/This account is suspended/)).toBeInTheDocument();
    expect(screen.queryByTestId("house-name")).toBeNull();
  });

  it("shows a retryable error when the session check fails", async () => {
    let fail = true;
    const client = fakeClient("signedIn");
    client.ensureAppUser = async () => {
      if (fail) throw new Error("network");
      return (await fakeClient("signedIn").ensureAppUser());
    };
    renderApp("/vendor", client);
    expect(await screen.findByText("We couldn't sign you in")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("house-name")).toHaveTextContent("Vendor House");
  });

  it("completes the Auth0 callback once, then continues to the saved page", async () => {
    const client = fakeClient("signedOut");
    const { router } = renderApp("/auth/callback?code=abc&state=xyz", client);
    await waitFor(() => expect(router.state.location.pathname).toBe("/vendor/quotes"));
    expect(client.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(client.ensureAppUser).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Quotes", level: 1 })).toBeInTheDocument();
  });

  it("does not continue after a callback when the account is blocked", async () => {
    const { router } = renderApp("/auth/callback?code=abc&state=xyz", fakeClient("suspended"));
    expect(await screen.findByText("Your account is not active")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth/callback");
  });

  it("swaps the header actions once signed in, and signs out", async () => {
    const client = fakeClient("signedIn");
    renderApp("/", client);
    const header = screen.getByRole("banner");
    const signOut = await within(header).findByRole("button", { name: "Sign Out" });
    expect(within(header).getByRole("link", { name: "My Ówàńbè" })).toHaveAttribute("href", "/host");
    await userEvent.click(signOut);
    expect(client.logout).toHaveBeenCalled();
    expect(await within(header).findByRole("link", { name: "Sign In" })).toBeInTheDocument();
  });

  it("starts sign-up from the Get Started chooser", async () => {
    const client = fakeClient("signedOut");
    renderApp("/sign-up?next=/vendor", client);
    await waitFor(() => expect(client.login).toHaveBeenCalledWith({ returnTo: "/sign-up?next=/vendor", signup: true }));
  });
});
