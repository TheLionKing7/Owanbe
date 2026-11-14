import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, minorUnitsFor, toMinorUnits } from "@/lib/payments/currency";
import { createFundsApi, fundsErrorMessage, type FundsApi } from "./api";
import {
  RECOVERY_KIND_LABELS,
  RECOVERY_MOVEMENT_LABELS,
  RECOVERY_STATUS_LABELS,
  REQUIRED_RECOVERY_APPROVALS,
  type DueFundPool,
  type FundPoolLedgerEntry,
  type ReconciliationReport,
  type RecoveryActionRow,
  type RecoveryCaseContext,
  type RecoveryFundBalance,
  type SplitAllocation,
} from "./contracts";

interface FundsPanelProps {
  /** Injected in tests; defaults to the authorized projections and the app's own routes. */
  api?: FundsApi | undefined;
  /** The caller's token decides what they may see and do; the server never acts as them. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

const NO_TOKEN = async (): Promise<string | null> => null;

function deadlineLabel(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** The amount in the currency's minor unit, or null when the currency is not one we know. */
function toMinor(major: number, currency: string): number | null {
  if (!Number.isFinite(major)) return null;
  return toMinorUnits(major, currency);
}

export function FundsPanel({ api, getAccessToken }: FundsPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createFundsApi(readToken), [api, readToken]);

