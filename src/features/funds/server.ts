/**
 * F-109 server-only boundary for the recovery fund console.
 *
 * Every rule about who may do what lives in the database, and the caller's own token is forwarded
 * so the database decides. The two places the platform acts as itself — paying an advance, and
 * running a reconciliation — go through the payment router, which is the only place in this app
 * that may move money.
 *
 * The browser never sends an amount the platform then believes: the split, the advance and the
 * clawback are all worked out by the database, and the provider's reference for the money that was
 * sent to a host never comes from the browser either.
 */
import { callAsCaller, callerToken } from "@/lib/db/caller.server";
import {
  PaymentRouterError,
  reconcileLedger,
  sendRefund,
  settleRecoveryAction,
} from "@/lib/payments/router.server";
import {
  actionRequestSchema,
  classifyFundsError,
  recoveryDecisionSchema,
  recoveryRequestSchema,
  releaseRequestSchema,
  refusalCopyFor,
  splitRequestSchema,
  type ReconciliationReport,
} from "./contracts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const UNCONFIGURED = {
  error: "unconfigured",
  message: "Sign-in is not configured in this environment, so the recovery console stays locked.",
};

/** The database's own refusal, turned into what the browser is told. Raw text is not returned. */
async function failure(res: Response): Promise<Response> {
  let code = "";
  let message = "";
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    code = String(body.code ?? "");
    message = String(body.message ?? "");
  } catch {
    code = "";
    message = "";
  }
  const errorCode = classifyFundsError(message);
  const copy = refusalCopyFor(message);
  if (errorCode === "forbidden") {
    return json({ error: "forbidden", message: "This console is for platform staff." }, 403);
  }
  if (errorCode === "not_found") {
    return json({ error: "not_found", message: copy ?? "We could not find that." }, 404);
  }
  if (errorCode === "validation") {
    return json({ error: "validation", message: copy ?? "Check the details and try again." }, 400);
  }
  if (errorCode === "unauthorized") {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }
  if (errorCode === "unconfigured") {
    return json(
      { error: "unconfigured", message: "The recovery fund is not set up here yet." },
      503,
    );
  }
  console.error("funds rpc failed", res.status, code);
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

/** The platform's own refusal, turned into what the browser is told. */
function routerFailure(error: unknown): Response {
  if (error instanceof PaymentRouterError) {
    if (error.code === "unconfigured") {
      return json(
        {
          error: "unconfigured",
          message: "The recovery fund is not set up in this environment yet.",
        },
        503,
      );
    }
    if (error.code === "not_found") {
      return json({ error: "not_found", message: "We could not find that recovery request." }, 404);
    }
    if (error.code === "validation") {
      return json(
        {
          error: "validation",
          message: refusalCopyFor(error.message) ?? "Check the details and try again.",
        },
        400,
      );
    }
    if (error.code === "refused") {
      return json({ error: "forbidden", message: "This console is for platform staff." }, 403);
    }
  }
  console.error("payment router failed", error instanceof Error ? error.message : "unknown");
  return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
}

/** The body a person typed, read once. */
async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

/**
 * The platform's recovery fund wallet: where the money that was taken back is held. It is
 * configuration, so the browser never chooses it and never sees it.
 */
export function recoveryFundWalletId(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env["FUND_POOL_WALLET_ID"]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// POST /api/funds/allocate — the split of a booking total
// ---------------------------------------------------------------------------
/**
 * The database owns the 70/30 rule and the fees of each tranche, so the app asks it rather than
 * repeating the arithmetic. Nothing here moves money: it is what the money would be split into.
 */
export async function allocateSplitAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  const body = await readBody(request);
  if (!body.ok) {
    return json({ error: "validation", message: "Enter the amount to split." }, 400);
  }
  const parsed = splitRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Enter the amount to split.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("calculate_split_allocation", token, {
      p_total_minor: parsed.data.total_minor,
      p_currency: parsed.data.currency.toUpperCase(),
    });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const rows = (await res.json()) as Record<string, unknown>[];
  const split = rows[0];
  if (!split) {
    return json({ error: "unknown", message: "Something went wrong. Try again in a moment." }, 502);
  }
  return json(split, 200);
}

