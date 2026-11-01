import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readAuthEnv, type AuthEnv } from "@/config/env";
import { AccountBlockedError, type AppUser, type AuthClient, type AuthStatus, type LoginOptions } from "./types";

export type AuthClientLoader = (env: AuthEnv) => Promise<AuthClient>;

const defaultLoader: AuthClientLoader = async (env) => (await import("./auth0Client")).createAuthClient(env);

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  blockedReason: "suspended" | "deactivated" | null;
  login(options?: LoginOptions): Promise<void>;
  logout(): Promise<void>;
  /** Finishes an Auth0 redirect; resolves to the in-app path to continue to, or null if not admitted. */
  completeLogin(url: string): Promise<string | null>;
  retry(): void;
}

function whenIdle(task: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(task, { timeout: 2000 });
  else setTimeout(task, 1);
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Injected in tests; defaults to the lazily loaded Auth0 + Supabase client. */
  loader?: AuthClientLoader;
  /** Injected in tests; defaults to the build-time environment. */
  env?: AuthEnv | null;
}

export function AuthProvider({ children, loader = defaultLoader, env = readAuthEnv() }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>(env ? "loading" : "unconfigured");
  const [user, setUser] = useState<AppUser | null>(null);
  const [blockedReason, setBlockedReason] = useState<AuthContextValue["blockedReason"]>(null);
  const clientRef = useRef<Promise<AuthClient> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const getClient = useCallback(() => {
    if (!env) return Promise.reject(new Error("auth_not_configured"));
    clientRef.current ??= loader(env);
    return clientRef.current;
  }, [env, loader]);

  /** Server-side session gate: nothing is "signed in" until ensure_user succeeds. */
  const admit = useCallback(async (client: AuthClient): Promise<boolean> => {
    try {
      setUser(await client.ensureAppUser());
      setBlockedReason(null);
      setStatus("signedIn");
      return true;
    } catch (err) {
      setUser(null);
      if (err instanceof AccountBlockedError) {
        setBlockedReason(err.reason);
        setStatus("blocked");
      } else {
        setStatus("error");
      }
      return false;
    }
  }, []);

  const callbackRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    if (!env) return;
    if (window.location.pathname === "/auth/callback") return; // completeLogin drives this
    let cancelled = false;
    // Session restore pulls in the Auth0 + Supabase chunks; wait for an idle moment so the
    // homepage paints first on slow connections.
    whenIdle(async () => {
      try {
        const client = await getClient();
        const ok = await client.restoreSession();
        if (cancelled) return;
        if (ok) await admit(client);
        else setStatus("signedOut");
      } catch {
        if (!cancelled) setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [env, getClient, admit, attempt]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      blockedReason,
      async login(options) {
        const client = await getClient();
        await client.login(options);
      },
      async logout() {
        const client = await getClient();
        setUser(null);
        setStatus("signedOut");
        await client.logout();
      },
      completeLogin(url) {
        // Auth0 codes are single-use: repeated calls (e.g. StrictMode) share one exchange.
        callbackRef.current ??= (async () => {
          try {
            const client = await getClient();
            const returnTo = await client.handleRedirectCallback(url);
            return (await admit(client)) ? returnTo : null;
          } catch {
            setStatus(env ? "error" : "unconfigured");
            return null;
          }
        })();
        return callbackRef.current;
      },
      retry() {
        setStatus(env ? "loading" : "unconfigured");
        setAttempt((n) => n + 1);
      },
    }),
    [status, user, blockedReason, getClient, admit, env],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