  const [balances, setBalances] = useState<RecoveryFundBalance[] | null>(null);
  const [actions, setActions] = useState<RecoveryActionRow[] | null>(null);
  const [duePools, setDuePools] = useState<DueFundPool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [caseId, setCaseId] = useState("");
  const [context, setContext] = useState<RecoveryCaseContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [trail, setTrail] = useState<FundPoolLedgerEntry[] | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  const [kind, setKind] = useState<"clawback" | "advance">("clawback");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const [splitTotal, setSplitTotal] = useState("");
  const [splitCurrency, setSplitCurrency] = useState("NGN");
  const [split, setSplit] = useState<SplitAllocation | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [money, requests, waiting] = await Promise.all([
        client.balances(),
        client.actions(),
        client.duePools(),
      ]);
      setBalances(money);
      setActions(requests);
      setDuePools(waiting);
    } catch (caught) {
      setBalances(null);
      setActions(null);
      setDuePools(null);
      setLoadError(fundsErrorMessage(caught));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      return await work();
    } catch (caught) {
      setActionError(fundsErrorMessage(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function lookupCase() {
    setContextError(null);
    setTrailError(null);
    setContext(null);
    setTrail(null);
    const trimmed = caseId.trim();
    if (!trimmed) {
      setContextError("Paste the id of the case this money is about.");
      return;
    }
    let row: RecoveryCaseContext;
    try {
      row = await client.caseContext(trimmed);
      setContext(row);
    } catch (caught) {
      setContextError(fundsErrorMessage(caught));
      return;
    }
    // The trail of the recovery money for the pool. It is read on its own, so a failure here does
    // not hide the case.
    try {
      setTrail(await client.ledger(row.pool_id));
    } catch (caught) {
      setTrailError(fundsErrorMessage(caught));
    }
  }

  async function askForMoney() {
    const minor = toMinor(Number(amount), context?.currency ?? "NGN");
    if (minor === null || minor < 1) {
      setActionError("Enter an amount above zero.");
      return;
    }
    await run(async () => {
      await client.requestRecovery({
        kind,
        case_id: context?.case_id ?? caseId.trim(),
        ...(kind === "clawback" ? { amount_minor: minor } : { replacement_cost_minor: minor }),
        reason: reason.trim(),
      });
      setAmount("");
      setReason("");
      await load();
      setNotice("The request is recorded. Two staff must approve it before any money moves.");
    });
  }

  async function decide(action: RecoveryActionRow, decision: "approved" | "refused" | "void") {
    await run(async () => {
      const outcome = await client.decide({
        action_id: action.action_id,
        decision,
        ...(decision === "void" ? { reason: "Withdrawn by staff" } : {}),
      });
      await load();
      setNotice(
        decision === "approved"
          ? outcome === "approved"
            ? "Two staff have approved this. It may now be settled."
            : "Your approval is recorded. One more staff member must approve it."
          : decision === "refused"
            ? "The request has been refused."
            : "The request has been withdrawn. No money moved.",
      );
    });
  }

  async function settle(action: RecoveryActionRow) {
    await run(async () => {
      const result = await client.settle(action.action_id);
      await load();
      setNotice(
        result.outcome === "settled"
          ? `The money has moved and the ledger records it${
              result.provider_reference ? ` (${result.provider_reference})` : ""
            }.`
          : "The ledger did not settle it.",
      );
    });
  }

  async function release(pool: DueFundPool) {
    await run(async () => {
      const outcome = await client.release(pool.booking_id);
      await load();
      setNotice(
        outcome === "released"
          ? "The last 30% has gone out to the vendor."
          : outcome === "frozen"
            ? "This money is on hold while a dispute is open, so nothing went out."
            : outcome === "not_due"
              ? "The completion window has not closed yet, so nothing went out."
              : outcome === "already_released"
                ? "This last payment has already gone out."
                : "Nothing went out.",
      );
    });
  }

  async function showSplit() {
    setSplitError(null);
    const minor = toMinor(Number(splitTotal), splitCurrency);
    if (minor === null || minor < 1) {
      setSplitError("Enter an amount above zero.");
      return;
    }
    try {
      setSplit(await client.allocate(minor, splitCurrency));
    } catch (caught) {
      setSplitError(fundsErrorMessage(caught));
    }
  }

  async function reconcile() {
    setReportError(null);
    try {
      setReport(await client.reconcile());
    } catch (caught) {
      setReportError(fundsErrorMessage(caught));
    }
  }

  return (
    <div className="space-y-6" data-testid="funds-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold text-plum-950">Recovery fund</h2>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-3 text-sm"
          onClick={() => void load()}
          data-testid="funds-refresh"
        >
          Refresh
        </button>
      </div>

      {loadError && (
        <section role="alert" className="surface p-6" data-testid="funds-error">
          <h3 className="font-display text-xl font-bold text-plum-950">
            We could not open the recovery console
          </h3>
          <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
          <button
            type="button"
            className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}

      {balances === null && !loadError && (
        <p role="status" className="surface p-6 text-sm text-ink-muted" data-testid="funds-loading">
          Loading the recovery fund…
        </p>
      )}

      {balances !== null && (
        <section aria-labelledby="fund-balances" className="space-y-3">
          <h3 id="fund-balances" className="font-display text-lg font-bold text-plum-950">
            What the fund holds
          </h3>
          {balances.length === 0 ? (
            <p className="surface p-4 text-sm text-ink-muted" data-testid="funds-empty">
              Nothing has been taken back yet, so the recovery fund is empty.
            </p>
          ) : (
            <ul className="space-y-3">
              {balances.map((balance) => (
                <li key={balance.currency} className="surface p-4">
                  <p className="text-sm font-semibold text-ink">
                    {formatMoney(balance.balance_minor, balance.currency)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {formatMoney(balance.clawed_back_minor, balance.currency)} taken back ·{" "}
                    {formatMoney(balance.advanced_minor, balance.currency)} advanced ·{" "}
                    {balance.open_actions} open{" "}
                    {balance.open_actions === 1 ? "request" : "requests"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {actions !== null && (
        <section aria-labelledby="fund-actions" className="space-y-3">
          <h3 id="fund-actions" className="font-display text-lg font-bold text-plum-950">
            Recovery requests
          </h3>
          {actions.length === 0 ? (
            <p className="surface p-4 text-sm text-ink-muted" data-testid="fund-actions-empty">
              No money has been asked for. A request appears here the moment staff ask for it.
            </p>
          ) : (
            <ul className="space-y-3">
              {actions.map((action) => (
                <li key={action.action_id} className="surface p-4" data-testid="recovery-action">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {RECOVERY_KIND_LABELS[action.kind] ?? action.kind} ·{" "}
                        {formatMoney(action.amount_minor, action.currency)}
                      </p>
                      <p className="text-sm text-ink-muted">{action.reference}</p>
                      <p className="text-sm text-ink-muted">
                        {action.case_reference} · {action.requested_by_name || "Staff"} asked for
                        this
                      </p>
                      <p className="text-sm text-ink-subtle">
                        {`${RECOVERY_STATUS_LABELS[action.status] ?? action.status} · ${action.approvals} of ${REQUIRED_RECOVERY_APPROVALS} approvals`}
                      </p>
                      <p className="text-sm text-ink-subtle">{action.reason}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {action.status === "requested" && (
                        <>
                          <button
                            type="button"
                            className="btn-primary min-h-[44px] px-4 py-2 text-sm"
                            disabled={busy}
                            onClick={() => void decide(action, "approved")}
                            data-testid="approve-action"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                            disabled={busy}
                            onClick={() => void decide(action, "refused")}
                            data-testid="refuse-action"
                          >
                            Refuse
                          </button>
                        </>
                      )}
                      {action.status === "approved" && (
                        <button
                          type="button"
                          className="btn-primary min-h-[44px] px-4 py-2 text-sm"
                          disabled={busy}
                          onClick={() => void settle(action)}
                          data-testid="settle-action"
                        >
                          Move the money
                        </button>
                      )}
                      {(action.status === "requested" || action.status === "approved") && (
                        <button
                          type="button"
                          className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                          disabled={busy}
                          onClick={() => void decide(action, "void")}
                          data-testid="void-action"
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {duePools !== null && (
        <section aria-labelledby="fund-due" className="space-y-3">
          <h3 id="fund-due" className="font-display text-lg font-bold text-plum-950">
            Waiting for their last payment
          </h3>
          {duePools.length === 0 ? (
            <p className="surface p-4 text-sm text-ink-muted" data-testid="fund-due-empty">
              No booking is waiting for its last payment.
            </p>
          ) : (
            <ul className="space-y-3">
              {duePools.map((pool) => (
                <li key={pool.pool_id} className="surface p-4">
                  <p className="text-sm font-semibold text-ink">
                    {formatMoney(pool.held_minor, pool.currency)} held
                  </p>
                  <p className="text-sm text-ink-muted">
                    {deadlineLabel(pool.release_30_due_at) ?? "The window has closed"}
                  </p>
                  {pool.frozen && (
                    <p className="text-sm font-semibold text-owanbe-vibrant-red">
                      On hold while a dispute is open
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-outline mt-3 min-h-[44px] px-4 py-2 text-sm"
                    disabled={busy}
                    onClick={() => void release(pool)}
                    data-testid="release-pool"
                  >
                    Release the last 30%
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="fund-ask" className="surface space-y-3 p-6">
        <h3 id="fund-ask" className="font-display text-lg font-bold text-plum-950">
          Ask for money to move
        </h3>
        <label htmlFor="fund-case" className="block text-sm font-semibold text-ink">
          Case id
        </label>
        <input
          id="fund-case"
          value={caseId}
          onChange={(event) => setCaseId(event.target.value)}
          placeholder="The id of the dispute this money is about"
          className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
          data-testid="fund-case-id"
        />
        <button
          type="button"
          className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
          onClick={() => void lookupCase()}
          data-testid="fund-case-lookup"
        >
          Look up the case
        </button>
        {contextError && (
          <p role="alert" className="text-sm text-owanbe-vibrant-red" data-testid="fund-case-error">
            {contextError}
          </p>
        )}
        {context && (
          <div
            className="mt-2 rounded-2xl bg-muted p-4 text-sm text-ink"
            data-testid="fund-case-context"
          >
            <p className="font-semibold">{context.case_reference}</p>
            <p className="mt-1">
              {formatMoney(context.paid_minor, context.currency)} was paid on this booking
            </p>
            <p className="mt-1">
              The platform still owes the vendor{" "}
              {formatMoney(context.vendor_payable_minor, context.currency)}
            </p>
            <p className="mt-1">
              The recovery fund holds {formatMoney(context.fund_balance_minor, context.currency)}
            </p>
            {trailError && (
              <p role="alert" className="mt-1 text-owanbe-vibrant-red" data-testid="fund-trail-error">
                {trailError}
              </p>
            )}
            {trail !== null && (
              <div className="mt-2" data-testid="fund-trail">
                <p className="font-semibold">The recovery money that has moved</p>
                {trail.length === 0 ? (
                  <p className="mt-1">Nothing has been taken back or advanced on this booking yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {trail.map((entry, index) => (
                      <li key={`${entry.created_at}-${index}`}>
                        {RECOVERY_MOVEMENT_LABELS[entry.movement] ?? entry.movement} ·{" "}
                        {formatMoney(entry.amount_minor, entry.currency)} ·{" "}
                        {deadlineLabel(entry.created_at) ?? entry.created_at}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">What are you asking for?</legend>
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="fund-kind"
              value="clawback"
              checked={kind === "clawback"}
              onChange={() => setKind("clawback")}
              data-testid="fund-kind-clawback"
            />
            Take money back from the vendor
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="fund-kind"
              value="advance"
              checked={kind === "advance"}
              onChange={() => setKind("advance")}
              data-testid="fund-kind-advance"
            />
            Advance half of a replacement booking to the host
          </label>
        </fieldset>

        <label htmlFor="fund-amount" className="mt-4 block text-sm font-semibold text-ink">
          {kind === "clawback" ? "Amount to take back" : "What the replacement booking costs"}
        </label>
        <input
          id="fund-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
          data-testid="fund-amount"
        />
        {context && minorUnitsFor(context.currency) !== null && (
          <p className="mt-1 text-sm text-ink-subtle">
            In {context.currency}.{" "}
            {kind === "clawback"
              ? "The platform will not take back more than it still owes the vendor."
              : "Half of this is advanced to the host, and only what the fund holds can be advanced."}
          </p>
        )}

        <label htmlFor="fund-reason" className="mt-4 block text-sm font-semibold text-ink">
          Why should this money move?
        </label>
        <input
          id="fund-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="The vendor did not deliver on the day"
          className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
          data-testid="fund-reason"
        />

        <button
          type="button"
          className="btn-primary mt-4 min-h-[44px] px-5 py-2 text-sm"
          disabled={busy || reason.trim().length < 3}
          onClick={() => void askForMoney()}
          data-testid="fund-ask-submit"
        >
          Ask for this money
        </button>
        <p className="mt-2 text-sm text-ink-subtle">
          Asking moves nothing. {REQUIRED_RECOVERY_APPROVALS} staff with a finance grant must
          approve it first, and the person who asked may not be one of them.
        </p>
      </section>

      <section aria-labelledby="fund-split" className="surface space-y-3 p-6">
        <h3 id="fund-split" className="font-display text-lg font-bold text-plum-950">
          How a booking total is split
        </h3>
        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor="fund-split-total" className="block text-sm font-semibold text-ink">
              Booking total
            </label>
            <input
              id="fund-split-total"
              value={splitTotal}
              onChange={(event) => setSplitTotal(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="mt-1 w-40 rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="fund-split-total"
            />
          </div>
          <div>
            <label htmlFor="fund-split-currency" className="block text-sm font-semibold text-ink">
              Currency
            </label>
            <input
              id="fund-split-currency"
              value={splitCurrency}
              onChange={(event) => setSplitCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              className="mt-1 w-24 rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="fund-split-currency"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-4 py-2 text-sm"
          onClick={() => void showSplit()}
          data-testid="fund-split-submit"
        >
          Show the split
        </button>
        {splitError && (
          <p
            role="alert"
            className="text-sm text-owanbe-vibrant-red"
            data-testid="fund-split-error"
          >
            {splitError}
          </p>
        )}
        {split && (
          <dl className="grid gap-2 sm:grid-cols-2" data-testid="fund-split">
            <div>
              <dt className="text-sm text-ink-muted">First release (70%)</dt>
              <dd className="text-sm font-semibold text-ink">
                {formatMoney(split.release_70, splitCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Final release (30%)</dt>
              <dd className="text-sm font-semibold text-ink">
                {formatMoney(split.release_30, splitCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Vendor receives, first release</dt>
              <dd className="text-sm font-semibold text-ink">
                {formatMoney(split.vendor_net_70, splitCurrency)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Vendor receives, final release</dt>
              <dd className="text-sm font-semibold text-ink">
                {formatMoney(split.vendor_net_30, splitCurrency)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="fund-reconcile" className="surface space-y-3 p-6">
        <h3 id="fund-reconcile" className="font-display text-lg font-bold text-plum-950">
          Reconciliation
        </h3>
        <p className="text-sm text-ink-muted">
          The provider's events against the ledger. A run moves no money and repairs nothing: it
          writes down what disagrees, and a person decides.
        </p>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-4 py-2 text-sm"
          onClick={() => void reconcile()}
          data-testid="fund-reconcile"
        >
          Run the reconciliation
        </button>
        {reportError && (
          <p
            role="alert"
            className="text-sm text-owanbe-vibrant-red"
            data-testid="fund-reconcile-error"
          >
            {reportError}
          </p>
        )}
        {report && (
          <div data-testid="fund-reconcile-report">
            <p className="text-sm text-ink">
              {report.events_checked} provider events checked · {report.pools_checked} pools checked
              · {report.matched} matched · {report.exception_count} exceptions
            </p>
            {report.exceptions.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.exceptions.map((exception, index) => (
                  <li key={`${exception.code}-${index}`} className="text-sm text-ink">
                    {exception.code}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {notice && (
        <p role="status" className="text-sm font-semibold text-ink" data-testid="fund-notice">
          {notice}
        </p>
      )}
      {actionError && (
        <p
          role="alert"
          className="text-sm font-semibold text-owanbe-vibrant-red"
          data-testid="fund-action-error"
        >
          {actionError}
        </p>
      )}
    </div>
  );
}
