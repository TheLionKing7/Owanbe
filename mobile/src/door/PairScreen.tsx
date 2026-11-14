/**
 * Pairing the door. The host copies a pairing code from the web app; the device reads it, and the
 * grant it names decides what this device may do until the host takes it back.
 */
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { parsePairingCode, type PairingPayload } from "../../../src/features/tickets/pairing";
import { QrScanner } from "../qr";
import { Button, Field, Notice, Screen } from "../ui";

export function PairScreen({
  onPaired,
  onCancel,
}: {
  onPaired: (pairing: PairingPayload) => void;
  onCancel?: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanKey, setScanKey] = useState(0);

  function pair(value: string) {
    const payload = parsePairingCode(value);
    if (!payload) {
      setError("That is not a pairing code. Copy it again from the host's page.");
      setScanKey((key) => key + 1);
      return;
    }
    setError(null);
    onPaired(payload);
  }

  return (
    <Screen title="Pair this device">
      <Text style={styles.intro}>
        The host gives one person one device access to one guest list, and can take it back at any
        time. Ask the host for the pairing code.
      </Text>

      {scanning ? (
        <>
          <QrScanner
            key={scanKey}
            label="Point the camera at the pairing code"
            onScan={(value) => {
              setScanning(false);
              pair(value);
            }}
          />
          <Button
            label="Type the code instead"
            tone="quiet"
            onPress={() => setScanning(false)}
            testID="pair-type-instead"
          />
        </>
      ) : (
        <>
          <Field
            label="Pairing code"
            value={code}
            onChangeText={setCode}
            placeholder="owanbe://pair?grant=…"
            testID="pair-code"
          />
          <Button label="Pair this device" onPress={() => pair(code)} testID="pair-submit" />
          <Button
            label="Scan the code instead"
            tone="quiet"
            onPress={() => setScanning(true)}
            testID="pair-scan"
          />
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {onCancel && <Button label="Not now" tone="quiet" onPress={onCancel} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, color: "#6b6b7b", lineHeight: 20 },
});
