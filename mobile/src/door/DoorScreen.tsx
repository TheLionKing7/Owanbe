/**
 * The door's own screen. The operator signs in with their Ówàńbè account, pairs the device with
 * the code the host gave them, and then the device admits guests.
 */
import { useCallback, useEffect, useState } from "react";
import {
  emptyScannerCache,
  type QueuedCheckin,
  type ScannerCache,
} from "../../../src/features/tickets/scanner";
import { restoreSession, signIn, signOut } from "../auth";
import { Button, Notice, Screen } from "../ui";
import { PairScreen } from "./PairScreen";
import { ScanScreen } from "./ScanScreen";
import {
  loadCache,
  loadPairing,
  loadQueue,
  saveCache,
  savePairing,
  saveQueue,
  type Pairing,
} from "./store";

export function DoorScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [cache, setCache] = useState<ScannerCache>(emptyScannerCache);
  const [queue, setQueue] = useState<QueuedCheckin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [session, savedPairing, savedCache, savedQueue] = await Promise.all([
        restoreSession(),
        loadPairing(),
        loadCache(),
        loadQueue(),
      ]);
      if (session) setToken(session.accessToken);
      if (savedPairing) setPairing(savedPairing);
      setCache(savedCache);
      setQueue(savedQueue);
    })();
  }, []);

  const changeCache = useCallback((rows: ScannerCache) => {
    setCache(rows);
    void saveCache(rows);
  }, []);

  const changeQueue = useCallback((rows: QueuedCheckin[]) => {
    setQueue(rows);
    void saveQueue(rows);
  }, []);

  async function startSignIn() {
    setError(null);
    setBusy(true);
    try {
      const session = await signIn();
      setToken(session.accessToken);
    } catch {
      setError("Sign-in did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    await signOut();
    setToken(null);
    setPairing(null);
  }

  async function pair(payload: { grant_id: string; device_id: string; expires_at: string }) {
    setError(null);
    const saved = await savePairing(payload);
    setPairing(saved);
  }

  if (!token) {
    return (
      <Screen title="The door">
        <Notice tone="info">
          The person at the door signs in with their own Ówàńbè account. The host names that person
          and the device, and can take the device back at any time.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        <Button
          label="Sign in"
          onPress={() => void startSignIn()}
          busy={busy}
          testID="door-sign-in"
        />
      </Screen>
    );
  }

  if (!pairing) {
    return (
      <PairScreen onPaired={(payload) => void pair(payload)} onCancel={() => void endSession()} />
    );
  }

  if (new Date(pairing.expires_at).getTime() <= Date.now()) {
    return (
      <Screen title="The door">
        <Notice tone="error">
          This device's access has ended. Ask the host for a new pairing code.
        </Notice>
        <Button label="Pair again" onPress={() => setPairing(null)} />
        <Button label="Sign out" tone="quiet" onPress={() => void endSession()} />
      </Screen>
    );
  }

  return (
    <ScanScreen
      token={token}
      pairing={pairing}
      cache={cache}
      queue={queue}
      onCacheChange={changeCache}
      onQueueChange={changeQueue}
      onSignOut={() => void endSession()}
    />
  );
}
