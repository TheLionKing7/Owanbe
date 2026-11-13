/**
 * The door. A guest's card is read with the camera, from an NFC tag or typed in by hand, and the
 * platform is told about it. When the platform cannot be reached the cache decides, and the
 * admission waits in the queue until the device is back online.
 */
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CachedAdmission, QueuedCheckin } from "../../../src/features/tickets/scanner";
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
  cache: CachedAdmission[];
  queue: QueuedCheckin[];
  onCacheChange: (cache: CachedAdmission[]) => void;
  onQueueChange: (queue: QueuedCheckin[]) => void;
  onSignOut: () => void;
}) {
  const [manual, setManual] = useState("");
  const [outcome, setOutcome] = useState<{ outcome: string; name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanKey, setScanKey] = useState(0);

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

  async function refreshCache() {
    setError(null);
    setBusy(true);
    try {
      const rows = await rpc<CachedAdmission[]>(
        "scanner_admissions",
        { p_grant: pairing.grant_id, p_device_id: pairing.device_id },
        token,
      );
      onCacheChange(rows);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendQueue() {
    setError(null);
    setBusy(true);
    try {
      const result = await flushQueue({
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
      onQueueChange(result.remaining);
      if (result.verdicts.length > 0) {
        const last = result.verdicts[result.verdicts.length - 1];
        setOutcome(last ?? null);
      }
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
    if (cache.length === 0) void refreshCache();
    // The cache is loaded once when the door opens; afterwards the door keeps what it has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen title="The door">
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {pairing.device_id} · {cache.length} cards cached
          {queue.length > 0 ? ` · ${queue.length} waiting to be sent` : ""}
        </Text>
        <Text style={styles.summaryHint}>
          Allowed until {formatDay(pairing.expires_at)}. The host can take this device back at any
          time.
        </Text>
      </View>

      {outcome && (
        <Notice tone={outcome.outcome === "admitted" ? "good" : "error"} testID="scan-outcome">
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

      <Button label="Read an NFC tag" tone="quiet" onPress={() => void readTag()} busy={busy} />

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
        label="Refresh the cache"
        tone="quiet"
        onPress={() => void refreshCache()}
        busy={busy}
      />
      {queue.length > 0 && (
        <Button
          label={`Send ${queue.length} waiting check-in${queue.length === 1 ? "" : "s"}`}
          tone="quiet"
          onPress={() => void sendQueue()}
          busy={busy}
        />
      )}
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
