import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readAuthEnv, type AuthEnv } from "@/config/env";
import { getPublicClientConfig } from "./config.functions";
import { AccountBlockedError, type AppUser, type AuthClient, type AuthStatus, type HouseSummary, type LoginOptions } from "./types";

export type AuthClientLoader = (env: AuthEnv) => Promise<AuthClient>;
export type AuthConfigLoader = () => Promise<AuthEnv | null>;

const defaultLoader: AuthClientLoader = async (env) => (await import("./auth0Client")).createAuthClient(env);

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  houses: HouseSummary[];
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
  /** Explicit null fails closed in tests; otherwise runtime settings are loaded first. */
  env?: AuthEnv | null;
  configLoader?: AuthConfigLoader;
}

export function AuthProvider({ children, loader = defaultLoader, env, configLoader = getPublicClientConfig }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>(env === null ? "unconfigured" : "loading");
  const [user, setUser] = useState<AppUser | null>(null);
  const [houses, setHouses] = useState<HouseSummary[]>([]);
  const [blockedReason, setBlockedReason] = useState<AuthContextValue["blockedReason"]>(null);
  const clientRef = useRef<Promise<AuthClient> | null>(null);
  const configRef = useRef<Promise<AuthEnv | null> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const getEnv = useCallback(() => {
    configRef.current ??= env !== undefined
      ? Promise.resolve(env)
      : configLoader().then((runtime) => runtime ?? readAuthEnv());
    return configRef.current;
  }, [env, configLoader]);

  const getClient = useCallback(() => {
    clientRef.current ??= getEnv().then((settings) => {
      if (!settings) throw new Error("auth_not_configured");
      return loader(settings);
    });
    return clientRef.current;
  }, [getEnv, loader]);

  /** Server-side session gate: nothing is "signed in" until ensure_user succeeds. */
  const admit = useCallback(async (client: AuthClient): Promise<boolean> => {
    try {
      const admitted = await client.ensureAppUser();
      setHouses(await client.listHouses());
      setUser(admitted);
      setBlockedReason(null);
      setStatus("signedIn");
      return true;
    } catch (err) {
      setUser(null);
      setHouses([]);
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
    if (env === null) return;
    if (window.location.pathname === "/auth/callback") return; // completeLogin drives this
    let cancelled = false;
    // Session restore pulls in the Auth0 + Supabase chunks; wait for an idle moment so the
    // homepage paints first on slow connections.
    whenIdle(async () => {
      try {
        const settings = await getEnv();
        if (cancelled) return;
        if (!settings) {
          setStatus("unconfigured");
          return;
        }
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
  }, [env, getEnv, getClient, admit, attempt]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      houses,
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
          } catch (error) {
            setStatus(error instanceof Error && error.message === "auth_not_configured" ? "unconfigured" : "error");
            return null;
          }
        })();
        return callbackRef.current;
      },
      retry() {
        configRef.current = null;
        clientRef.current = null;
        callbackRef.current = null;
        setStatus(env === null ? "unconfigured" : "loading");
        setAttempt((n) => n + 1);
      },
    }),
    [status, user, houses, blockedReason, getClient, admit, env],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
