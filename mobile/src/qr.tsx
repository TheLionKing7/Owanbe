/**
 * The camera, used for one thing at a time: reading a QR code. The parent decides what the code
 * means.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./ui";

export function QrScanner({ onScan, label }: { onScan: (value: string) => void; label: string }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>Checking the camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.blocked}>
        <Text style={styles.blockedText}>{label}</Text>
        <Button label="Allow the camera" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.camera}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : (result) => {
                setScanned(true);
                onScan(result.data);
              }
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { height: 260, width: "100%", borderRadius: 16, overflow: "hidden" },
  blocked: {
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d9d2e4",
    backgroundColor: "#ffffff",
    padding: 16,
  },
  blockedText: { color: "#6b6b7b", fontSize: 14, textAlign: "center" },
});
