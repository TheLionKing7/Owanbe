import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteClaim, GUEST_SESSION_KEY } from "./InviteClaim";
import { ClaimError } from "./claim";
import type { ClaimedInvitation, GuestCard } from "./contracts";

const TOKEN = "a".repeat(64);

const CLAIMED: ClaimedInvitation = {
  guest_session: "b".repeat(64),
  admission_credential: "c".repeat(64),
  event_title: "Tolu and Ife's wedding",
  slot: 1,
  claim_limit: 1,
  claim_deadline: "2026-11-20T23:59:00.000Z",
  admission_expires_at: "2026-12-20T23:59:00.000Z",
};

const CARD: GuestCard = {
  event_title: "Tolu and Ife's wedding",
  display_name: "Ada",
  slot: 1,
  status: "issued" as const,
  expires_at: "2026-12-20T23:59:00.000Z",
  admission_credential: "c".repeat(64),
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe("InviteClaim", () => {
  it("claims the link and shows the guest their entry code", async () => {
    const claim = vi.fn(async () => CLAIMED);
    render(<InviteClaim token={TOKEN} claim={claim} readCard={vi.fn(async () => CARD)} />);

    fireEvent.change(screen.getByTestId("claim-name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByTestId("claim-phone"), { target: { value: "08012345678" } });
    fireEvent.click(screen.getByTestId("claim-submit"));

    const success = await screen.findByTestId("claim-success");
    expect(success).toHaveTextContent("Your invitation is confirmed");
    expect(screen.getByTestId("claim-credential")).toHaveTextContent(CLAIMED.admission_credential);
    expect(claim).toHaveBeenCalledWith({
      token: TOKEN,
      display_name: "Ada",
      phone: "08012345678",
    });
  });

  it("keeps the guest's session on the device so the card can be found again", async () => {
    render(
      <InviteClaim
        token={TOKEN}
        claim={vi.fn(async () => CLAIMED)}
        readCard={vi.fn(async () => CARD)}
      />,
    );

    fireEvent.change(screen.getByTestId("claim-name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByTestId("claim-phone"), { target: { value: "08012345678" } });
    fireEvent.click(screen.getByTestId("claim-submit"));

    await screen.findByTestId("claim-success");
    expect(window.sessionStorage.getItem(GUEST_SESSION_KEY)).toBe(CLAIMED.guest_session);
  });

  it("explains a refusal in plain words", async () => {
    const claim = vi.fn(async () => {
      throw new ClaimError("expired", "invitation_expired");
    });
    render(<InviteClaim token={TOKEN} claim={claim} readCard={vi.fn(async () => CARD)} />);

    fireEvent.change(screen.getByTestId("claim-name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByTestId("claim-phone"), { target: { value: "08012345678" } });
    fireEvent.click(screen.getByTestId("claim-submit"));

    expect(await screen.findByTestId("claim-error")).toHaveTextContent(
      "The deadline to claim this invitation has passed.",
    );
  });

  it("finds the card again on the device that claimed it", async () => {
    window.sessionStorage.setItem(GUEST_SESSION_KEY, "b".repeat(64));
    const readCard = vi.fn(async () => CARD);
    render(<InviteClaim token={TOKEN} claim={vi.fn(async () => CLAIMED)} readCard={readCard} />);

    const card = await screen.findByTestId("my-card");
    expect(card).toHaveTextContent("Ada");
    expect(screen.getByTestId("card-status")).toHaveTextContent("Ready for the door");
    expect(readCard).toHaveBeenCalledWith("b".repeat(64));
  });

  it("says a card that was taken back is no longer valid", async () => {
    window.sessionStorage.setItem(GUEST_SESSION_KEY, "b".repeat(64));
    render(
      <InviteClaim
        token={TOKEN}
        claim={vi.fn(async () => CLAIMED)}
        readCard={vi.fn(async () => ({
          ...CARD,
          status: "revoked" as const,
          admission_credential: null,
        }))}
      />,
    );

    await screen.findByTestId("my-card");
    expect(screen.getByTestId("card-status")).toHaveTextContent("No longer valid");
  });

  it("forgets a card the device can no longer read", async () => {
    window.sessionStorage.setItem(GUEST_SESSION_KEY, "b".repeat(64));
    render(
      <InviteClaim
        token={TOKEN}
        claim={vi.fn(async () => CLAIMED)}
        readCard={vi.fn(async () => {
          throw new ClaimError("not_found", "card_not_found");
        })}
      />,
    );

    expect(await screen.findByTestId("card-error")).toHaveTextContent(
      "This invitation link is not valid any more.",
    );
    await waitFor(() => expect(window.sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull());
  });
});
