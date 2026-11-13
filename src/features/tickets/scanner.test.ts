import { describe, expect, it } from "vitest";
import {
  MAX_QUEUED_CHECKINS,
  cacheIsStale,
  cacheIsTrusted,
  doorSyncState,
  emptyScannerCache,
  hashCredential,
  isCredentialShape,
  queueCheckin,
  reconcileQueuedCheckin,
  verifyAgainstCache,
  type CachedAdmission,
  type ScannerCache,
} from "./scanner";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const SYNCED_AT = "2026-11-20T09:00:00.000Z";

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

function cache(entries: CachedAdmission[], syncedAt: string | null = SYNCED_AT): ScannerCache {
  return { entries, synced_at: syncedAt };
}

describe("scanner rules", () => {
  it("admits a card it knows that has not expired", () => {
    const verdict = verifyAgainstCache(
      cache([entry()]),
      HASH,
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "admitted", name: "Ada" });
  });

  it("does not know a card it has never seen", () => {
    const verdict = verifyAgainstCache(
      cache([entry()]),
      OTHER_HASH,
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "unknown", name: null });
  });

  it("calls a card past its expiry expired, while the door window is still open", () => {
    const verdict = verifyAgainstCache(
      cache([entry({ expires_at: "2026-11-25T23:59:00.000Z" })]),
      HASH,
      new Date("2026-11-26T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "expired", name: "Ada" });
  });

  it("calls a card already admitted on this device a duplicate", () => {
    const verdict = verifyAgainstCache(
      cache([entry({ status: "admitted" })]),
      HASH,
      new Date("2026-11-20T10:00:00.000Z"),
    );
    expect(verdict).toEqual({ outcome: "duplicate", name: "Ada" });
  });

  it("treats a revoked card as unknown, even if it is in the cache", () => {
    const verdict = verifyAgainstCache(
      cache([entry({ status: "revoked" })]),
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

describe("the door's trust in its cache", () => {
  it("starts empty and never synced", () => {
    expect(emptyScannerCache()).toEqual({ entries: [], synced_at: null });
    expect(doorSyncState(emptyScannerCache())).toBe("never_synced");
  });

  it("is ready once the platform has given it a list inside the door window", () => {
    const synced = cache([entry()]);
    expect(doorSyncState(synced, new Date("2026-11-20T10:00:00.000Z"))).toBe("ready");
    expect(cacheIsTrusted(synced, new Date("2026-11-20T10:00:00.000Z"))).toBe(true);
  });

  it("knows a list the platform gave that is empty", () => {
    expect(doorSyncState(cache([]), new Date("2026-11-20T10:00:00.000Z"))).toBe("empty");
  });

  it("closes the door when the window behind the list has passed", () => {
    const synced = cache([entry()]);
    expect(doorSyncState(synced, new Date("2026-12-21T10:00:00.000Z"))).toBe("window_closed");
    expect(cacheIsTrusted(synced, new Date("2026-12-21T10:00:00.000Z"))).toBe(false);
  });

  it("admits nobody from a cache the platform never gave", () => {
    const unsynced = cache([entry()], null);
    expect(doorSyncState(unsynced)).toBe("never_synced");
    expect(cacheIsTrusted(unsynced)).toBe(false);
    expect(verifyAgainstCache(unsynced, HASH, new Date("2026-11-20T10:00:00.000Z"))).toEqual({
      outcome: "needs_sync",
      name: null,
    });
  });

  it("admits nobody from a cache whose door window has closed", () => {
    const closed = cache([entry()]);
    expect(verifyAgainstCache(closed, HASH, new Date("2026-12-21T10:00:00.000Z"))).toEqual({
      outcome: "needs_sync",
      name: null,
    });
  });

  it("still calls a card unknown when the platform gave an empty list", () => {
    expect(verifyAgainstCache(cache([]), HASH, new Date("2026-11-20T10:00:00.000Z"))).toEqual({
      outcome: "unknown",
      name: null,
    });
  });
});
