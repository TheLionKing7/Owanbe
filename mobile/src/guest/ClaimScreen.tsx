/**
 * The guest's claim. An invitation link, a name and a phone number, and no account at all: the
 * platform stores the phone only as a hash and never needs to know who the guest is.
 */
import { useState } from "react";
import { View } from "react-native";
import { ApiError, apiErrorMessage, rpc } from "../api";
import { deviceId } from "../device";
import { Button, Field, Notice, Screen } from "../ui";
import { tokenFromLink } from "./token";

export interface ClaimResult {
  guest_session: string;
  admission_credential: string;
  event_title: string;
  slot: number;
  claim_limit: number;
  claim_deadline: string;
  admission_expires_at: string;
}

export function ClaimScreen({ onClaimed }: { onClaimed: (result: ClaimResult) => void }) {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim() {
    setError(null);
    const token = tokenFromLink(link);
    if (token.length < 32) {
      setError("That invitation link is not valid.");
      return;
    }
    if (!name.trim()) {
      setError("Who is this invitation for?");
      return;
    }
    if (phone.trim().length < 7) {
      setError("Enter a phone number we can reach you on.");
      return;
    }
    setBusy(true);
    try {
      const result = await rpc<ClaimResult>("claim_invitation", {
        p_token: token,
        p_display_name: name.trim(),
        p_phone: phone.trim(),
        p_device_id: await deviceId(),
      });
      onClaimed(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "validation"
          ? caught.message
          : apiErrorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Your invitation">
      <Field
        label="Invitation link"
        value={link}
        onChangeText={setLink}
        placeholder="Paste the link the host sent you"
        keyboardType="url"
        testID="claim-link"
      />
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="How the host will recognise you"
        autoCapitalize="words"
        testID="claim-name"
      />
      <Field
        label="Your phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="Only used if the host needs to reach you"
        keyboardType="phone-pad"
        testID="claim-phone"
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        label="Claim my place"
        onPress={() => void claim()}
        busy={busy}
        testID="claim-submit"
      />
      <View />
    </Screen>
  );
}
