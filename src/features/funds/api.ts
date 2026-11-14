/**
 * F-109 browser boundary for the recovery fund console.
 *
 * The browser reads through the database's own authorized projections, and every action that
 * moves money goes through the app's own routes, which forward the caller's token so the database
 * decides what the caller may do. The browser never writes a table, never holds a provider key and
 * never works out an amount for itself.
 */
import {
  FUNDS_REFUSAL_COPY,
  classifyFundsError,
  type DueFundPool,
  type FundPoolLedgerEntry,
  type FundsErrorCode,
  type ReconciliationReport,
  type RecoveryActionRow,
  type RecoveryCaseContext,
  type RecoveryFundBalance,
  type SplitAllocation,
} from "./contracts";

export const FUNDS_ERROR_COPY: Record<FundsErrorCode, string> = {
  forbidden: "This console is for platform staff.",
  not_found: "We could not find that.",
  validation: "Check the details and try again.",
  unauthorized: "Sign in to open the recovery console.",
  unconfigured: "The recovery fund is not set up in this environment yet.",
  unknown: "Something went wrong. Try again in a moment.",
};

/** Raised for every refusal so the console can explain it in plain language. */
export class FundsError extends Error {
  constructor(
    readonly code: FundsErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "FundsError";
  }
}

/** Validation carries the sentence the server chose; every other refusal uses the copy map. */
export function fundsErrorMessage(error: unknown): string {
  if (error instanceof FundsError) {
    if (error.code === "validation" || error.code === "not_found") return error.message;
    return FUNDS_ERROR_COPY[error.code];
  }
  return FUNDS_ERROR_COPY.unknown;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type RpcClient = (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

/** A read through the database's own projection, run as the signed-in person. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { supabase } = await import("@/integrations/supabase/client");
  const call = supabase.rpc as unknown as RpcClient;
  const { data, error } = await call(name, args);
  if (error) {
    const message = error.message ?? "";
    const code = classifyFundsError(message);
    throw new FundsError(code, FUNDS_REFUSAL_COPY[message] ?? message);
  }
  return data as T;
}

/** A call to the app's own route. The caller's token decides what happens. */
async function call(
  path: string,
  accessToken: string | null,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  if (!accessToken) throw new FundsError("unauthorized", "no_token");
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new FundsError("unknown", "request_failed");
  }
  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  if (!res.ok) {
    const code = ERROR_CODES.find((candidate) => candidate === body?.error) ?? "unknown";
    throw new FundsError(
      code,
      typeof body?.message === "string" ? body.message : FUNDS_ERROR_COPY.unknown,
    );
  }
  return body;
}

const ERROR_CODES: readonly FundsErrorCode[] = [
  "forbidden",
  "not_found",
  "validation",
  "unauthorized",
  "unconfigured",
  "unknown",
];

/**
 * F-109 wiring: the split of a booking total. The database owns the 70/30 rule and the fees, so
 * this asks it rather than repeating the arithmetic here.
 */
export async function calculateSplitAllocation(
  totalMinor: number,
  currency: string,
  accessToken: string | null,
): Promise<SplitAllocation> {
  const body = (await call("/api/funds/allocate", accessToken, {
    method: "POST",
    body: { total_minor: totalMinor, currency },
  })) as SplitAllocation | null;
  if (!body || typeof body.release_70 !== "number" || typeof body.release_30 !== "number") {
    throw new FundsError("unknown", "invalid_split_response");
  }
  return body;
}

/** What the console shows. Every read is the database's own projection. */
export interface FundsApi {
  balances(): Promise<RecoveryFundBalance[]>;
  actions(status?: string): Promise<RecoveryActionRow[]>;
  caseContext(caseId: string): Promise<RecoveryCaseContext>;
  ledger(poolId: string): Promise<FundPoolLedgerEntry[]>;
  duePools(): Promise<DueFundPool[]>;
  allocate(totalMinor: number, currency: string): Promise<SplitAllocation>;
  release(bookingId: string): Promise<string>;
  requestRecovery(input: {
    kind: "clawback" | "advance";
    case_id: string;
    amount_minor?: number;
    replacement_cost_minor?: number;
    reason: string;
  }): Promise<string>;
  decide(input: {
    action_id: string;
    decision: "approved" | "refused" | "void";
    note?: string;
    reason?: string;
  }): Promise<string>;
  settle(actionId: string): Promise<{ outcome: string; provider_reference?: string | undefined }>;
  reconcile(): Promise<ReconciliationReport>;
}

/** The token reader is injected so the console can be rendered in tests without an auth provider. */
export function createFundsApi(getAccessToken: () => Promise<string | null>): FundsApi {
  return {
    balances: () => rpc<RecoveryFundBalance[]>("recovery_fund_balances", {}),
    actions: (status) =>
      rpc<RecoveryActionRow[]>("list_recovery_actions", status ? { p_status: status } : {}),
    caseContext: async (caseId) => {
      const rows = await rpc<RecoveryCaseContext[]>("recovery_case_context", { p_case: caseId });
      const row = rows[0];
      if (!row) throw new FundsError("not_found", "case_not_found");
      return row;
    },
    ledger: (poolId) => rpc<FundPoolLedgerEntry[]>("fund_pool_ledger_entries", { p_pool: poolId }),
    duePools: () => rpc<DueFundPool[]>("due_fund_pools", {}),
    allocate: async (totalMinor, currency) =>
      calculateSplitAllocation(totalMinor, currency, await getAccessToken()),
    release: async (bookingId) => {
      const body = (await call("/api/funds/release", await getAccessToken(), {
        method: "POST",
        body: { booking_id: bookingId },
      })) as { outcome?: unknown } | null;
      if (!body || typeof body.outcome !== "string") {
        throw new FundsError("unknown", "invalid_release_response");
      }
      return body.outcome;
    },
    requestRecovery: async (input) => {
      const body = (await call("/api/funds/recovery", await getAccessToken(), {
        method: "POST",
        body: input,
      })) as { action_id?: unknown } | null;
      if (!body || typeof body.action_id !== "string") {
        throw new FundsError("unknown", "invalid_recovery_response");
      }
      return body.action_id;
    },
    decide: async (input) => {
      const body = (await call("/api/funds/approvals", await getAccessToken(), {
        method: "POST",
        body: input,
      })) as { outcome?: unknown } | null;
      if (!body || typeof body.outcome !== "string") {
        throw new FundsError("unknown", "invalid_decision_response");
      }
      return body.outcome;
    },
    settle: async (actionId) => {
      const body = (await call("/api/funds/settle", await getAccessToken(), {
        method: "POST",
        body: { action_id: actionId },
      })) as { outcome?: unknown; provider_reference?: unknown } | null;
      if (!body || typeof body.outcome !== "string") {
        throw new FundsError("unknown", "invalid_settle_response");
      }
      return {
        outcome: body.outcome,
        provider_reference:
          typeof body.provider_reference === "string" ? body.provider_reference : undefined,
      };
    },
    reconcile: async () => {
      const body = (await call("/api/funds/reconcile", await getAccessToken(), {
        method: "POST",
        body: {},
      })) as ReconciliationReport | null;
      if (!body || typeof body.events_checked !== "number") {
        throw new FundsError("unknown", "invalid_reconciliation_response");
      }
      return {
        events_checked: body.events_checked,
        pools_checked: body.pools_checked,
        matched: body.matched,
        exception_count: body.exception_count,
        exceptions: Array.isArray(body.exceptions) ? body.exceptions : [],
      };
    },
  };
}
