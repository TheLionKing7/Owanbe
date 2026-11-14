/**
 * The device's own name. It is generated once, kept in the locked drawer, and sent with a claim so
 * the platform can tell which device a guest claimed from. It carries nothing about the person.
 */
import * as Crypto from "expo-crypto";
import { readSecret, writeSecret } from "./secure";

const DEVICE_KEY = "owanbe.device.id";

export async function deviceId(): Promise<string> {
  const existing = await readSecret(DEVICE_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await writeSecret(DEVICE_KEY, created);
  return created;
}
