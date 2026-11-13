import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ConfigError, readConfig } from "./src/config";
import { DoorScreen } from "./src/door/DoorScreen";
import { CardScreen } from "./src/guest/CardScreen";
import { ClaimScreen, type ClaimResult } from "./src/guest/ClaimScreen";
import { clearGuestSession, loadGuestSession, saveGuestSession } from "./src/guest/store";
import { rpc } from "./src/api";

interface GuestCard {
  event_title: string;
  display_name: string;
  slot: number;
  status: "issued" | "admitted" | "revoked";
  expires_at: string;
  admission_credential: string | null;
}

type Mode = "guest" | "door";

export default function App() {
  const [mode, setMode] = useState<Mode>("guest");
  const [missing, setMissing] = useState<string | null>(null);
  const [card, setCard] = useState<{
    session: string;
    credential: string;
    eventTitle: string;
    expiresAt: string;
  } | null>(null);

  useEffect(() => {
    try {
      readConfig();
    } catch (caught) {
      setMissing(caught instanceof ConfigError ? caught.message : "The app is not configured.");
      return;
    }
    void (async () => {
      const session = await loadGuestSession();
      if (!session) return;
      try {
        const row = await rpc<GuestCard>("my_claimed_card", { p_guest_session: session });
        setCard({
          session,
          credential: row.admission_credential ?? "",
          eventTitle: row.event_title,
          expiresAt: row.expires_at,
        });
      } catch {
        await clearGuestSession();
      }
    })();
  }, []);

  if (missing) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>Ówàńbè is not set up on this phone</Text>
        <Text style={styles.missingText}>{missing}</Text>
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.tabs}>
        {(["guest", "door"] as Mode[]).map((value) => (
          <TouchableOpacity
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value }}
            style={[styles.tab, mode === value ? styles.tabActive : null]}
            onPress={() => setMode(value)}
          >
            <Text style={[styles.tabLabel, mode === value ? styles.tabLabelActive : null]}>
              {value === "guest" ? "My card" : "The door"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === "door" ? (
        <DoorScreen />
      ) : card ? (
        <CardScreen
          session={card.session}
          credential={card.credential}
          eventTitle={card.eventTitle}
          expiresAt={card.expiresAt}
          onEnd={() => {
            void clearGuestSession();
            setCard(null);
          }}
        />
      ) : (
        <ClaimScreen
          onClaimed={(result: ClaimResult) => {
            void saveGuestSession(result.guest_session);
            setCard({
              session: result.guest_session,
              credential: result.admission_credential,
              eventTitle: result.event_title,
              expiresAt: result.admission_expires_at,
            });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#faf7f5" },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#efe8f5",
  },
  tabActive: { backgroundColor: "#5b2a86" },
  tabLabel: { fontSize: 14, fontWeight: "600", color: "#2b1b3d" },
  tabLabelActive: { color: "#ffffff" },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#faf7f5",
  },
  missingTitle: { fontSize: 20, fontWeight: "700", color: "#2b1b3d" },
  missingText: { fontSize: 14, color: "#6b6b7b", textAlign: "center", lineHeight: 20 },
});
