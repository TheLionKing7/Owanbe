import { useCallback, useEffect, useMemo, useState } from "react";
import type { HouseSummary } from "@/lib/auth/types";
import {
  TicketError,
  createTicketsApi,
  ticketErrorMessage,
  type AuthenticatedRpc,
  type TicketsApi,
} from "./api";
import {
  INVITATION_STATUS_COPY,
  RESULT_COPY,
  claimLimitCopy,
  inviteLink,
  type ClaimLimit,
  type HostCheckin,
  type HostInvitation,
  type IssuedInvitation,
  type ScannerGrant,
} from "./contracts";
import { pairingCode } from "./pairing";

export interface InvitationsPanelProps {
  house: HouseSummary;
  /** The caller's own database session; the database decides what it may do. */
  rpc: AuthenticatedRpc;
  /** Injected in tests; defaults to the authorized database functions. */
  api?: TicketsApi | undefined;
}

function defaultDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The last moment of the chosen day, in UTC, so the deadline means the same everywhere. */
function endOfDay(value: string): string | null {
  const date = new Date(`${value}T23:59:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function absoluteLink(token: string): string {
  const path = inviteLink(token);
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/**
 * The host's side of ticketing: issue the links, take them back when something goes wrong, hand a
 * door device to the person who will use it, and read the record the door leaves behind.
 *
 * Nothing here grants access on its own: every write is a database function that re-checks that
 * the caller hosts the guest list.
 */
export function InvitationsPanel({ house, rpc, api }: InvitationsPanelProps) {
  const client = useMemo(() => api ?? createTicketsApi(rpc), [api, rpc]);

  const [lists, setLists] = useState<Awaited<ReturnType<TicketsApi["lists"]>> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<HostInvitation[] | null>(null);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [grants, setGrants] = useState<ScannerGrant[] | null>(null);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [checkins, setCheckins] = useState<HostCheckin[] | null>(null);
  const [checkinsError, setCheckinsError] = useState<string | null>(null);

  const [claimLimit, setClaimLimit] = useState<ClaimLimit>(1);
  const [claimDeadline, setClaimDeadline] = useState(() => defaultDate(14));
  const [admissionExpiry, setAdmissionExpiry] = useState(() => defaultDate(60));
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  const [deviceId, setDeviceId] = useState("");
  const [granteeEmail, setGranteeEmail] = useState("");
  const [grantExpiry, setGrantExpiry] = useState(() => defaultDate(7));
  const [grantError, setGrantError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const [copiedGrant, setCopiedGrant] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setListError(null);
    try {
      const rows = await client.lists(house.house_id);
      setLists(rows);
      setSelected((current) => current ?? rows[0]?.list_id ?? null);
    } catch (caught) {
      setLists(null);
      setListError(ticketErrorMessage(caught));
    }
  }, [client, house.house_id]);

  const loadList = useCallback(
    async (listId: string) => {
      setInvitationsError(null);
      setGrantsError(null);
      setCheckinsError(null);
      try {
        setInvitations(await client.invitations(listId));
      } catch (caught) {
        setInvitations(null);
        setInvitationsError(ticketErrorMessage(caught));
      }
      try {
        setGrants(await client.scannerGrants(listId));
      } catch (caught) {
        setGrants(null);
        setGrantsError(ticketErrorMessage(caught));
      }
      try {
        setCheckins(await client.checkins(listId));
      } catch (caught) {
        setCheckins(null);
        setCheckinsError(ticketErrorMessage(caught));
      }
    },
    [client],
  );

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (selected) void loadList(selected);
    else {
      setInvitations(null);
      setGrants(null);
      setCheckins(null);
    }
  }, [selected, loadList]);

  async function issue() {
    setIssueError(null);
    const claimDeadlineAt = endOfDay(claimDeadline);
    const admissionExpiresAt = endOfDay(admissionExpiry);
    if (!claimDeadlineAt || !admissionExpiresAt) {
      setIssueError("Choose the last day to claim and the day the card stops working.");
      return;
    }
    if (new Date(admissionExpiresAt) < new Date(claimDeadlineAt)) {
      setIssueError("The card must stop working on or after the last day to claim.");
      return;
    }
    setIssuing(true);
    try {
      const result = await client.issue({
        guest_list_id: selected ?? "",
        claim_limit: claimLimit,
        claim_deadline: claimDeadlineAt,
        admission_expires_at: admissionExpiresAt,
      });
      setIssued(result);
      setCopied(false);
      await loadList(selected ?? "");
    } catch (caught) {
      if (caught instanceof TicketError && caught.code === "stale_version")
        await loadList(selected ?? "");
      setIssueError(ticketErrorMessage(caught));
    } finally {
      setIssuing(false);
    }
  }

  async function reissue(invitation: HostInvitation) {
    setIssueError(null);
    try {
      const result = await client.reissue(invitation.invitation_id, invitation.version);
      setIssued(result);
      setCopied(false);
      await loadList(selected ?? "");
    } catch (caught) {
      setIssueError(ticketErrorMessage(caught));
    }
  }

  async function revoke(invitation: HostInvitation) {
    setIssueError(null);
    try {
      await client.revoke(invitation.invitation_id, invitation.version);
      await loadList(selected ?? "");
    } catch (caught) {
      setIssueError(ticketErrorMessage(caught));
    }
  }

  async function issueGrant() {
    setGrantError(null);
    const expiresAt = endOfDay(grantExpiry);
    if (!expiresAt) {
      setGrantError("Choose the last day this device may admit guests.");
      return;
    }
    setGranting(true);
    try {
      await client.issueScannerGrant({
        guest_list_id: selected ?? "",
        device_id: deviceId,
        grantee_email: granteeEmail,
        expires_at: expiresAt,
      });
      setDeviceId("");
      setGranteeEmail("");
      await loadList(selected ?? "");
    } catch (caught) {
      setGrantError(ticketErrorMessage(caught));
    } finally {
      setGranting(false);
    }
  }

  async function revokeGrant(grant: ScannerGrant) {
    setGrantError(null);
    try {
      await client.revokeScannerGrant(grant.grant_id, grant.version);
      await loadList(selected ?? "");
    } catch (caught) {
      setGrantError(ticketErrorMessage(caught));
    }
  }

  return (
    <div className="space-y-6" data-testid="invitations-panel">
      <section className="surface p-5 sm:p-6" aria-labelledby="invitations-title">
        <h2 id="invitations-title" className="font-display text-2xl font-bold text-plum-950">
          Invitations and entry
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          An invitation link is a single secret. You see it once, when you issue it, and the
          platform keeps only a hash of it. Reissue the link to take it back.
        </p>

        {lists === null && !listError && (
          <p role="status" className="mt-4 text-sm text-ink-muted" data-testid="lists-loading">
            Loading your guest lists…
          </p>
        )}
        {listError && (
          <div role="alert" className="mt-4" data-testid="lists-error">
            <p className="text-sm text-ink-muted">{listError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => void loadLists()}
            >
              Try again
            </button>
          </div>
        )}
        {lists !== null && lists.length === 0 && (
          <p className="mt-4 text-sm text-ink-muted" data-testid="lists-empty">
            You have no guest lists yet. Create one first, then come back for an invitation link.
          </p>
        )}
        {lists !== null && lists.length > 0 && (
          <div className="mt-4">
            <label htmlFor="invitation-list" className="block text-sm font-semibold text-ink">
              Guest list
            </label>
            <select
              id="invitation-list"
              value={selected ?? ""}
              onChange={(event) => setSelected(event.target.value || null)}
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="invitation-list"
            >
              {lists.map((list) => (
                <option key={list.list_id} value={list.list_id}>
                  {list.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {selected && (
          <div className="mt-5 space-y-4">
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Who can claim this link?</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {([1, 2] as ClaimLimit[]).map((limit) => (
                  <label key={limit} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="claim-limit"
                      value={limit}
                      checked={claimLimit === limit}
                      onChange={() => setClaimLimit(limit)}
                      data-testid={`claim-limit-${limit}`}
                    />
                    {claimLimitCopy(limit)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="claim-deadline" className="block text-sm font-semibold text-ink">
                  Last day to claim
                </label>
                <input
                  id="claim-deadline"
                  type="date"
                  value={claimDeadline}
                  onChange={(event) => setClaimDeadline(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="claim-deadline"
                />
              </div>
              <div>
                <label htmlFor="admission-expiry" className="block text-sm font-semibold text-ink">
                  Card stops working on
                </label>
                <input
                  id="admission-expiry"
                  type="date"
                  value={admissionExpiry}
                  onChange={(event) => setAdmissionExpiry(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                  data-testid="admission-expiry"
                />
              </div>
            </div>

            {issueError && (
              <p
                role="alert"
                className="text-sm font-semibold text-owanbe-vibrant-red"
                data-testid="issue-error"
              >
                {issueError}
              </p>
            )}
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={issuing}
              onClick={() => void issue()}
              data-testid="issue-invitation"
            >
              {issuing ? "Issuing…" : "Issue invitation link"}
            </button>
          </div>
        )}
      </section>

      {issued && (
        <section
          className="surface p-5 sm:p-6"
          aria-labelledby="issued-title"
          data-testid="issued-link"
        >
          <h3 id="issued-title" className="font-display text-xl font-bold text-plum-950">
            Copy this link now
          </h3>
          <p className="mt-2 text-sm text-ink-muted">
            This is the only time the link is shown. If you lose it, reissue the invitation for a
            fresh one.
          </p>
          <p className="mt-3 break-all rounded-2xl bg-ink-subtle/10 px-4 py-3 font-mono text-xs text-ink">
            {absoluteLink(issued.token)}
          </p>
          <button
            type="button"
            className="btn-outline mt-3 min-h-[44px] px-4 py-2 text-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(absoluteLink(issued.token));
              setCopied(true);
            }}
            data-testid="copy-link"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </section>
      )}

      <section className="surface p-5 sm:p-6" aria-labelledby="issued-list-title">
        <h3 id="issued-list-title" className="font-display text-xl font-bold text-plum-950">
          Links you have issued
        </h3>
        {invitations === null && !invitationsError && (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            Loading your invitations…
          </p>
        )}
        {invitationsError && (
          <div role="alert" className="mt-3" data-testid="invitations-error">
            <p className="text-sm text-ink-muted">{invitationsError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => selected && void loadList(selected)}
            >
              Try again
            </button>
          </div>
        )}
        {invitations !== null && invitations.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted" data-testid="invitations-empty">
            No invitation links yet.
          </p>
        )}
        {invitations !== null && invitations.length > 0 && (
          <ul className="mt-3 space-y-3" data-testid="invitations-list">
            {invitations.map((invitation) => (
              <li key={invitation.invitation_id} className="rounded-2xl bg-ink-subtle/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink" data-testid="invitation-status">
                    {INVITATION_STATUS_COPY[invitation.status]}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {invitation.claimed_count} of {invitation.claim_limit} claimed · link{" "}
                    {invitation.token_fingerprint}… · issued {formatDay(invitation.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Claim by {formatDay(invitation.claim_deadline)} · card stops working{" "}
                  {formatDay(invitation.admission_expires_at)}
                </p>
                {invitation.status !== "revoked" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                      onClick={() => void reissue(invitation)}
                      data-testid="reissue-invitation"
                    >
                      Reissue link
                    </button>
                    <button
                      type="button"
                      className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                      onClick={() => void revoke(invitation)}
                      data-testid="revoke-invitation"
                    >
                      Revoke link
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface p-5 sm:p-6" aria-labelledby="door-title">
        <h3 id="door-title" className="font-display text-xl font-bold text-plum-950">
          The door
        </h3>
        <p className="mt-2 text-sm text-ink-muted">
          Hand one device to the person who will admit guests. The grant names that person and that
          device, and you can take it back at any time.
        </p>

        {selected && (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="device-id" className="block text-sm font-semibold text-ink">
                Device name
              </label>
              <input
                id="device-id"
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                placeholder="Gate phone 1"
                className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="device-id"
              />
            </div>
            <div>
              <label htmlFor="grantee-email" className="block text-sm font-semibold text-ink">
                Who will use it
              </label>
              <input
                id="grantee-email"
                value={granteeEmail}
                onChange={(event) => setGranteeEmail(event.target.value)}
                placeholder="Their Ówàńbè email address"
                className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="grantee-email"
              />
            </div>
            <div>
              <label htmlFor="grant-expiry" className="block text-sm font-semibold text-ink">
                Allowed until
              </label>
              <input
                id="grant-expiry"
                type="date"
                value={grantExpiry}
                onChange={(event) => setGrantExpiry(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="grant-expiry"
              />
            </div>
            {grantError && (
              <p
                role="alert"
                className="text-sm font-semibold text-owanbe-vibrant-red"
                data-testid="grant-error"
              >
                {grantError}
              </p>
            )}
            <button
              type="button"
              className="btn-primary min-h-[44px] px-5 py-2 text-sm"
              disabled={granting}
              onClick={() => void issueGrant()}
              data-testid="issue-grant"
            >
              {granting ? "Handing over…" : "Give this device access"}
            </button>
          </div>
        )}

        {grants === null && !grantsError && (
          <p role="status" className="mt-4 text-sm text-ink-muted">
            Loading the door devices…
          </p>
        )}
        {grantsError && (
          <div role="alert" className="mt-4" data-testid="grants-error">
            <p className="text-sm text-ink-muted">{grantsError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => selected && void loadList(selected)}
            >
              Try again
            </button>
          </div>
        )}
        {grants !== null && grants.length === 0 && (
          <p className="mt-4 text-sm text-ink-muted" data-testid="grants-empty">
            No device has been given access to this list.
          </p>
        )}
        {grants !== null && grants.length > 0 && (
          <ul className="mt-4 space-y-2" data-testid="grants-list">
            {grants.map((grant) => (
              <li
                key={grant.grant_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink-subtle/10 px-4 py-3"
              >
                <span className="text-sm text-ink">
                  <span className="font-semibold">{grant.device_id}</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {grant.revoked_at ? "revoked" : `allowed until ${formatDay(grant.expires_at)}`}
                  </span>
                </span>
                {!grant.revoked_at && (
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(pairingCode(grant));
                        setCopiedGrant(grant.grant_id);
                      }}
                      data-testid="copy-pairing-code"
                    >
                      {copiedGrant === grant.grant_id ? "Pairing code copied" : "Copy pairing code"}
                    </button>
                    <button
                      type="button"
                      className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                      onClick={() => void revokeGrant(grant)}
                      data-testid="revoke-grant"
                    >
                      Take it back
                    </button>
                  </span>
                )}
                {!grant.revoked_at && (
                  <p className="w-full break-all font-mono text-xs text-ink-muted">
                    {pairingCode(grant)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface p-5 sm:p-6" aria-labelledby="checkins-title">
        <h3 id="checkins-title" className="font-display text-xl font-bold text-plum-950">
          Who came in
        </h3>
        <p className="mt-2 text-sm text-ink-muted">
          The record the door leaves. A second admission of the same guest is kept as a duplicate
          rather than hidden, because a scanner working offline cannot prevent it.
        </p>
        {checkins === null && !checkinsError && (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            Loading the door's record…
          </p>
        )}
        {checkinsError && (
          <div role="alert" className="mt-3" data-testid="checkins-error">
            <p className="text-sm text-ink-muted">{checkinsError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => selected && void loadList(selected)}
            >
              Try again
            </button>
          </div>
        )}
        {checkins !== null && checkins.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted" data-testid="checkins-empty">
            Nobody has been admitted to this list yet.
          </p>
        )}
        {checkins !== null && checkins.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="checkins-list">
            {checkins.map((checkin) => (
              <li
                key={checkin.checkin_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink-subtle/10 px-4 py-3"
              >
                <span className="text-sm font-semibold text-ink">
                  {checkin.display_name ?? "Unknown card"}
                </span>
                <span className="text-xs text-ink-muted">
                  {RESULT_COPY[checkin.result]} ·{" "}
                  {checkin.mode === "queued_offline" ? "queued offline" : "online"} ·{" "}
                  {formatDay(checkin.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
