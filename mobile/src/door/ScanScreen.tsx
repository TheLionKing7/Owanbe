/**
 * The door. A guest's card is read with the camera, from an NFC tag or typed in by hand, and the
 * platform is told about it. When the platform cannot be reached the cache decides, and the
 * admission waits in the queue until the device is back online.
 */
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  doorSyncState,
  type CachedAdmission,
  type QueuedCheckin,
  type ScannerCache,
} from "../../../src/features/tickets/scanner";
import { ApiError, apiErrorMessage, rpc } from "../api";
import { QrScanner } from "../qr";
import { readNdefText } from "../nfc";
import { Button, Field, Notice, Screen } from "../ui";
import { admitCard, flushQueue } from "./admission";
import type { Pairing } from "./store";

interface CheckinOutcome {
  result: string;
  display_name?: string | null;
  conflict?: boolean;
}

const OUTCOME_COPY: Record<string, string> = {
  admitted: "Admitted",
  duplicate: "Already admitted",
  expired: "This card has expired",
  unknown: "This card is not on the list",
  needs_sync: "The door has to reach the platform before it admits anyone",
};

export function ScanScreen({
  token,
  pairing,
  cache,
  queue,
  onCacheChange,
  onQueueChange,
  onSignOut,
}: {
  token: string;
  pairing: Pairing;
  cache: ScannerCache;
  queue: QueuedCheckin[];
  onCacheChange: (cache: ScannerCache) => void;
  onQueueChange: (queue: QueuedCheckin[]) => void;
  onSignOut: () => void;
}) {
  const [manual, setManual] = useState("");
  const [outcome, setOutcome] = useState<{ outcome: string; name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanKey, setScanKey] = useState(0);

  const syncState = doorSyncState(cache);

  const record = useCallback(
    async (credential: string) => {
      setError(null);
      setOutcome(null);
      setBusy(true);
      try {
        const result = await admitCard({
          credential,
          cache,
          queue,
          online: async (value) =>
            await rpc<CheckinOutcome>(
              "record_checkin",
              {
                p_grant: pairing.grant_id,
                p_credential: value,
                p_device_id: pairing.device_id,
                p_occurred_at: new Date().toISOString(),
                p_mode: "online",
              },
              token,
            ),
        });
        setOutcome(result.verdict);
        onQueueChange(result.queue);
      } catch (caught) {
        setError(apiErrorMessage(caught));
      } finally {
        setBusy(false);
        setScanKey((key) => key + 1);
      }
    },
    [cache, onQueueChange, pairing, queue, token],
  );

  /**
   * One reconciliation: the waiting check-ins go to the platform and the guest list comes back
   * fresh, so the door's cache says what the platform says now. A door that cannot do this has no
   * list it may trust, and says so instead of admitting on stale truth.
   */
  async function syncDoor() {
    setError(null);
    setBusy(true);
    try {
      const flushed = await flushQueue({
        queue,
        online: async (credential, occurredAt) =>
          await rpc<CheckinOutcome>(
            "record_checkin",
            {
              p_grant: pairing.grant_id,
              p_credential: credential,
              p_device_id: pairing.device_id,
              p_occurred_at: occurredAt,
              p_mode: "queued_offline",
            },
            token,
          ),
      });
      onQueueChange(flushed.remaining);
      if (flushed.verdicts.length > 0) {
        const last = flushed.verdicts[flushed.verdicts.length - 1];
        setOutcome(last ?? null);
      }
      const rows = await rpc<CachedAdmission[]>(
        "scanner_admissions",
        { p_grant: pairing.grant_id, p_device_id: pairing.device_id },
        token,
      );
      onCacheChange({ entries: rows, synced_at: new Date().toISOString() });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function readTag() {
    setError(null);
    setBusy(true);
    try {
      const text = await readNdefText();
      if (!text) {
        setError("That tag did not carry a card. Hold it against the phone again.");
        return;
      }
      await record(text);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? apiErrorMessage(caught)
          : "The tag could not be read. Use the camera or type the code instead.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!cache.synced_at) void syncDoor();
    // The list is fetched once when the door opens; afterwards the door keeps what it has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen title="The door">
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {pairing.device_id} · {cache.entries.length} cards cached
          {queue.length > 0 ? ` · ${queue.length} waiting to be sent` : ""}
        </Text>
        <Text style={styles.summaryHint}>
          Allowed until {formatDay(pairing.expires_at)}. That is the door's window: after it, the
          device admits nobody until the host pairs it again.
        </Text>
      </View>

      {syncState === "never_synced" && (
        <Notice tone="info" testID="door-never-synced">
          This door has not reached the platform yet. Sync it so it can admit guests even when the
          network is down.
        </Notice>
      )}
      {syncState === "window_closed" && (
        <Notice tone="error" testID="door-window-closed">
          This door's window has closed. Ask the host for a new pairing before admitting anyone.
        </Notice>
      )}
      {outcome && (
        <Notice
          tone={
            outcome.outcome === "admitted"
              ? "good"
              : outcome.outcome === "needs_sync"
                ? "info"
                : "error"
          }
          testID="scan-outcome"
        >
          {OUTCOME_COPY[outcome.outcome] ?? "That card could not be admitted."}
          {outcome.name ? ` · ${outcome.name}` : ""}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <QrScanner
        key={scanKey}
        label="Point the camera at the guest's card"
        onScan={(value) => {
          if (value.startsWith("owanbe://pair")) {
            setError("That is a pairing code. Pair this device from the code screen.");
            setScanKey((key) => key + 1);
            return;
          }
          void record(value);
        }}
      />

      <Button
        label="Fast track: read an NFC tag"
        tone="quiet"
        onPress={() => void readTag()}
        busy={busy}
      />
      <Text style={styles.summaryHint}>
        The camera reads a card on every phone. Reading a tag is a fast track for the phones that
        have NFC.
      </Text>

      <Field
        label="Or type the code"
        value={manual}
        onChangeText={setManual}
        placeholder="The code under the guest's QR code"
        testID="manual-code"
      />
      <Button
        label="Admit this card"
        onPress={() => void record(manual)}
        busy={busy}
        testID="admit-manual"
      />

      <Button
        label={
          queue.length > 0
            ? `Sync the door and send ${queue.length} waiting check-in${queue.length === 1 ? "" : "s"}`
            : "Sync the door"
        }
        onPress={() => void syncDoor()}
        busy={busy}
        testID="sync-door"
      />
      <Button label="Sign out" tone="quiet" onPress={onSignOut} />
    </Screen>
  );
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  summary: {
    gap: 4,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9d2e4",
    padding: 14,
  },
  summaryText: { fontSize: 14, fontWeight: "600", color: "#2b1b3d" },
  summaryHint: { fontSize: 13, color: "#6b6b7b", lineHeight: 18 },
});
