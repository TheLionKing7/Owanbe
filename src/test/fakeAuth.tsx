import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";
import { routes, routerFuture } from "@/App";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import type { AuthEnv } from "@/config/env";
import { AccountBlockedError, type AppUser, type AuthClient } from "@/lib/auth/types";

export const TEST_ENV: AuthEnv = {
  domain: "owanbe-test.us.auth0.com",
  clientId: "client",
  audience: "https://api.owanbe.app",
  supabaseUrl: "https://test.supabase.co",
  supabasePublicKey: "public-key",
};

export const ALICE: AppUser = { id: "u-1", auth0_sub: "auth0|alice", email: "alice@example.com", display_name: "Alice A.", status: "active" };

type Mode = "signedIn" | "signedOut" | "suspended" | "error";

export function fakeClient(mode: Mode, overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    handleRedirectCallback: vi.fn(async () => "/vendor/quotes"),
    restoreSession: vi.fn(async () => mode !== "signedOut"),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    ensureAppUser: vi.fn(async () => {
      if (mode === "suspended") throw new AccountBlockedError("suspended");
      if (mode === "error") throw new Error("network");
      return ALICE;
    }),
    ...overrides,
  };
}

export function renderApp(path: string, client: AuthClient | null = fakeClient("signedIn")) {
  const router = createMemoryRouter(routes, { initialEntries: [path], future: routerFuture });
  const loader = vi.fn(async () => client!);
  render(
    <AuthProvider env={client ? TEST_ENV : null} loader={loader}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AuthProvider>,
  );
  return { router, client, loader };
}
