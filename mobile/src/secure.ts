/**
 * The device's locked drawer. A keychain item is small, so a long secret is split into pieces and
 * put back together on the way out. Nothing here is ever written to a log.
 */
import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 24;

export async function readSecret(key: string): Promise<string | null> {
  const head = await SecureStore.getItemAsync(`${key}.0`);
  if (head === null) return null;
  const parts = [head];
  for (let index = 1; index < MAX_CHUNKS; index += 1) {
    const part = await SecureStore.getItemAsync(`${key}.${index}`);
    if (part === null) break;
    parts.push(part);
  }
  return parts.join("");
}

export async function writeSecret(key: string, value: string): Promise<void> {
  await clearSecret(key);
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += CHUNK_SIZE) {
    chunks.push(value.slice(index, index + CHUNK_SIZE));
  }
  for (let index = 0; index < chunks.length; index += 1) {
    await SecureStore.setItemAsync(`${key}.${index}`, chunks[index] as string);
  }
}

export async function clearSecret(key: string): Promise<void> {
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    await SecureStore.deleteItemAsync(`${key}.${index}`);
  }
}
