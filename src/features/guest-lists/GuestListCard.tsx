import { useCallback, useEffect, useState } from "react";
import {
  GUEST_LIST_ERROR_COPY,
  GuestListError,
  guestListErrorMessage,
  type GuestListApi,
} from "./api";
import {
  CONTACT_HIDDEN_NOTE,
  GUEST_LIST_VISIBILITIES,
  RESPONSE_LABELS,
  RSVP_RESPONSES,
  VISIBILITY_COPY,
  VISIBILITY_LABELS,
  maskPreview,
  newRsvpSchema,
  publicGuestListPath,
  shareRequestSchema,
  type GuestListSummary,
  type GuestListVisibility,
  type GuestRecipient,
  type GuestRsvp,
  type RsvpResponse,
} from "./contracts";

const VISIBILITY_TONE: Record<GuestListVisibility, string> = {
  private: "bg-owanbe-emerald-green/15 text-owanbe-emerald-green",
  shared: "bg-gold-100 text-plum-900",
  public: "bg-owanbe-vibrant-red/10 text-owanbe-vibrant-red",
};

type PendingAction = "visibility" | "share" | "revoke" | "add";

interface GuestListCardProps {
  list: GuestListSummary;
  api: GuestListApi;
  /** Re-reads the house projection so counts and versions come from the server, not this card. */
  onChanged: () => Promise<void>;
}

const BLANK_GUEST = {
  display_name: "",
  response: "invited" as RsvpResponse,
  phone: "",
  address: "",
};

