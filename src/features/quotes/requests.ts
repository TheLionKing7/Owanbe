/**
 * F-13 Direct Search & Book: a host asks a vendor for a quote from the vendor's public page.
 * The database decides who may ask and who may answer; the browser only calls its functions.
 */
import { z } from "zod";
import { rpc } from "./api";

export interface QuoteRequest {
  request_id: string;
  host_house_id: string;
  vendor_house_id: string;
  service_date: string;
  guest_count: number | null;
  budget_minor: number | null;
  currency: string;
  notes: string | null;
  status: "open" | "quoted" | "declined" | "withdrawn";
  quote_id: string | null;
  is_host_side: boolean;
  counterparty_name: string;
  created_at: string;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** What the host fills in. The date must be after today (UTC); amounts are whole naira. */
export const quoteRequestSchema = z.object({
  vendor_slug: z.string().trim().min(3).max(60),
  service_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date of your celebration.")
    .refine((value) => value > todayUtc(), "Pick a date after today."),
  guest_count: z.number().int().min(1).max(100000).nullable(),
  budget_naira: z.number().int().min(0).max(10_000_000_000).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});
export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;

export const REQUEST_STATUS_LABELS: Record<QuoteRequest["status"], string> = {
  open: "Waiting for the vendor",
  quoted: "Quote sent",
  declined: "Vendor declined",
  withdrawn: "Withdrawn",
};

export interface QuoteRequestApi {
  create(input: QuoteRequestInput): Promise<string>;
  list(houseId: string): Promise<QuoteRequest[]>;
  respond(requestId: string, status: "quoted" | "declined" | "withdrawn", quoteId?: string | null): Promise<string>;
}

export const quoteRequestApi: QuoteRequestApi = {
  create: (input) =>
    rpc<string>("request_quote", {
      p_vendor_slug: input.vendor_slug,
      p_service_date: input.service_date,
      p_guest_count: input.guest_count,
      p_budget_minor: input.budget_naira === null ? null : input.budget_naira * 100,
      p_notes: input.notes,
    }),
  list: (houseId) => rpc<QuoteRequest[]>("my_quote_requests", { p_house: houseId }),
  respond: (requestId, status, quoteId = null) =>
    rpc<string>("respond_quote_request", {
      p_request: requestId,
      p_status: status,
      p_quote: quoteId,
    }),
};
