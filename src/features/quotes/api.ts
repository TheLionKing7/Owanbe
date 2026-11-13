/**
 * F-14 persistence boundary. Every call is an authorized projection or a `security definer`
 * function in supabase/migrations/20261104120000_f14_quotes.sql; the browser never writes a
 * table directly (RLS is forced and write grants are revoked).
 *
 * `src/integrations/supabase/types.ts` is generated and still declares no tables or functions,
 * so the RPC contract is declared here instead of editing a generated file.
 */
import type { NewQuote, QuoteStatus, QuoteLine, RevisionInput } from "./contracts";

export interface QuoteSummary {
  quote_id: string;
  service_date: string;
  status: QuoteStatus;
  currency: string;
  total_minor: number;
  current_revision: number;
  sent_at: string | null;
  expires_at: string | null;
  /** The vendor's deadline to answer a host counter. Set only while the quote is countered. */
  counter_response_due_at: string | null;
  decided_at: string | null;
  close_note: string | null;
  version: number;
  is_vendor_side: boolean;
  counterparty_house: string;
  counterparty_name: string | null;
  title: string | null;
  lock_slot: number | null;
  daily_capacity: number;
  competing: boolean;
}

export interface QuoteRevision {
  number: number;
  authored_by_role: "host" | "vendor";
  title: string;
  inclusions: QuoteLine[];
  extras: QuoteLine[];
  currency: string;
  subtotal_minor: number;
  total_minor: number;
  message: string | null;
  created_at: string;
}

export type QuoteErrorCode =
  | "forbidden"
  | "stale_version"
  | "invalid_transition"
  | "not_found"
  | "validation"
  | "unconfigured"
  | "unknown";

/** Raised for every database refusal so the UI can explain it in plain language. */
export class QuoteError extends Error {
  constructor(
    readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

export function classifyQuoteError(message: string): QuoteErrorCode {
  const text = message.toLowerCase();
  if (text.includes("stale_version")) return "stale_version";
  if (text.includes("invalid_transition")) return "invalid_transition";
  if (
    text.includes("quote_not_found") ||
    text.includes("hold_not_found") ||
    text.includes("notification_not_found")
  )
    return "not_found";
  if (text.includes("forbidden") || text.includes("permission denied")) return "forbidden";
  if (text.includes("auth_not_configured") || text.includes("invalid_token")) return "unconfigured";
  if (
    text.includes("invalid_quote_lines") ||
    text.includes("counter_message_required") ||
    text.includes("invalid_host_house") ||
    text.includes("invalid_daily_capacity") ||
    text.includes("service_date_required") ||
    text.includes("quote_has_no_offer") ||
    text.includes("violates check constraint")
  ) {
    return "validation";
  }
  return "unknown";
}

export const QUOTE_ERROR_COPY: Record<QuoteErrorCode, string> = {
  forbidden: "Your account cannot do that in this house.",
  stale_version: "This quote changed while you were reading it. The latest version is shown below.",
  invalid_transition: "That quote is no longer open to this action.",
  not_found: "We could not find that quote.",
  validation: "Check the quote details and try again.",
  unconfigured: "Sign-in is not configured in this environment, so quotes stay locked.",
  unknown: "Something went wrong. Try again in a moment.",
};

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type RpcClient = (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

/** Shared RPC boundary: every call is an authorized projection or a `security definer` function. */
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { supabase } = await import("@/integrations/supabase/client");
  // The generated client is typed against an empty schema; the RPC names and payloads are
  // declared by this module and enforced by the database.
  const call = supabase.rpc as unknown as RpcClient;
  const { data, error } = await call(name, args);
  if (error) throw new QuoteError(classifyQuoteError(error.message), error.message);
  return data as T;
}

export interface QuoteApi {
  list(houseId: string): Promise<QuoteSummary[]>;
  history(quoteId: string): Promise<QuoteRevision[]>;
  create(input: NewQuote): Promise<string>;
  revise(quoteId: string, version: number, input: RevisionInput): Promise<number>;
  send(quoteId: string, version: number): Promise<string>;
  counter(quoteId: string, version: number, message: string): Promise<void>;
  accept(quoteId: string, version: number): Promise<void>;
  decline(quoteId: string, version: number): Promise<void>;
  cancel(quoteId: string, version: number, reason: string | null): Promise<void>;
  setDailyCapacity(houseId: string, capacity: number): Promise<void>;
}

export const quoteApi: QuoteApi = {
  list: (houseId) => rpc<QuoteSummary[]>("my_quotes", { p_house: houseId }),
  history: (quoteId) => rpc<QuoteRevision[]>("quote_history", { p_quote: quoteId }),
  create: (input) =>
    rpc<string>("create_quote", {
      p_vendor_house: input.vendor_house_id,
      p_host_house: input.host_house_id,
      p_service_date: input.service_date,
      p_currency: input.currency,
      p_title: input.title,
      p_inclusions: input.inclusions,
      p_extras: input.extras,
    }),
  revise: (quoteId, version, input) =>
    rpc<number>("revise_quote", {
      p_quote: quoteId,
      p_expected_version: version,
      p_title: input.title,
      p_inclusions: input.inclusions,
      p_extras: input.extras,
      p_message: input.message ?? null,
    }),
  send: (quoteId, version) =>
    rpc<string>("send_quote", { p_quote: quoteId, p_expected_version: version }),
  counter: (quoteId, version, message) =>
    rpc<void>("counter_quote", {
      p_quote: quoteId,
      p_expected_version: version,
      p_message: message,
    }),
  accept: (quoteId, version) =>
    rpc<void>("accept_quote", { p_quote: quoteId, p_expected_version: version }),
  decline: (quoteId, version) =>
    rpc<void>("decline_quote", { p_quote: quoteId, p_expected_version: version }),
  cancel: (quoteId, version, reason) =>
    rpc<void>("cancel_quote", { p_quote: quoteId, p_expected_version: version, p_reason: reason }),
  setDailyCapacity: (houseId, capacity) =>
    rpc<void>("set_vendor_daily_capacity", { p_house: houseId, p_capacity: capacity }),
};
