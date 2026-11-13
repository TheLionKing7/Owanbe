/**
 * The card a guest carries. It shows a code the door can read with the camera or from an NFC tag,
 * and it can be refreshed at any time: the platform rebuilds the card from the guest's own session.
 */
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { ApiError, apiErrorMessage, rpc } from "../api";
import { nfcEnabled, nfcSupported, writeNdefText } from "../nfc";
import { Button, Notice, Screen } from "../ui";

interface GuestCard {
  event_title: string;
  display_name: string;
  slot: number;
  status: "issued" | "admitted" | "revoked";
  expires_at: string;
  admission_credential: string | null;
}

export function CardScreen({
  session,
  credential,
  eventTitle,
  expiresAt,
  onEnd,
}: {
  session: string;
  credential: string;
  eventTitle: string;
  expiresAt: string;
  onEnd: () => void;
}) {
  const [status, setStatus] = useState<string>("issued");
  const [current, setCurrent] = useState<string>(credential);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nfcMessage, setNfcMessage] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setBusy(true);
    try {
      const card = await rpc<GuestCard>("my_claimed_card", { p_guest_session: session });
      setStatus(card.status);
      if (card.admission_credential) setCurrent(card.admission_credential);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function writeTag() {
    setError(null);
    setNfcMessage(null);
    setBusy(true);
    try {
      if (!(await nfcSupported()) || !(await nfcEnabled())) {
        setNfcMessage(
          "Writing to a tag is not available on this phone. The code below is the way in.",
        );
        return;
      }
      await writeNdefText(current);
      setNfcMessage("The card is on the tag. Hold it against the reader at the door.");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? apiErrorMessage(caught)
          : "This phone could not write to the tag. Showing the code is the way — the camera reads it on any phone.",
      );
    } finally {
      setBusy(false);
    }
  }

  const revoked = status === "revoked";

  return (
    <Screen title={eventTitle || "Your card"}>
      {revoked ? (
        <Notice tone="error" testID="card-revoked">
          This card no longer works. Ask the host for a new invitation.
        </Notice>
      ) : (
        <View style={styles.card}>
          <Text style={styles.name}>Your entry card</Text>
          <View style={styles.qr}>
            <QRCode value={current} size={220} backgroundColor="#ffffff" />
          </View>
          <Text style={styles.code} testID="card-code">
            {current}
          </Text>
          <Text style={styles.hint}>
            Show this at the door — the camera reads it on any phone. On Android you can also write
            it to an NFC tag for a faster entry. Works until {formatDay(expiresAt)}.
          </Text>
        </View>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {nfcMessage && <Notice tone="info">{nfcMessage}</Notice>}

      {!revoked && (
        <>
          <Button
            label="Copy the code"
            tone="quiet"
            onPress={() => void Clipboard.setStringAsync(current)}
            testID="copy-code"
          />
          <Button
            label="Optional: write to an NFC tag (Android only)"
            tone="quiet"
            onPress={() => void writeTag()}
            busy={busy}
            testID="write-nfc"
          />
        </>
      )}
      <Button label="Refresh my card" tone="quiet" onPress={() => void refresh()} busy={busy} />
      <Button label="Done" onPress={onEnd} testID="card-done" />
    </Screen>
  );
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d2e4",
    padding: 20,
  },
  name: { fontSize: 18, fontWeight: "600", color: "#2b1b3d" },
  qr: { backgroundColor: "#ffffff", padding: 8 },
  code: {
    fontSize: 12,
    color: "#4b4b5b",
    textAlign: "center",
    lineHeight: 18,
  },
  hint: { fontSize: 13, color: "#6b6b7b", textAlign: "center" },
});
