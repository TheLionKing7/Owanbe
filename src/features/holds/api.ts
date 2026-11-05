/**
 * F-38 persistence boundary. Every call is one of the authorized projections in
 * supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql.
 *
 * There is deliberately no `recordPayment` here: `public.record_payment_confirmation` is granted
 * to `service_role` only, so no browser session, JWT or publishable key can assert that a payment
 * landed. The Paystack `charge.success` wiring that will call it arrives with F-48.
 */
import { rpc } from "@/features/quotes/api";
import type { HoldSummary, HouseAlert } from "./contracts";

export interface HoldsApi {
  holds(houseId: string): Promise<HoldSummary[]>;
  alerts(houseId: string): Promise<HouseAlert[]>;
  markSeen(alertId: string): Promise<void>;
}

export const holdsApi: HoldsApi = {
  holds: (houseId) => rpc<HoldSummary[]>("my_date_holds", { p_house: houseId }),
  alerts: (houseId) => rpc<HouseAlert[]>("my_notifications", { p_house: houseId }),
  markSeen: (alertId) => rpc<void>("mark_notification_read", { p_notification: alertId }),
};
