import { useCallback, useEffect, useMemo, useState } from "react";
import type { HouseSummary } from "@/lib/auth/types";
import {
  GUEST_LIST_ERROR_COPY,
  GuestListError,
  createGuestListApi,
  guestListErrorMessage,
  type GuestListApi,
} from "./api";
import {
  RESPONSE_LABELS,
  newGuestListSchema,
  type GuestListSummary,
  type MaskedGuest,
  type SharedListSummary,
} from "./contracts";
import { GuestListCard } from "./GuestListCard";

interface GuestListPanelProps {
  house: HouseSummary;
  /** Injected in tests; defaults to the authorized RPC projections. */
  api?: GuestListApi | undefined;
  /** The caller's token decides who owns the list; sharing never uses a server key. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

const NO_TOKEN = async (): Promise<string | null> => null;

export function GuestListPanel({ house, api, getAccessToken }: GuestListPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createGuestListApi(readToken), [api, readToken]);

  const [lists, setLists] = useState<GuestListSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [shared, setShared] = useState<SharedListSummary[] | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [openShared, setOpenShared] = useState<string | null>(null);
  const [masked, setMasked] = useState<MaskedGuest[] | null>(null);
  const [maskedError, setMaskedError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    setSharedError(null);
    try {
      setLists(await client.list(house.house_id));
    } catch (caught) {
      setLists(null);
      setListError(guestListErrorMessage(caught));
    }
    try {
      setShared(await client.sharedWithMe());
    } catch (caught) {
      setShared(null);
      setSharedError(guestListErrorMessage(caught));
    }
  }, [client, house.house_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSharedList = useCallback(
    async (listId: string) => {
      setOpenShared(listId);
      setMasked(null);
      setMaskedError(null);
      try {
        setMasked(await client.sharedList(listId));
      } catch (caught) {
        setMaskedError(guestListErrorMessage(caught));
      }
    },
    [client],
  );

  async function submitCreate() {
    const parsed = newGuestListSchema.safeParse({ house_id: house.house_id, title });
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? GUEST_LIST_ERROR_COPY.validation);
      return;
    }
    setCreateError(null);
    setCreatePending(true);
    try {
      await client.create(parsed.data);
      setTitle("");
      setCreating(false);
      await load();
    } catch (caught) {
      if (caught instanceof GuestListError && caught.code === "stale_version") await load();
      setCreateError(guestListErrorMessage(caught));
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="guest-list-panel">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary min-h-[44px] px-6 py-3 text-sm"
          onClick={() => {
            setCreating((current) => !current);
            setCreateError(null);
          }}
          data-testid="new-guest-list"
        >
          {creating ? "Close the form" : "New guest list"}
        </button>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-3 text-sm"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {creating && (
        <section className="surface p-5" aria-labelledby="new-list-title">
          <h2 id="new-list-title" className="font-display text-xl font-bold text-plum-950">
            Name this guest list
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            A new list starts private: only you can open it, and only you ever see phone numbers and
            addresses.
          </p>
          <label htmlFor="guest-list-title" className="mt-3 block text-sm font-semibold text-ink">
            List name
          </label>
          <input
            id="guest-list-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tolu and Ife's wedding"
            className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            aria-invalid={Boolean(createError)}
            data-testid="guest-list-title"
          />
          {createError && (
            <p
              role="alert"
              className="mt-2 text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="create-error"
            >
              {createError}
            </p>
          )}
          <button
            type="button"
            className="btn-primary mt-3 min-h-[44px] px-5 py-2 text-sm"
            disabled={createPending}
            onClick={() => void submitCreate()}
            data-testid="create-guest-list"
          >
            {createPending ? "Creating…" : "Create list"}
          </button>
        </section>
      )}

      {lists === null && !listError && (
        <p role="status" className="surface p-6 text-sm text-ink-muted" data-testid="lists-loading">
          Loading your guest lists…
        </p>
      )}

      {listError && (
        <section role="alert" className="surface p-6" data-testid="lists-error">
          <h2 className="font-display text-xl font-bold text-plum-950">
            We could not load your guest lists
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{listError}</p>
          <button
            type="button"
            className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}

      {lists !== null && lists.length === 0 && (
        <section className="surface p-6" data-testid="lists-empty">
          <h2 className="font-display text-xl font-bold text-plum-950">No guest lists yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create a list for your celebration and add the people you are inviting. It stays private
            until you decide otherwise, and you can take access back at any time.
          </p>
        </section>
      )}

      {lists !== null && lists.length > 0 && (
        <section aria-labelledby="my-lists" className="space-y-4">
          <h2 id="my-lists" className="font-display text-2xl font-bold text-plum-950">
            Your guest lists
          </h2>
          {lists.map((list) => (
            <GuestListCard key={list.list_id} list={list} api={client} onChanged={load} />
          ))}
        </section>
      )}

      <section aria-labelledby="shared-with-me" className="surface p-5 sm:p-6">
        <h2 id="shared-with-me" className="font-display text-xl font-bold text-plum-950">
          Shared with you
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Lists another host let you read. You see names and responses only — never their phone
          numbers or addresses. Their access ends the moment they remove you.
        </p>
        {shared === null && !sharedError && (
          <p role="status" className="mt-3 text-sm text-ink-muted" data-testid="shared-loading">
            Loading lists shared with you…
          </p>
        )}
        {sharedError && (
          <div role="alert" className="mt-3" data-testid="shared-error">
            <p className="text-sm text-ink-muted">{sharedError}</p>
            <button
              type="button"
              className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        )}
        {shared !== null && shared.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted" data-testid="shared-empty">
            Nobody has shared a guest list with you.
          </p>
        )}
        {shared !== null && shared.length > 0 && (
          <ul className="mt-3 space-y-2">
            {shared.map((entry) => (
              <li key={entry.list_id} className="rounded-2xl bg-ink-subtle/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {entry.title} · {entry.guest_count}{" "}
                    {entry.guest_count === 1 ? "guest" : "guests"}
                  </span>
                  <button
                    type="button"
                    className="btn-outline min-h-[44px] px-4 py-2 text-sm"
                    onClick={() =>
                      openShared === entry.list_id
                        ? setOpenShared(null)
                        : void openSharedList(entry.list_id)
                    }
                    data-testid="open-shared"
                    data-list-id={entry.list_id}
                  >
                    {openShared === entry.list_id ? "Close" : "Open"}
                  </button>
                </div>
                {openShared === entry.list_id && (
                  <div className="mt-3" data-testid="shared-detail">
                    {masked === null && !maskedError && (
                      <p role="status" className="text-sm text-ink-muted">
                        Loading the list…
                      </p>
                    )}
                    {maskedError && (
                      <div role="alert" data-testid="shared-detail-error">
                        <p className="text-sm text-ink-muted">{maskedError}</p>
                        <button
                          type="button"
                          className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
                          onClick={() => void openSharedList(entry.list_id)}
                        >
                          Try again
                        </button>
                      </div>
                    )}
                    {masked !== null && masked.length === 0 && (
                      <p className="text-sm text-ink-muted">This list has no guests yet.</p>
                    )}
                    {masked !== null && masked.length > 0 && (
                      <ul className="space-y-1" data-testid="shared-guests">
                        {masked.map((row, index) => (
                          <li key={`${row.display_name}-${index}`} className="text-sm text-ink">
                            {row.display_name} · {RESPONSE_LABELS[row.response]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
