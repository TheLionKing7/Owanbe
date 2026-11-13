/**
 * The few pieces of interface the phone app needs: a screen, a field, a button and a notice.
 * Plain React Native, so the app carries no interface library of its own.
 */
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{title}</Text>
      {children}
    </ScrollView>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = "none",
  multiline = false,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "url";
  autoCapitalize?: "none" | "words";
  multiline?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6b6b7b"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        testID={testID}
      />
    </View>
  );
}

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "quiet";
  testID?: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      style={[
        styles.button,
        tone === "quiet" ? styles.buttonQuiet : null,
        disabled || busy ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={tone === "quiet" ? "#2b1b3d" : "#ffffff"} />
      ) : (
        <Text style={[styles.buttonLabel, tone === "quiet" ? styles.buttonLabelQuiet : null]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function Notice({
  tone,
  children,
  testID,
}: {
  tone: "error" | "info" | "good";
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.notice,
        tone === "error" ? styles.noticeError : null,
        tone === "good" ? styles.noticeGood : null,
      ]}
      testID={testID}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#faf7f5" },
  screenContent: { padding: 20, paddingBottom: 48, gap: 16 },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#2b1b3d",
    marginBottom: 4,
  },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: "600", color: "#2b1b3d" },
  input: {
    borderWidth: 1,
    borderColor: "#d9d2e4",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: "#2b1b3d",
    backgroundColor: "#ffffff",
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "#5b2a86",
  },
  buttonQuiet: { backgroundColor: "#efe8f5" },
  buttonDisabled: { opacity: 0.55 },
  buttonLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  buttonLabelQuiet: { color: "#2b1b3d" },
  notice: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#efe8f5",
    borderWidth: 1,
    borderColor: "#d9d2e4",
  },
  noticeError: { backgroundColor: "#fdecec", borderColor: "#e4a3a3" },
  noticeGood: { backgroundColor: "#e9f6ee", borderColor: "#9ed0b0" },
  noticeText: { fontSize: 14, color: "#2b1b3d", lineHeight: 20 },
});
