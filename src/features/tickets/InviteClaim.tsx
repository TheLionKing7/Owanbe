import { useCallback, useEffect, useState } from "react";
import { claimErrorMessage, claimInvitation, readGuestCard } from "./claim";
import type { ClaimedInvitation, ClaimRequest, GuestCard } from "./contracts";

const SESSION_KEY = "owanbe:guest-session";

type ClaimFn = (input: ClaimRequest) => Promise<ClaimedInvitation>;
type CardFn = (guestSession: string) => Promise<GuestCard>;

export interface InviteClaimProps {
  /** The raw token from the invitation link. It is never logged and never shown twice. */
  token: string;
  /** Injected in tests; defaults to the platform's own claim route. */
  claim?: ClaimFn;
  /** Injected in tests; defaults to reading the card with the guest's own session. */
  readCard?: CardFn;
}

function readStoredSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function storeSession(session: string): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, session);
  } catch {
    // A browser that refuses session storage still gets the card on this page.
  }
}

function forgetSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to forget.
  }
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The guest's side of an invitation. A guest needs no account: they give a name and a phone, and
 * the platform keeps only a hash of the phone. The card is shown once and can be read again from
 * this device with the guest's own session.
 */
export function InviteClaim({
  token,
  claim = claimInvitation,
  readCard = readGuestCard,
}: InviteClaimProps) {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [claimed, setClaimed] = useState<ClaimedInvitation | null>(null);
  const [card, setCard] = useState<GuestCard | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);

  const loadCard = useCallback(
    async (session: string) => {
      setLoadingCard(true);
      setCardError(null);
      try {
        setCard(await readCard(session));
      } catch (caught) {
        setCard(null);
        setCardError(claimErrorMessage(caught));
        forgetSession();
      } finally {
        setLoadingCard(false);
      }
    },
    [readCard],
  );

  useEffect(() => {
    const session = readStoredSession();
    if (session) void loadCard(session);
  }, [loadCard]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await claim({ token, display_name: displayName, phone });
      storeSession(result.guest_session);
      setClaimed(result);
      setCard({
        event_title: result.event_title,
        display_name: displayName.trim(),
        slot: result.slot,
        status: "issued",
        expires_at: result.admission_expires_at,
        admission_credential: result.admission_credential,
      });
    } catch (caught) {
      setError(claimErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (claimed) {
    return (
      <section className="surface p-5 sm:p-6" data-testid="claim-success">
        <h2 className="font-display text-2xl font-bold text-plum-950">
          Your invitation is confirmed
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Show the code below at the door, or open the Ówàńbè app to show it as a QR code.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Celebration</dt>
            <dd className="font-semibold text-ink">{claimed.event_title}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Entry code</dt>
            <dd className="break-all font-mono text-xs text-ink" data-testid="claim-credential">
              {claimed.admission_credential}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Valid until</dt>
            <dd className="font-semibold text-ink">{formatDay(claimed.admission_expires_at)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-ink-muted">
          This code is your entry. Keep it to yourself, and open it on this device if you need it
          again.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="surface p-5 sm:p-6" aria-labelledby="claim-title">
        <h2 id="claim-title" className="font-display text-2xl font-bold text-plum-950">
          Confirm your invitation
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          You do not need an account. We keep a hash of your phone number so the invitation stays
          bound to you, and never a readable number.
        </p>
        <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          <div>
            <label htmlFor="claim-name" className="block text-sm font-semibold text-ink">
              Your name
            </label>
            <input
              id="claim-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              aria-invalid={Boolean(error)}
              data-testid="claim-name"
            />
          </div>
          <div>
            <label htmlFor="claim-phone" className="block text-sm font-semibold text-ink">
              Phone number
            </label>
            <input
              id="claim-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              className="mt-2 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              aria-invalid={Boolean(error)}
              data-testid="claim-phone"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="claim-error"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary min-h-[44px] px-6 py-3 text-sm"
            disabled={pending}
            data-testid="claim-submit"
          >
            {pending ? "Confirming…" : "Confirm my invitation"}
          </button>
        </form>
      </section>

      {(loadingCard || card || cardError) && (
        <section
          className="surface p-5 sm:p-6"
          aria-labelledby="my-card-title"
          data-testid="my-card"
        >
          <h2 id="my-card-title" className="font-display text-xl font-bold text-plum-950">
            Your card on this device
          </h2>
          {loadingCard && (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              Loading your card…
            </p>
          )}
          {cardError && (
            <p
              role="alert"
              className="mt-2 text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="card-error"
            >
              {cardError}
            </p>
          )}
          {card && (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">Celebration</dt>
                  <dd className="font-semibold text-ink">{card.event_title}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">Name</dt>
                  <dd className="font-semibold text-ink">{card.display_name}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">Status</dt>
                  <dd className="font-semibold text-ink" data-testid="card-status">
                    {card.status === "revoked"
                      ? "No longer valid"
                      : card.status === "admitted"
                        ? "Already used at the door"
                        : "Ready for the door"}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">Valid until</dt>
                  <dd className="font-semibold text-ink">{formatDay(card.expires_at)}</dd>
                </div>
              </dl>
              {card.admission_credential && (
                <p
                  className="mt-3 break-all font-mono text-xs text-ink"
                  data-testid="card-credential"
                >
                  {card.admission_credential}
                </p>
              )}
              <button
                type="button"
                className="btn-outline mt-4 min-h-[44px] px-4 py-2 text-sm"
                onClick={() => {
                  forgetSession();
                  setCard(null);
                  setCardError(null);
                }}
              >
                Remove this card from this device
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export { SESSION_KEY as GUEST_SESSION_KEY };
