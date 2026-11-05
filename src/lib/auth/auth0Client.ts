// Loaded on demand (separate chunk): Auth0 SPA SDK + Supabase client.
import { createAuth0Client, type Auth0Client } from "@auth0/auth0-spa-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { absoluteUrl, type AuthEnv } from "@/config/env";
import { AccountBlockedError, type AppUser, type AuthClient, type HouseSummary, type LoginOptions } from "./types";

export const CALLBACK_PATH = "/auth/callback";

const safeReturnTo = (path: unknown) =>
  typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : "/";

export async function createAuthClient(env: AuthEnv): Promise<AuthClient> {
  const auth0: Auth0Client = await createAuth0Client({
    domain: env.domain,
    clientId: env.clientId,
    authorizationParams: { audience: env.audience, redirect_uri: absoluteUrl(CALLBACK_PATH) },
    // Tokens stay in memory (never localStorage); rotating refresh tokens keep the session.
    cacheLocation: "memory",
    useRefreshTokens: true,
    useRefreshTokensFallback: true,
  });

  let supabase: SupabaseClient | null = null;
  const getSupabase = async () => {
    if (!supabase) {
      const { createClient } = await import("@supabase/supabase-js");
      supabase = createClient(env.supabaseUrl, env.supabasePublicKey, {
        // Third-party auth: every request carries the Auth0 access token.
        accessToken: async () => (await auth0.getTokenSilently()) ?? null,
      });
    }
    return supabase;
  };

  return {
    async getAccessToken() {
      try {
        return (await auth0.getTokenSilently()) ?? null;
      } catch {
        return null;
      }
    },
    async handleRedirectCallback(url) {
      const result = await auth0.handleRedirectCallback<{ returnTo?: string }>(url);
      return safeReturnTo(result.appState?.returnTo);
    },
    async restoreSession() {
      try {
        await auth0.getTokenSilently();
      } catch {
        return false;
      }
      return auth0.isAuthenticated();
    },
    async login(options: LoginOptions = {}) {
      await auth0.loginWithRedirect({
        appState: { returnTo: safeReturnTo(options.returnTo) },
        ...(options.signup ? { authorizationParams: { screen_hint: "signup" } } : {}),
      });
    },
    async logout() {
      await auth0.logout({ logoutParams: { returnTo: absoluteUrl("/") } });
    },
    async ensureAppUser() {
      const client = await getSupabase();
      const { data, error } = await client.rpc("ensure_user");
      if (error) {
        if (error.message === "account_suspended") throw new AccountBlockedError("suspended");
        if (error.message === "account_deactivated") throw new AccountBlockedError("deactivated");
        throw new Error(error.message || "ensure_user failed");
      }
      return data as AppUser;
    },
    async listHouses() {
      const client = await getSupabase();
      const { data, error } = await client.rpc("my_houses");
      if (error) throw new Error(error.message || "my_houses failed");
      return (data ?? []) as HouseSummary[];
    },
  };
}