export function GuestListCard({ list, api, onChanged }: GuestListCardProps) {
  const [rsvps, setRsvps] = useState<GuestRsvp[] | null>(null);
  const [recipients, setRecipients] = useState<GuestRecipient[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [version, setVersion] = useState(list.version);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [guest, setGuest] = useState(BLANK_GUEST);

  useEffect(() => setVersion(list.version), [list.version]);

  const loadDetail = useCallback(async () => {
    setDetailError(null);
    try {
      const [rows, people] = await Promise.all([
        api.rsvps(list.list_id),
        api.recipients(list.list_id),
      ]);
      setRsvps(rows);
      setRecipients(people);
    } catch (caught) {
      setRsvps(null);
      setRecipients(null);
      setDetailError(guestListErrorMessage(caught));
    }
  }, [api, list.list_id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  /** A stale version means the row moved on: re-read it so the next action uses the new version. */
  async function recover(caught: unknown) {
    if (caught instanceof GuestListError && caught.code === "stale_version") await onChanged();
    setError(guestListErrorMessage(caught));
  }

  async function changeVisibility(next: GuestListVisibility) {
    if (next === list.visibility || pending) return;
    setPending("visibility");
    setError(null);
    setNotice(null);
    try {
      setVersion(await api.setVisibility(list.list_id, next, version));
      setNotice(
        next === "private"
          ? "This list is private again. Everyone you shared it with has lost access."
          : `This list is now ${VISIBILITY_LABELS[next].toLowerCase()}.`,
      );
      await loadDetail();
      await onChanged();
    } catch (caught) {
      await recover(caught);
    } finally {
      setPending(null);
    }
  }

  async function submitShare() {
    const parsed = shareRequestSchema.safeParse({
      grantee_email: shareEmail,
      expected_version: version,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? GUEST_LIST_ERROR_COPY.validation);
      return;
    }
    setPending("share");
    setError(null);
    setNotice(null);
    try {
      setVersion(await api.share(list.list_id, parsed.data.grantee_email, version));
      setShareEmail("");
      setNotice("Shared. They can see names and responses, never phone numbers or addresses.");
      await loadDetail();
      await onChanged();
    } catch (caught) {
      await recover(caught);
    } finally {
      setPending(null);
    }
  }

  async function revoke(shareId: string) {
    if (pending) return;
    setPending("revoke");
    setError(null);
    setNotice(null);
    try {
      setVersion(await api.revoke(list.list_id, shareId, version));
      setNotice("Access removed. They can no longer open this list.");
      await loadDetail();
      await onChanged();
    } catch (caught) {
      await recover(caught);
    } finally {
      setPending(null);
    }
  }

  async function submitGuest() {
    const parsed = newRsvpSchema.safeParse({
      display_name: guest.display_name,
      response: guest.response,
      phone: guest.phone || undefined,
      address: guest.address || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? GUEST_LIST_ERROR_COPY.validation);
      return;
    }
    setPending("add");
    setError(null);
    setNotice(null);
    try {
      await api.addRsvp(list.list_id, parsed.data);
      setGuest(BLANK_GUEST);
      setNotice("Guest added. Their contact details stay visible to you alone.");
      await loadDetail();
      await onChanged();
    } catch (caught) {
      await recover(caught);
    } finally {
      setPending(null);
    }
  }

  const preview = maskPreview(rsvps ?? []);

  return (
    <article className="surface p-5 sm:p-6" data-testid="guest-list-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl font-bold text-plum-950">{list.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {list.guest_count} {list.guest_count === 1 ? "guest" : "guests"} · {list.yes_count}{" "}
            coming · shared with {list.share_count}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${VISIBILITY_TONE[list.visibility]}`}
          data-testid="guest-list-visibility"
        >
          {VISIBILITY_LABELS[list.visibility]}
        </span>
      </div>

      <fieldset className="mt-4" disabled={pending !== null}>
        <legend className="text-sm font-semibold text-ink">Who can see this list?</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="group">
          {GUEST_LIST_VISIBILITIES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={list.visibility === option}
              className={`${
                list.visibility === option ? "btn-primary" : "btn-outline"
              } min-h-[44px] px-4 py-2 text-sm`}
              onClick={() => void changeVisibility(option)}
              data-testid={`visibility-${option}`}
            >
              {VISIBILITY_LABELS[option]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-muted">{VISIBILITY_COPY[list.visibility]}</p>
        <p className="mt-1 text-sm font-semibold text-ink">{CONTACT_HIDDEN_NOTE}</p>
      </fieldset>

      {list.visibility === "public" && (
        <p className="mt-3 rounded-2xl bg-owanbe-vibrant-red/10 px-4 py-3 text-sm text-ink">
          Anyone with this link can read the list:{" "}
          <a
            href={publicGuestListPath(list.list_id)}
            className="font-semibold text-primary underline-offset-4 hover:underline"
            data-testid="public-link"
          >
            open the public view
          </a>
          . Switching back to private closes it immediately.
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-3 rounded-2xl bg-owanbe-emerald-green/15 px-4 py-3 text-sm font-semibold text-owanbe-emerald-green"
          data-testid="guest-list-notice"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-2xl bg-owanbe-vibrant-red/10 px-4 py-3 text-sm font-semibold text-owanbe-vibrant-red"
          data-testid="guest-list-error"
        >
          {error}
        </p>
      )}

      <section className="mt-5" aria-labelledby={`recipients-${list.list_id}`}>
        <h4
          id={`recipients-${list.list_id}`}
          className="font-display text-lg font-bold text-plum-950"
        >
          People with access
        </h4>
        {recipients === null && !detailError && (
          <p role="status" className="mt-2 text-sm text-ink-muted">
            Loading who can see this list…
          </p>
        )}
        {recipients !== null && recipients.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted" data-testid="recipients-empty">
            Not shared with anyone yet. Only you can open this list.
          </p>
        )}
        {recipients !== null && recipients.length > 0 && (
          <ul className="mt-2 space-y-2">
            {recipients.map((person) => (
              <li
                key={person.share_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink-subtle/10 px-4 py-3"
                data-testid="recipient-row"
              >
                <span className="text-sm font-semibold text-ink">{person.display_name}</span>
                <button
                  type="button"
                  className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                  disabled={pending !== null}
                  onClick={() => void revoke(person.share_id)}
                  data-testid="revoke-share"
                  data-share-id={person.share_id}
                >
                  {pending === "revoke" ? "Removing…" : "Remove access"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label
              htmlFor={`share-email-${list.list_id}`}
              className="text-sm font-semibold text-ink"
            >
              Share with someone on Ówàńbè
            </label>
            <input
              id={`share-email-${list.list_id}`}
              type="email"
              value={shareEmail}
              onChange={(event) => setShareEmail(event.target.value)}
              placeholder="their@email.com"
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              aria-invalid={Boolean(error)}
              data-testid="share-email"
            />
          </div>
          <button
            type="button"
            className="btn-primary min-h-[44px] px-5 py-2 text-sm"
            disabled={pending !== null}
            onClick={() => void submitShare()}
            data-testid="share-submit"
          >
            {pending === "share" ? "Sharing…" : "Share"}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-subtle">
          They need an Ówàńbè account with a verified email address. You can remove their access at
          any time, and it ends on their next read.
        </p>
      </section>

      <section className="mt-5" aria-labelledby={`guests-${list.list_id}`}>
        <h4 id={`guests-${list.list_id}`} className="font-display text-lg font-bold text-plum-950">
          Guests and RSVPs
        </h4>
        {rsvps === null && !detailError && (
          <p role="status" className="mt-2 text-sm text-ink-muted" data-testid="guests-loading">
            Loading your guests…
          </p>
        )}
        {detailError && (
          <div role="alert" className="mt-2" data-testid="guests-error">
            <p className="text-sm text-ink-muted">{detailError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => void loadDetail()}
            >
              Try again
            </button>
          </div>
        )}
        {rsvps !== null && rsvps.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted" data-testid="guests-empty">
            No guests yet. Add the people you are inviting, with their contact details for your own
            use.
          </p>
        )}
        {rsvps !== null && rsvps.length > 0 && (
          <ul className="mt-2 space-y-2">
            {rsvps.map((row) => (
              <li
                key={row.rsvp_id}
                className="rounded-2xl bg-ink-subtle/10 px-4 py-3"
                data-testid="guest-row"
              >
                <p className="text-sm font-semibold text-ink">
                  {row.display_name}{" "}
                  <span className="font-normal text-ink-muted">
                    · {RESPONSE_LABELS[row.response]}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink-muted" data-testid="guest-phone">
                  {row.phone ?? "No phone number saved"}
                </p>
                <p className="text-sm text-ink-muted" data-testid="guest-address">
                  {row.address ?? "No address saved"}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`guest-name-${list.list_id}`}
              className="text-sm font-semibold text-ink"
            >
              Guest name
            </label>
            <input
              id={`guest-name-${list.list_id}`}
              value={guest.display_name}
              onChange={(event) => setGuest({ ...guest, display_name: event.target.value })}
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="add-guest-name"
            />
          </div>
          <div>
            <label
              htmlFor={`guest-response-${list.list_id}`}
              className="text-sm font-semibold text-ink"
            >
              Response
            </label>
            <select
              id={`guest-response-${list.list_id}`}
              value={guest.response}
              onChange={(event) =>
                setGuest({ ...guest, response: event.target.value as RsvpResponse })
              }
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="add-guest-response"
            >
              {RSVP_RESPONSES.map((option) => (
                <option key={option} value={option}>
                  {RESPONSE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`guest-phone-${list.list_id}`}
              className="text-sm font-semibold text-ink"
            >
              Phone number (only you see this)
            </label>
            <input
              id={`guest-phone-${list.list_id}`}
              value={guest.phone}
              onChange={(event) => setGuest({ ...guest, phone: event.target.value })}
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="add-guest-phone"
            />
          </div>
          <div>
            <label
              htmlFor={`guest-address-${list.list_id}`}
              className="text-sm font-semibold text-ink"
            >
              Address (only you see this)
            </label>
            <input
              id={`guest-address-${list.list_id}`}
              value={guest.address}
              onChange={(event) => setGuest({ ...guest, address: event.target.value })}
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              data-testid="add-guest-address"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary mt-3 min-h-[44px] px-5 py-2 text-sm"
          disabled={pending !== null}
          onClick={() => void submitGuest()}
          data-testid="add-guest-submit"
        >
          {pending === "add" ? "Adding…" : "Add guest"}
        </button>
      </section>

      {rsvps !== null && rsvps.length > 0 && (
        <section
          className="mt-5 rounded-2xl bg-muted p-4"
          aria-labelledby={`preview-${list.list_id}`}
        >
          <h4 id={`preview-${list.list_id}`} className="text-sm font-semibold text-plum-950">
            What other people see
          </h4>
          <ul className="mt-2 space-y-1" data-testid="masked-preview">
            {preview.map((row, index) => (
              <li key={`${row.display_name}-${index}`} className="text-sm text-ink">
                {row.display_name} · {RESPONSE_LABELS[row.response]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-subtle">{CONTACT_HIDDEN_NOTE}</p>
        </section>
      )}
    </article>
  );
}
