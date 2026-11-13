/**
 * The tag a guest carries. The card's credential is written to an NDEF text record, and the door
 * reads it back. Writing a tag needs a development build and works on Android; iOS phones can read
 * a tag but cannot write one.
 */
import NfcManager, { Ndef, NfcTech, type NdefRecord } from "react-native-nfc-manager";

export async function nfcSupported(): Promise<boolean> {
  try {
    await NfcManager.start();
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

export async function nfcEnabled(): Promise<boolean> {
  try {
    await NfcManager.start();
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

/** The first text record on the tag, or null when the tag carries nothing we can read. */
export async function readNdefText(): Promise<string | null> {
  let requestAttempted = false;
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(NfcTech.Ndef);
    requestAttempted = true;
    const tag = await NfcManager.getTag();
    const records = tag?.ndefMessage ?? [];
    for (const record of records) {
      const text = decodeTextRecord(record);
      if (text) return text;
    }
    return null;
  } finally {
    if (requestAttempted) {
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch {
        // The scan is over either way; a failed cleanup must not hide the result.
      }
    }
  }
}

/** Writes the credential to the tag the guest holds against the phone. */
export async function writeNdefText(text: string): Promise<void> {
  await NfcManager.start();
  await NfcManager.requestTechnology(NfcTech.Ndef);
  try {
    const bytes = Ndef.encodeMessage([Ndef.textRecord(text, "en")]);
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // The write is over either way; a failed cleanup must not hide the result.
    }
  }
}

function decodeTextRecord(record: NdefRecord): string | null {
  const payload = record.payload;
  if (!payload || payload.length < 1) return null;
  const type = record.type;
  const isText = typeof type === "string" ? type === "T" : type[0] === 0x54;
  if (!isText) return null;
  try {
    return Ndef.text.decodePayload(new Uint8Array(payload));
  } catch {
    return null;
  }
}
