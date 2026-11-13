import { describe, expect, it } from "vitest";
import {
  MAX_QUEUED_CHECKINS,
  cacheIsStale,
  hashCredential,
  isCredentialShape,
  queueCheckin,
  reconcileQueuedCheckin,
  verifyAgainstCache,
  type CachedAdmission,
} from "./scanner";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function entry(overrides: Partial<CachedAdmission> = {}): CachedAdmission {
  return {
    credential_hash: HASH,
    display_name: "Ada",
    status: "issued",
    expires_at: "2026-12-20T23:59:00.000Z",
    cache_expires_at: "2026-12-20T23:59:00.000Z",
    ...overrides,
  };
}

describe("scanner rules", () => {
  it("admits a card it knows that has not expired", () => {
    const verdict = verifyAgainstCache([entry()], HASH, new Date("2026-11-20T10:00:00.000Z"));
    expect(verdict).toEqual({ outcome: "admitted", name: "Ada" });
  });

  it("does not know a card it has never seen", () => {
    const verdict = verifyAgainstCache([entry()], OTHER_HASH, new Date("2026-11-20T10:00:00.000Z"));
    expect(verdict).toEqual({ outcome: "unknown", name: null });
  });

  it("calls a card past its expiry expired", () => {
    const verdict = verifyAgainstCache([entry()], HASH, new Date("2026-12-21T10:00:00.000Z"));
    expect(verdict).toEqual({ outcome: "expired", name: "Ada" });
  });

  it("calls a card already admitted on this device a duplicate", () => {
    const verdict = verifyAgainstCache(
      [entry({ status: "admitted" })],
      HASH,
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "duplicate", name: "Ada" });
  });

  it("treats a revoked card as unknown, even if it is in the cache", () => {
    const verdict = verifyAgainstCache(
      [entry({ status: "revoked" })],
      HASH,
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "unknown", name: null });
  });

  it("knows when the cache behind the grant has expired", () => {
    expect(cacheIsStale([entry()], new Date("2026-11-20T10:00:00.000Z"))).toBe(false);
    expect(cacheIsStale([entry()], new Date("2026-12-21T10:00:00.000Z"))).toBe(true);
    expect(cacheIsStale([], new Date("2026-11-20T10:00:00.000Z"))).toBe(true);
  });

  it("only accepts a card that looks like a card", () => {
    expect(isCredentialShape(HASH)).toBe(true);
    expect(isCredentialShape("not-a-card")).toBe(false);
    expect(isCredentialShape(`${HASH}ff`)).toBe(false);
  });

  it("hashes a card the way the platform does", async () => {
    const sha256 = async (value: string) => `hashed:${value}`;
    expect(await hashCredential(` ${HASH} `, sha256)).toBe(`hashed:${HASH}`);
    expect(await hashCredential("nope", sha256)).toBeNull();
  });

  it("keeps the queue bounded so a device cannot grow without limit", () => {
    let queue: { credential: string; occurred_at: string }[] = [];
    for (let index = 0; index < MAX_QUEUED_CHECKINS + 5; index += 1) {
      queue = queueCheckin(queue, {
        credential: `card-${index}`,
        occurred_at: "2026-11-20T10:00:00.000Z",
      });
    }
    expect(queue).toHaveLength(MAX_QUEUED_CHECKINS);
    expect(queue[0]?.credential).toBe("card-5");
  });

  it("tells the door what the platform made of a queued check-in", () => {
    const entry = { credential: HASH, occurred_at: "2026-11-20T10:00:00.000Z" };
    expect(reconcileQueuedCheckin(entry, { result: "admitted", display_name: "Ada" })).toEqual({
      outcome: "admitted",
      name: "Ada",
    });
    expect(reconcileQueuedCheckin(entry, { result: "duplicate", display_name: "Ada" })).toEqual({
      outcome: "duplicate",
      name: "Ada",
    });
    expect(reconcileQueuedCheckin(entry, { result: "unknown" })).toEqual({
      outcome: "unknown",
      name: null,
    });
  });
});