// ---------------------------------------------------------------------------
// POST /api/funds/release — the last tranche of a booking whose window closed
// ---------------------------------------------------------------------------
/**
 * This is not a discretionary fund action: the rules decide whether the money may go out, and the
 * database says what happened. A person only asks.
 */
export async function releaseTrancheAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  const body = await readBody(request);
  if (!body.ok) {
    return json({ error: "validation", message: "That booking link is not valid." }, 400);
  }
  const parsed = releaseRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "That booking link is not valid.",
      },
      400,
    );
  }

  let res: Response;
  try {
    res = await callAsCaller("release_due_tranche", token, { p_booking: parsed.data.booking_id });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const outcome = (await res.json()) as string;
  return json({ outcome }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/funds/recovery — asking for money to move
// ---------------------------------------------------------------------------
/**
 * A clawback takes money back from a vendor that did not deliver; an advance pays a host out of
 * the recovery fund. Both are asked for by staff, and both need two distinct approvals before
 * any money moves.
 */
export async function requestRecoveryAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  const body = await readBody(request);
  if (!body.ok) {
    return json({ error: "validation", message: "Say why this money should move." }, 400);
  }
  const parsed = recoveryRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "Say why this money should move.",
      },
      400,
    );
  }

  const wallet = recoveryFundWalletId();
  if (!wallet) {
    return json(
      {
        error: "unconfigured",
        message: "The recovery fund has no wallet in this environment yet.",
      },
      503,
    );
  }

  const rpc =
    parsed.data.kind === "advance" ? "request_recovery_advance" : "request_recovery_clawback";
  const payload =
    parsed.data.kind === "advance"
      ? {
          p_case: parsed.data.case_id,
          p_replacement_cost_minor: parsed.data.replacement_cost_minor,
          p_reason: parsed.data.reason,
          p_fund_wallet: wallet,
        }
      : {
          p_case: parsed.data.case_id,
          p_amount_minor: parsed.data.amount_minor,
          p_reason: parsed.data.reason,
          p_fund_wallet: wallet,
        };

  let res: Response;
  try {
    res = await callAsCaller(rpc, token, payload);
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const actionId = (await res.json()) as string;
  return json({ action_id: actionId }, 201);
}

// ---------------------------------------------------------------------------
// POST /api/funds/approvals — one staff member's decision
// ---------------------------------------------------------------------------
/**
 * Two distinct staff with a finance grant must approve a recovery action before it may settle,
 * and the person who asked for it may not be one of them. The database counts the approvals; this
 * only forwards the decision.
 */
export async function decideRecoveryAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  const body = await readBody(request);
  if (!body.ok) {
    return json({ error: "validation", message: "That decision could not be read." }, 400);
  }
  const parsed = recoveryDecisionSchema.safeParse(body.value);
  if (!parsed.success) {
    return json(
      {
        error: "validation",
        message: parsed.error.issues[0]?.message ?? "That decision could not be read.",
      },
      400,
    );
  }

  const rpc = parsed.data.decision === "void" ? "void_recovery_action" : "approve_recovery_action";
  const payload =
    parsed.data.decision === "void"
      ? { p_action: parsed.data.action_id, p_reason: parsed.data.reason ?? "" }
      : {
          p_action: parsed.data.action_id,
          p_decision: parsed.data.decision,
          p_note: parsed.data.note ?? null,
        };

  let res: Response;
  try {
    res = await callAsCaller(rpc, token, payload);
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!res.ok) return failure(res);

  const outcome = (await res.json()) as string;
  return json({ outcome }, 200);
}

// ---------------------------------------------------------------------------
// POST /api/funds/settle — the money moves
// ---------------------------------------------------------------------------
interface PayoutTarget {
  action_id: string;
  kind: string;
  status: string;
  amount_minor: number;
  currency: string;
  available_minor: number;
  payment_reference: string | null;
  ready: boolean;
}

/**
 * The money leaves the provider first, and the ledger follows it. A clawback needs no provider
 * call: the money stays with the provider and is simply not paid out to the vendor. An advance
 * sends the host a partial refund of the charge they paid, and the provider's own reference for
 * it is recorded, so the webhook that follows settles nothing twice.
 *
 * The database is asked first what is owed and whether the fund can still cover it. If the fund
 * ran short after the approval, nothing is sent to the host.
 */
