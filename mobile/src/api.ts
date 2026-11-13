/**
 * The phone app's boundary with the platform. The database decides what may happen; this module
 * forwards the call and explains the refusal in the guest's or the door's own words.
 *
 * The publishable key is the only credential a guest needs, so the claim path works with no
 * account at all. The door path carries the operator's own access token.
 */
import { readConfig } from "./config";

export type ApiErrorCode =
  | "forbidden"
  | "not_found"
  | "validation"
  | "expired"
  | "claimed"
  | "unauthorized"
  | "network"
  | "unknown";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function classifyApiError(message: string): ApiErrorCode {
  const text = message.toLowerCase();
  if (text.includes("invalid_")) return "validation";
  if (text.includes("invitation_expired")) return "expired";
  if (text.includes("invitation_claimed")) return "claimed";
  if (text.includes("not_found")) return "not_found";
  if (text.includes("forbidden") || text.includes("42501")) return "forbidden";
  if (text.includes("invalid_token") || text.includes("28000")) return "unauthorized";
  return "unknown";
}

export const API_ERROR_COPY: Record<ApiErrorCode, string> = {
  forbidden: "You are not allowed to do that.",
  not_found: "We could not find that.",
  validation: "Check the details and try again.",
  expired: "This invitation has expired.",
  claimed: "This invitation has already been used.",
  unauthorized: "Sign in to continue.",
  network: "No connection. The device will try again when it is back online.",
  unknown: "Something went wrong. Try again in a moment.",
};

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === "validation" ? error.message : API_ERROR_COPY[error.code];
  }
  return API_ERROR_COPY.unknown;
}

interface PostgrestError {
  code?: string;
  message?: string;
}

export async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const config = readConfig();
  let response: Response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.publishableKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError("network", "no_connection");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as PostgrestError | null;
    const message = body?.message ?? `request_failed_${response.status}`;
    throw new ApiError(classifyApiError(message), message);
  }
  const payload = (await response.json().catch(() => null)) as T | null;
  if (payload === null) throw new ApiError("unknown", "empty_response");
  return payload;
}
