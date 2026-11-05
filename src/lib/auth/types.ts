/** Application user returned by public.ensure_user() (one per Auth0 subject). */
export interface AppUser {
  id: string;
  auth0_sub: string;
  email: string | null;
  display_name: string | null;
  status: "active" | "suspended" | "deactivated";
}

/** Projection from public.my_houses(): only the caller's own houses. */
export interface HouseSummary {
  house_id: string;
  kind: "host" | "vendor";
  display_name: string;
  role: "owner" | "staff";
  capabilities: string[];
}

export interface LoginOptions {
  returnTo?: string;
  signup?: boolean;
}

/** Thin boundary over Auth0 + Supabase so the UI never imports either SDK statically. */
export interface AuthClient {
  /** Completes the Auth0 redirect; returns the in-app path to continue to. */
  handleRedirectCallback(url: string): Promise<string>;
  /** Restores an existing Auth0 session silently; true when signed in. */
  restoreSession(): Promise<boolean>;
  login(options?: LoginOptions): Promise<void>;
  logout(): Promise<void>;
  /** Runs the server-side session gate (token checks, user mapping, status). */
  ensureAppUser(): Promise<AppUser>;
  /** Houses the admitted user belongs to (public.my_houses()). */
  listHouses(): Promise<HouseSummary[]>;
  /** Current Auth0 access token for calling the app's own server functions. */
  getAccessToken?(): Promise<string | null>;
}

export type AuthStatus = "unconfigured" | "loading" | "signedOut" | "signedIn" | "blocked" | "error";

export class AccountBlockedError extends Error {
  constructor(public readonly reason: "suspended" | "deactivated") {
    super(`account_${reason}`);
  }
}