export async function settleRecoveryAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  const body = await readBody(request);
  if (!body.ok) {
    return json({ error: "validation", message: "That request link is not valid." }, 400);
  }
  const parsed = actionRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return json({ error: "validation", message: "That request link is not valid." }, 400);
  }
  const actionId = parsed.data.action_id;

  let targetRes: Response;
  try {
    targetRes = await callAsCaller("recovery_payout_target", token, { p_action: actionId });
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!targetRes.ok) return failure(targetRes);

  const target = ((await targetRes.json()) as PayoutTarget[])[0];
  if (!target) {
    return json({ error: "not_found", message: "We could not find that recovery request." }, 404);
  }
  if (!target.ready) {
    if (target.status !== "approved") {
      return json({ error: "validation", message: "Two staff have not approved this yet." }, 400);
    }
    if (target.available_minor < target.amount_minor) {
      return json(
        {
          error: "validation",
          message: "The recovery fund cannot cover this, so it has gone to the people who decide.",
        },
        400,
      );
    }
    return json(
      { error: "validation", message: "This booking has no payment to send the money back from." },
      400,
    );
  }

  let providerReference: string | null = null;
  if (target.kind === "advance") {
    if (!target.payment_reference) {
      return json(
        {
          error: "validation",
          message: "This booking has no payment to send the money back from.",
        },
        400,
      );
    }
    try {
      const refunded = await sendRefund({
        reference: target.payment_reference,
        amountMinor: target.amount_minor,
        reason: "Recovery advance for a replacement booking",
      });
      providerReference = refunded.reference;
    } catch (error) {
      return routerFailure(error);
    }
  }

  try {
    const outcome = await settleRecoveryAction(actionId, providerReference);
    return json(
      { outcome, ...(providerReference ? { provider_reference: providerReference } : {}) },
      200,
    );
  } catch (error) {
    if (providerReference) {
      // The provider moved the money and the ledger refused it. The reference is handed back so
      // the movement can be recorded by hand; the reconciliation will say so until it is.
      console.error(
        "recovery settlement refused after the provider moved the money",
        providerReference,
      );
      return json(
        {
          error: "unknown",
          message:
            "The money was sent but the ledger refused to record it. Give the provider reference to finance so it can be recorded by hand.",
          provider_reference: providerReference,
        },
        502,
      );
    }
    return routerFailure(error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/funds/reconcile — the provider against the ledger
// ---------------------------------------------------------------------------
/**
 * A reconciliation moves no money and repairs nothing: it says where the provider's record and
 * the ledger disagree, and a person decides. The run itself is the platform's own sweep, so it
 * goes through the payment router; who may ask for it is the database's answer.
 */
export async function reconcileLedgerAsCaller(request: Request): Promise<Response> {
  const token = callerToken(request);
  if (!token) {
    return json({ error: "unauthorized", message: "Sign in to open the recovery console." }, 401);
  }

  let gate: Response;
  try {
    gate = await callAsCaller("can_run_reconciliation", token, {});
  } catch {
    return json(UNCONFIGURED, 503);
  }
  if (!gate.ok) return failure(gate);

  const allowed = await gate.json();
  const mayRun = Array.isArray(allowed) ? allowed[0] === true : allowed === true;
  if (!mayRun) {
    return json({ error: "forbidden", message: "This console is for platform staff." }, 403);
  }

  let report: Record<string, unknown>;
  try {
    report = await reconcileLedger();
  } catch (error) {
    return routerFailure(error);
  }

  const exceptions = Array.isArray(report["exceptions"]) ? report["exceptions"] : [];
  const body: ReconciliationReport = {
    events_checked: Number(report["events_checked"] ?? 0),
    pools_checked: Number(report["pools_checked"] ?? 0),
    matched: Number(report["matched"] ?? 0),
    exception_count: Number(report["exception_count"] ?? exceptions.length),
    exceptions: exceptions as ReconciliationReport["exceptions"],
  };
  return json(body, 200);
}
