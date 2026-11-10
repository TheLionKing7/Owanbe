# Ówàńbè Compliance, KYC & Payments Spec

Nov 8, 2026 · @ola

## Summary

Ówàńbè can ship identity checks, an internal ledger and Paystack virtual accounts on the current stack (TanStack Start server functions, Supabase Postgres, Paystack). It does so under four rules:

1. **No identity check without a logged, explicit consent record.** The KYC call refuses to run without one.
2. **Every naira moves through a double-entry ledger** in kobo, append-only, keyed by Paystack references so a webhook can never post twice.
3. **The payment router is deterministic code.** The AI layer only scores, explains and investigates. It never moves money or approves anything (`AGENTS.md`: AI may investigate but never approves or moves money).
4. **Fail closed.** Missing consent, a bad webhook signature, an unbalanced entry or an unknown account each stop the operation.

The NDPR 2019 no longer governs. The **Nigeria Data Protection Act 2023** and the **GAID**, effective 19 September 2025, apply, so all documentation below cites them.

**Build order:** consent records and KYC → ledger → Paystack webhook intake → Dedicated Virtual Accounts → router (deterministic) → AI advisory layer.

**Owner decisions needed before money moves:**

- Whether holding customer balances needs a CBN licence or a licensed partner. This is legal advice, not engineering.
- Which KYC provider to use.
- Whether a DVA is assigned to every customer at sign-up or only when they first pay. Paystack's default cap is 1,000 DVAs per business.
- The large-refund threshold for second approval.

## Regulatory basis

Ówàńbè will almost certainly be a **Data Controller of Major Importance (DCPMI)**. It processes identity, financial and payment data for well over 200 people, and fintech-style payment services are named for sector-based inclusion. So it must register, appoint a DPO and file annual audits through a licensed DPCO. Exact tier fees are not in the sources read; confirm them with the NDPC or a DPCO.

| Requirement | What it means for Ówàńbè | Basis |
| --- | --- | --- |
| Governing law | NDPA 2023, plus the GAID effective 19 Sept 2025. The NDPR 2019 is no longer the operative instrument | [O3](https://o3legal.com/briefing-data-protection-audit-returns), [DLA Piper](https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/) |
| DCPMI registration | Register within 6 months of qualifying (above 200 data subjects in 6 months); notify changes within 60 days | [O3](https://o3legal.com/briefing-data-protection-audit-returns), [Banwo & Ighodalo](https://www.banwo-ighodalo.com/grey-matter/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025/) |
| Compliance Audit Return (CAR) | Filed annually by 31 March through a licensed DPCO; the first within 15 months of establishment; late filing adds 50% to the fee. Fees reported as ₦100k to ₦1m by volume | [O3](https://o3legal.com/briefing-data-protection-audit-returns), [DLA Piper](https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/) |
| Data Protection Officer | Appoint one (in-house or outsourced), reporting to management, filing a semi-annual report | [Banwo & Ighodalo](https://www.banwo-ighodalo.com/grey-matter/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025/) |
| DPIA | Mandatory before processing that is high-risk: sensitive data, financial services, profiling or automated decisions, cross-border transfer. All of these apply | [Banwo & Ighodalo](https://www.banwo-ighodalo.com/grey-matter/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025/) |
| Consent | Freely given, specific per purpose, informed, unambiguous and affirmative. No pre-ticked boxes; withdrawable any time; the controller must be able to prove it | [CookieYes](https://www.cookieyes.com/blog/nigeria-data-protection-act-ndpa/) |
| Sensitive data | Biometric, genetic, health (guest dietary/allergy data), religion, ethnicity and similar need explicit consent or another specific ground | [CookieYes](https://www.cookieyes.com/blog/nigeria-data-protection-act-ndpa/) |
| Breach notification | Tell the NDPC within 72 hours of awareness (s.40(2)), with phased reporting allowed. Tell data subjects immediately if high risk (s.40(3)). Keep a breach register (s.40(8)) | [Afriwise](https://www.afriwise.com/blog/data-breaches-compliance-obligations-under-the-nigerian-data-protection-act-2023) |
| Cross-border transfer | Only to an NDPC-adequate country, or under approved instruments (SCCs, BCRs). Report the grounds in the CAR. This affects AI model providers and US-hosted Supabase or Sentry regions | [DLA Piper](https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/), [O3](https://o3legal.com/briefing-data-protection-audit-returns) |
| Children | Parental or guardian consent under 18, plus age verification | [CookieYes](https://www.cookieyes.com/blog/nigeria-data-protection-act-ndpa/) |
| Penalties | For a DCPMI, the greater of ₦10m or 2% of prior-year gross revenue (s.48). Fines on record: Fidelity Bank ₦555.8m (Aug 2024), MultiChoice ₦766.2m (Jul 2025) | [O3](https://o3legal.com/briefing-data-protection-audit-returns) |

Identity data has its own rule. NIMC's tokenisation policy replaces raw NIN sharing with the **virtual NIN (vNIN)**: a 16-character token the user generates for Ówàńbè specifically, valid 72 hours and usable once. Collect vNINs, never raw NINs, and store only the provider's verification reference ([Dojah](https://dojah.io/blog/virtual-nin-verification), [Prembly](https://docs.prembly.com/docs/nin-and-virtual-nin-copy)).

These points come from law-firm and provider summaries, not the statute text. Have the DPO or counsel confirm the section numbers before filing.

## Compliance documentation pack

Prepare these ten documents before the first live identity check. The DPO owns the pack; engineering supplies the facts for items 3 to 6.

| # | Document | Contents | Owner |
| --- | --- | --- | --- |
| 1 | NDPC registration (DCPMI) | Entity details, tier, DPO, processing categories | Founder + DPO |
| 2 | Privacy notice (web + app) | Controller identity and contacts, purposes, lawful basis per purpose, recipients (KYC provider, Paystack, AI provider), retention, rights, how to complain to the NDPC, automated decisions, cross-border transfers | DPO + counsel |
| 3 | Record of processing activities (ROPA) | Every data category, purpose, basis, system, processor, retention, location | Engineering + DPO |
| 4 | DPIA: identity verification and payments | BVN/vNIN/CAC, DVA, ledger, fraud scoring, AI investigation; risks and mitigations | DPO + engineering |
| 5 | DPIA: guest health data | Dietary and allergy data, host + caterer access, deletion after the event | DPO |
| 6 | Consent register specification | What is logged (see Consent UI flows); proof-of-consent export | Engineering |
| 7 | Processor agreements (DPAs) | KYC provider, Paystack, Supabase, Sentry, Resend, AI provider; transfer instruments for any non-Nigerian hosting | Counsel |
| 8 | Retention and deletion schedule | KYC results, verification documents (delete after verification), consent records, ledger (kept), chats | DPO + counsel |
| 9 | Breach response plan + register | 72-hour NDPC notice, subject notice, roles, templates, register fields | DPO + engineering |
| 10 | Data subject request procedure | Access, correction, erasure, objection, withdrawal; identity check of the requester; financial-record exceptions | DPO |

The annual CAR is assembled from items 3 to 9, so keep them current rather than rebuilding them each March.

## Consent UI flows

Every identity check is preceded by a screen that asks for one purpose at a time, and its answer becomes an immutable consent record. The server, not the UI, refuses a check without a valid record.

**Host or vendor identity (vNIN, optional BVN)**

1. The user taps **Verify my identity** (Settings, or the prompt before a first payout or large payment).
2. **Consent screen**, which can't be skipped:
   - Title: "Verify your identity with NIMC".
   - Plain text covering what is checked (name, date of birth, photo match), why (fraud prevention and payout safety), who checks it (the named KYC provider), how long the result is kept, and that it can be withdrawn.
   - An unticked checkbox reading "I agree to Ówàńbè verifying my identity with NIMC through \[provider\] for account security", with a link to the privacy notice.
   - **Continue** stays disabled until the box is ticked. **Not now** is always available and blocks nothing except the features that need verification.
3. **Get your vNIN:** in-screen steps for the NIMC app, or USSD `*346*3*<your NIN>*<Owanbe enterprise code>#`, plus a 16-character input field.
4. On submit, the server checks for an active consent record for purpose `kyc.vnin`, calls the provider, and stores only the outcome and the provider reference.
5. **Result:** Verified, Didn't match (retry, maximum 3 attempts in 24 hours), or Provider down (retry later; nothing stored).

**Vendor business (CAC)**

1. Shown in vendor onboarding. Consent purpose is `kyc.cac`, covering the company record and its listed directors.
2. The vendor enters the RC/BN number and company type. The server verifies them, then compares the company name and directors with the vendor owner's verified name.
3. A mismatch goes to the manual review queue, not an automatic rejection.

**Dedicated virtual account**

Paystack says DVAs should only be used with the customer's express consent. Ask for consent purpose `payments.dva` ("Create a personal Ówàńbè bank account number for paying vendors") before assigning one.

**Consent record (one row per decision, append-only)**

| Field | Example |
| --- | --- |
| `user_id`, `purpose` | uuid, `kyc.vnin` / `kyc.bvn` / `kyc.cac` / `payments.dva` / `health.dietary` |
| `decision` | `granted` or `withdrawn` |
| `notice_version`, `text_hash` | `privacy-2026-11`, sha256 of the exact wording shown |
| `channel`, `locale` | `web`, `en-NG` |
| `ip_hash`, `user_agent` | salted hash, truncated UA |
| `created_at` | UTC timestamp |

**Withdrawal:** Settings → Privacy lists each active consent with a **Withdraw** button. Withdrawing writes a `withdrawn` row, stops future checks, and triggers deletion of stored KYC detail. The verified flag and the audit trail are kept as allowed by the retention schedule, which is a legal question to confirm.

## Unified KYC integration (vNIN + CAC)

Put every provider behind one `KycProvider` interface, so the provider can be swapped without touching the flows. The server function checks consent first and never stores a raw vNIN or NIN.

| Provider | vNIN | CAC | Auth | Notes |
| --- | --- | --- | --- | --- |
| [Prembly](https://docs.prembly.com/docs/nin-and-virtual-nin-copy) | `POST /identitypass/verification/vnin` with `number` | yes (doc not read) | `app-id`, `x-api-key` | Enterprise code 696739 for vNIN USSD |
| [VerifyMe](https://docs.verifyme.ng/identity-verifications/match-1) | `POST /v1/verifications/identities/virtual-nin/:vNin` with name/dob/phone match | not read | `Authorization: Bearer` | Returns match + photo |
| [Dojah](https://docs.dojah.io/api-reference/business-verification/lookup-cac.md) | no vNIN endpoint documented | `GET /api/v1/kyc/cac/basic` or `/advance` with `rc_number`, `company_type` | `Authorization` (raw key) + `AppId` | Also BVN match `GET /api/v1/kyc/bvn` |

**Recommendation:** one provider with both vNIN and CAC to keep the DPA count down. Prembly fits if its CAC endpoint checks out in a sandbox test; otherwise use VerifyMe for vNIN and Dojah for CAC behind the same interface.

```ts
// src/lib/kyc/kyc.server.ts  (server-only; keys never reach the browser)
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@/lib/db.server'          // service-role client, server only
import { requireUser } from '@/lib/auth/session.server'

export interface KycProvider {
  verifyVnin(i: { vnin: string; firstName: string; lastName: string; dob: string }): Promise<KycResult>
  verifyCac(i: { rcNumber: string; companyType: CompanyType }): Promise<KycResult>
}
export type CompanyType = 'BUSINESS_NAME' | 'COMPANY' | 'INCORPORATED_TRUSTEES'
  | 'LIMITED_PARTNERSHIP' | 'LIMITED_LIABILITY_PARTNERSHIP'
export interface KycResult {
  status: 'verified' | 'mismatch' | 'not_found' | 'provider_error'
  providerRef: string | null          // keep this, not the payload
  matched: Record<string, boolean>     // e.g. { firstName: true, dob: true }
  companyName?: string; directors?: string[]
}

// --- Dojah CAC adapter (endpoint and params per docs.dojah.io) ---
const dojah = async (path: string, q: Record<string, string>) => {
  const url = new URL(path, process.env.DOJAH_BASE_URL)          // https://api.dojah.io
  Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url, { headers: {
    Authorization: process.env.DOJAH_SECRET_KEY!,                // raw key, no 'Bearer'
    AppId: process.env.DOJAH_APP_ID!,
  }, signal: AbortSignal.timeout(15_000) })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
}

// --- Prembly vNIN adapter ---
const premblyVnin = async (vnin: string) => {
  const res = await fetch(`${process.env.PREMBLY_BASE_URL}/identitypass/verification/vnin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      'app-id': process.env.PREMBLY_APP_ID!, 'x-api-key': process.env.PREMBLY_API_KEY! },
    body: JSON.stringify({ number: vnin }),
    signal: AbortSignal.timeout(15_000),
  })
  return { ok: res.ok, body: await res.json().catch(() => ({})) }
}

const same = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

export const provider: KycProvider = {
  async verifyVnin(i) {
    const r = await premblyVnin(i.vnin)
    if (!r.ok) return { status: 'provider_error', providerRef: null, matched: {} }
    const d = r.body?.nin_data
    if (!r.body?.status || !d) return { status: 'not_found', providerRef: r.body?.verification?.reference ?? null, matched: {} }
    const matched = { firstName: same(d.firstname, i.firstName), lastName: same(d.surname, i.lastName),
                      dob: d.birthdate === i.dob /* DD-MM-YYYY */ }
    return { status: Object.values(matched).every(Boolean) ? 'verified' : 'mismatch',
             providerRef: r.body?.verification?.reference ?? null, matched }
  },
  async verifyCac(i) {
    const r = await dojah('/api/v1/kyc/cac/advance', { rc_number: i.rcNumber, company_type: i.companyType })
    if (r.status === 404) return { status: 'not_found', providerRef: null, matched: {} }
    if (!r.ok) return { status: 'provider_error', providerRef: null, matched: {} }
    const e = r.body.entity
    return { status: e?.status?.toUpperCase() === 'ACTIVE' ? 'verified' : 'mismatch', providerRef: e?.rc_number ?? null,
             matched: {}, companyName: e?.company_name,
             directors: (e?.affiliates ?? []).map((a: any) => `${a.first_name} ${a.last_name}`) }
  },
}

const VninInput = z.object({ vnin: z.string().regex(/^[A-Z0-9]{16}$/i) })

export const verifyMyVnin = createServerFn({ method: 'POST' })
  .validator((d: unknown) => VninInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser()                              // F-76 session gate
    // 1. Consent gate: latest decision for this purpose must be 'granted'
    const consent = await db.rpc('active_consent', { p_user: user.id, p_purpose: 'kyc.vnin' })
    if (!consent.data) throw new Error('consent_required')
    // 2. Rate limit: 3 attempts / 24h
    const { count } = await db.from('kyc_checks').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('kind', 'vnin').gte('created_at', new Date(Date.now() - 864e5).toISOString())
    if ((count ?? 0) >= 3) throw new Error('too_many_attempts')
    // 3. Call the provider; the raw vNIN is used once and never stored or logged
    const result = await provider.verifyVnin({ vnin: data.vnin, firstName: user.firstName,
                                               lastName: user.lastName, dob: user.dobDdMmYyyy })
    // 4. Store the outcome only, linked to the consent record that allowed it
    await db.from('kyc_checks').insert({ user_id: user.id, kind: 'vnin', consent_id: consent.data,
      status: result.status, provider: 'prembly', provider_ref: result.providerRef, matched: result.matched })
    if (result.status === 'verified')
      await db.from('users').update({ identity_verified_at: new Date().toISOString() }).eq('id', user.id)
    return { status: result.status }                               // no PII back to the client
  })
```

The CAC function has the same shape: consent `kyc.cac`, then `provider.verifyCac`, then the director name match against the owner's verified name, then a `kyc_checks` row, and a mismatch goes to the manual review queue. Field names in the Prembly response (`nin_data.firstname`, `surname`, `birthdate`) come from its docs. Confirm `verification.reference` in a sandbox run, and set Sentry to drop request bodies on `/kyc` routes.

## Ówàńbè internal ledger

The ledger is the source of truth for who owns what. Paystack is the cash rail, and the two are reconciled daily. It uses double-entry bookkeeping: every journal entry has postings that sum to zero, amounts are `bigint` kobo, and the tables are append-only. Corrections are reversing entries, never edits.

| Account (per currency) | Owner | Normal side | Holds |
| --- | --- | --- | --- |
| `paystack_clearing` | platform | debit (asset) | Cash Paystack has collected but not yet settled |
| `user_wallet:<user>` | host | credit (liability) | Funds a host sent to their DVA and hasn't spent |
| `escrow:<booking>` | booking | credit (liability) | Payment held for a booking until release |
| `vendor_payable:<house>` | vendor | credit (liability) | Released to the vendor, awaiting payout |
| `payout_in_transit` | platform | credit (liability) | Payout sent to Paystack Transfers, not yet confirmed |
| `platform_fees` | platform | credit (revenue) | Ówàńbè commission and fees |
| `processor_fees` | platform | debit (expense) | Paystack charges and transfer fees |
| `refunds_payable` | platform | credit (liability) | Refunds queued and not yet processed |

```sql
-- supabase/migrations/2026111000_ledger.sql  (follows the schema convention tests)
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null,                         -- 'user_wallet', 'escrow', ...
  owner_kind text not null check (owner_kind in ('platform','user','house','booking')),
  owner_id uuid,                              -- null for platform accounts
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  normal_side text not null check (normal_side in ('debit','credit')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (code, owner_kind, owner_id, currency)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,       -- e.g. 'paystack:charge:<reference>'
  kind text not null,                         -- 'dva_funding','booking_hold','release_70','release_30','refund','payout','fee','reversal'
  reverses_id uuid references public.journal_entries(id),
  booking_id uuid, actor text not null,       -- 'webhook:paystack' | 'router' | 'user:<id>' | 'staff:<id>'
  memo text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.postings (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id),
  account_id uuid not null references public.ledger_accounts(id),
  amount_minor bigint not null check (amount_minor <> 0),   -- + debit, - credit
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index on public.postings (account_id);

-- Invariant 1: each entry balances per currency (checked at commit)
create function app_private.assert_entry_balanced() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.postings p where p.entry_id = new.entry_id
             group by p.currency having sum(p.amount_minor) <> 0) then
    raise exception 'unbalanced_entry %', new.entry_id using errcode = '23514';
  end if; return null;
end $$;
create constraint trigger postings_balanced after insert on public.postings
  deferrable initially deferred for each row execute function app_private.assert_entry_balanced();

-- Invariant 2: append-only (reuse F-77's forbid_change)
create trigger journal_append_only before update or delete or truncate on public.journal_entries
  for each statement execute function app_private.forbid_change();
create trigger postings_append_only before update or delete or truncate on public.postings
  for each statement execute function app_private.forbid_change();

-- Balances (credit-normal accounts shown positive)
create view app_private.account_balances as
  select a.id, a.code, a.owner_kind, a.owner_id, a.currency,
         coalesce(sum(p.amount_minor), 0) * case a.normal_side when 'debit' then 1 else -1 end as balance_minor
  from public.ledger_accounts a left join public.postings p on p.account_id = a.id group by a.id;

-- The only write path: one call = one balanced entry, idempotent
create function app_private.post_entry(p_key text, p_kind text, p_actor text, p_booking uuid,
                                       p_lines jsonb)   -- [{account_id, amount_minor, currency}]
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.journal_entries (idempotency_key, kind, actor, booking_id)
  values (p_key, p_kind, p_actor, p_booking)
  on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is null then                       -- replayed webhook: return the original, post nothing
    select id into v_id from public.journal_entries where idempotency_key = p_key; return v_id;
  end if;
  insert into public.postings (entry_id, account_id, amount_minor, currency)
  select v_id, (l->>'account_id')::uuid, (l->>'amount_minor')::bigint, l->>'currency'
  from jsonb_array_elements(p_lines) l;
  return v_id;                               -- the deferred trigger rejects an unbalanced set at commit
end $$;
revoke all on function app_private.post_entry(text,text,text,uuid,jsonb) from public, anon, authenticated;

alter table public.ledger_accounts enable row level security; alter table public.ledger_accounts force row level security;
alter table public.journal_entries enable row level security; alter table public.journal_entries force row level security;
alter table public.postings enable row level security; alter table public.postings force row level security;
revoke all on public.ledger_accounts, public.journal_entries, public.postings from public, anon, authenticated;
-- Users read balances only through a projection, e.g. public.my_wallet() returning balance_minor + currency
```

**Rules:**

- Only `post_entry` writes, and only from server code (webhook handler, router, staff tools with second approval).
- No wallet may go negative. Check it in the router inside the same transaction, using `select … for update` on the account row.
- Daily reconciliation: the sum of Paystack `charge.success` minus fees for the day must equal the day's movement in `paystack_clearing`, and any difference opens a case.
- Ledger rows are financial records. Keep them when a user asks for erasure, and remove only the identifying fields as the retention schedule allows.

## Paystack Dedicated Virtual Accounts on sign-up

Use Paystack's single-step **assign** call after sign-up. It is asynchronous, so the account number arrives by webhook, and the sign-up flow never waits on it. Facts below come from [Paystack DVA guide](https://paystack.com/docs/payments/dedicated-virtual-accounts/) and [DVA API](https://paystack.com/docs/api/dedicated-virtual-account/).

**Constraints:**

- Only registered Nigerian or Ghanaian businesses that have completed go-live can create DVAs.
- The default cap is **1,000 DVAs** per business, and raising it needs a review by email.
- Nigerian businesses in the Financial services or General services categories must validate the customer (BVN + bank account).
- DVAs should only be used with the customer's express consent.

**Recommendation:** trigger assignment at sign-up only after the `payments.dva` consent and a verified identity. Until Paystack raises the cap, users who haven't consented get a standard checkout instead.

**Flow:**

1. Sign-up completes (F-76 `ensure_user`), the user consents to `payments.dva`, and they pass identity verification.
2. The server inserts `virtual_accounts(user_id, status='requested')`. An outbox job then calls `POST https://api.paystack.co/dedicated_account/assign` with `email`, `first_name`, `last_name`, `phone`, `preferred_bank`, `country: 'NG'`, plus `bvn`, `account_number`, `bank_code` if validation is required. Paystack replies "Assign dedicated account in progress".
3. The webhook `dedicatedaccount.assign.success` stores the bank, account number and account name, sets status `active`, and creates the user's `user_wallet` ledger account. On `dedicatedaccount.assign.failed`, the status becomes `failed` with the reason, and the user is offered a retry. Paystack's guide also names `assigndedicatedaccount.*`, so handle both names until a test run confirms which.
4. When a customer transfers in, Paystack sends `charge.success` with `authorization.channel = 'dedicated_nuban'`. Map `receiver_bank_account_number` to the user, then post the ledger entry `dva_funding` (debit `paystack_clearing`, credit `user_wallet`; fees go to `processor_fees`).
5. Recovery: if no webhook arrives within 10 minutes, call `GET /dedicated_account/requery` (allowed once every 10 minutes per account), or fetch the customer and read `dedicated_account`.

```ts
// src/lib/payments/dva.server.ts
const PAYSTACK = 'https://api.paystack.co'
const ps = (path: string, init: RequestInit = {}) => fetch(PAYSTACK + path, { ...init,
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json' },
  signal: AbortSignal.timeout(20_000) })

export async function requestDva(userId: string) {
  const u = await loadUserForDva(userId)        // name, email, phone (E.164), consent + KYC flags
  if (!u.consents.includes('payments.dva')) throw new Error('consent_required')
  if (!u.identityVerified) throw new Error('kyc_required')
  const preferred = process.env.NODE_ENV === 'production' ? process.env.PAYSTACK_DVA_BANK! : 'test-bank'  // e.g. 'titan-paystack' | 'wema-bank'
  const res = await ps('/dedicated_account/assign', { method: 'POST', body: JSON.stringify({
    email: u.email, first_name: u.firstName, last_name: u.lastName, phone: u.phone,
    preferred_bank: preferred, country: 'NG',
    ...(u.validation && { bvn: u.validation.bvn, account_number: u.validation.accountNumber, bank_code: u.validation.bankCode }),
  }) })
  const body = await res.json()
  await markDva(userId, body.status ? 'pending' : 'failed', body.message)   // BVN is never stored
}

// src/routes/api/public/paystack/webhook.ts  (extend the existing route)
import { createHmac, timingSafeEqual } from 'node:crypto'
export async function POST({ request }: { request: Request }) {
  const raw = await request.text()                                   // verify the RAW body
  const sig = request.headers.get('x-paystack-signature') ?? ''
  const mac = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(raw).digest('hex')
  if (sig.length !== mac.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(mac)))
    return new Response('bad signature', { status: 401 })
  const evt = JSON.parse(raw)
  await db.from('payment_events').upsert({ provider: 'paystack', event: evt.event,
    reference: evt.data?.reference ?? evt.data?.id?.toString(), payload_redacted: redact(evt) })
    }, { onConflict: 'provider,event,reference', ignoreDuplicates: true })   // store once
  queue('paystack-event', evt)                                       // Trigger.dev job; answer fast
  return new Response('ok', { status: 200 })                         // Paystack retries non-200s for 72h
}

// Trigger.dev job body (abridged)
switch (evt.event) {
  case 'dedicatedaccount.assign.success': case 'assigndedicatedaccount.success':
    await activateDva(evt.data.customer.email, evt.data.dedicated_account); break
  case 'charge.success':
    if (evt.data.authorization?.channel === 'dedicated_nuban') {
      const user = await userByDva(evt.data.authorization.receiver_bank_account_number)
      await verifyTransaction(evt.data.reference)                    // GET /transaction/verify/:ref before crediting
      await postEntry(`paystack:charge:${evt.data.reference}`, 'dva_funding', 'webhook:paystack', null, [
        { account: 'paystack_clearing', amount_minor: +evt.data.amount - evt.data.fees },
        { account: 'processor_fees', amount_minor: +evt.data.fees },
        { account: `user_wallet:${user.id}`, amount_minor: -evt.data.amount },
      ])
    } else { await routeCheckoutCharge(evt.data) }
    break
  case 'transfer.success': case 'transfer.failed': case 'transfer.reversed':
    await settlePayout(evt.data); break
  case 'refund.processed': case 'refund.failed': await settleRefund(evt.data); break
}
```

**Optional:** Paystack's inbound-transfer approval (Titan only) lets Ówàńbè accept or reject a transfer within 5 seconds before it lands. If the endpoint is unreachable, the transfer is auto-accepted. Use it later to reject transfers to deactivated accounts.

## AI Payment Router on Paystack

The router is a deterministic state machine that decides where each kobo goes, posts the ledger entry, and calls Paystack. The AI layer sits beside it as an advisor. It scores risk, explains failures and investigates stuck payments, but it has **no credentials that can move money**. Every action it suggests goes through the router's own rules or a human approval.

**Routing rules (deterministic, in code):**

| Event | Ledger entry | Paystack call |
| --- | --- | --- |
| Host pays a booking from wallet | `booking_hold`: debit `user_wallet`, credit `escrow:<booking>` | none (internal move) |
| Host pays a booking by card or transfer checkout | `booking_hold`: debit `paystack_clearing` (net) + `processor_fees`, credit `escrow:<booking>` | Transaction initialize/verify |
| Booking confirmed | `release_70`: debit `escrow` 70%, credit `vendor_payable` 70% minus commission, credit `platform_fees` commission | none |
| Host confirms completion, or the window lapses with no dispute | `release_30`: the remaining 30%, same split | none |
| Payout run (vendor owner's verified account) | `payout`: debit `vendor_payable`, credit `payout_in_transit` | `POST /transfer` (source balance, `RCP_` recipient, UUID v4 reference) |
| `transfer.success` | `payout_settled`: debit `payout_in_transit`, credit `paystack_clearing` | none |
| `transfer.failed` / `transfer.reversed` | reversal: back to `vendor_payable` | alert ops |
| Host cancels within 24 h of payment | `refund`: 80% back to the host, 20% of the full quote forfeited (PRD rule) | `POST /refund` (partial `amount`) or a wallet credit |
| Vendor cancels or no-shows | full refund to the host, plus a trust event | `POST /refund` |
| Dispute opened or payout locked | freeze: no release or payout from that `escrow` or `vendor_payable` | none |

**Guardrails (all enforced server-side):**

- **Idempotency:** each step's key is derived from the booking and the step (`booking:<id>:release_70`), and Paystack references are UUID v4 (Paystack allows at most 50 characters, minimum 16). Retrying a step can never double-post or double-pay.
- **Verify before credit:** call `GET /transaction/verify/:reference` before any `booking_hold` or `dva_funding` entry. Webhooks need a valid signature and are processed once.
- **Payout safety:** payouts go only to the owner's verified recipient, never during the 48-hour post-recovery lock or an open dispute. Large amounts above the owner-set threshold need two distinct staff approvals.
- **Concurrency:** lock the escrow or wallet row (`select … for update`), check the balance, post, then commit. First confirmed payment wins a date race, and the loser is refunded automatically (F-38 rules).
- **Kill switch:** an `ops.payments_paused` flag stops new payouts and refunds but keeps intake running. It is set automatically during a Paystack outage.

**What the AI does (advisory, read-only):**

1. **Risk score before release or payout.** It sees a redacted projection (amounts, timings, trust score, dispute history, device or velocity signals) and returns `low/medium/high` plus reasons. High routes the payout to manual review; it never blocks or releases on its own.
2. **Failed-payment tracer.** On `charge.failed`, a stuck `pending` or `transfer.failed`, it gathers the event log, Paystack verify results and ledger state. It then writes a plain-language explanation for the host or vendor and a suggested fix for ops.
3. **Smart rail suggestion.** It suggests to the host whether wallet, DVA transfer or card is cheapest and fastest for this payment. The host chooses.
4. **Reconciliation assistant.** It explains daily mismatches between Paystack settlement and `paystack_clearing`, and drafts the case for finance.

The AI runs through the Vercel AI SDK with a ZDR-approved model, read-only tools (`getLedgerProjection`, `getPaystackVerify`, `getEventLog`), and a human-readable reason stored with every suggestion. This matches the PRD's "AI Investigation-only Role".

```ts
// src/lib/payments/router.server.ts  (abridged)
export async function releaseTranche(bookingId: string, tranche: 'release_70' | 'release_30', actor: string) {
  return db.transaction(async (tx) => {
    const b = await tx.lockBooking(bookingId)                         // select ... for update
    if (b.disputeOpen || b.payoutLocked) throw new Error('frozen')
    if (tranche === 'release_30' && !(b.completedAt || b.completionWindowLapsed)) throw new Error('not_due')
    const pct = tranche === 'release_70' ? 70n : 30n
    const gross = (b.quoteTotalMinor * pct) / 100n                  // bigint kobo, no floats
    const fee = (gross * BigInt(b.commissionBps)) / 10_000n
    const risk = await advisor.scoreRelease(redact(b))                // advisory only
    if (risk.level === 'high') return tx.queueManualReview(bookingId, tranche, risk.reasons)
    return tx.postEntry(`booking:${bookingId}:${tranche}`, tranche, actor, bookingId, [
      { account: `escrow:${bookingId}`, amount_minor: gross },        // debit escrow (liability down)
      { account: `vendor_payable:${b.vendorHouseId}`, amount_minor: -(gross - fee) },
      { account: 'platform_fees', amount_minor: -fee },
    ])
  })
}
```

The 70/30 split, the 24-hour windows and the 20% forfeit come from the PRD. Commission (`commissionBps`) and the large-amount threshold are owner decisions still open.

## Build plan, open questions and sources

Build these six steps in order on `develop`, each with its feature ID in commits and a journal entry. Steps 1 to 3 need no money to move, so they can start now.

| Step | Deliverable | Maps to (Sage 7) | Gate |
| --- | --- | --- | --- |
| 1 | `consents` table, consent screens, withdraw UI, `active_consent()` | Biometric/consent, NIN/BVN Identity Verification | DPIA draft done |
| 2 | `KycProvider` + vNIN and CAC server functions, `kyc_checks`, review queue | NIN/BVN Identity Verification, Vendor Vetting at Sign-up, Manual CAC/NIMC/BVN Verification | Provider DPA signed, sandbox passes |
| 3 | Ledger tables, `post_entry`, balance projections, SQL tests | Data model, Payment Data Protection (F-60) | Schema convention tests green |
| 4 | Webhook intake (raw-body HMAC, `payment_events`, Trigger.dev job) | Live Payment Status Tracker | Paystack test mode |
| 5 | DVA assignment + funding | **new, propose in Sage 7** | Paystack go-live, cap raised or lazy assignment chosen |
| 6 | Router (holds, 70/30 releases, refunds, payouts), then AI advisor | Payment Router & Banking Integrations, Split Payment, AI Investigation-only Role | Licence question answered, threshold set |

**Open questions for the owner:**

- [ ] Does holding customer wallet balances require a CBN licence or a licensed partner? Get a legal opinion before step 6.
- [ ] Which KYC provider: Prembly for both checks, or VerifyMe plus Dojah?
- [ ] Should a DVA be assigned to every user at sign-up, or only to verified users who opt in? This depends on the 1,000 cap.
- [ ] What is the platform commission (basis points) and the large-refund threshold?
- [ ] Which Paystack business category is Ówàńbè registered under? It decides whether BVN validation is required.
- [ ] Where is data hosted (Supabase and Sentry regions, AI provider), and on what transfer basis?

**Sources (opened 2026-11-08):**

- [O3 Legal: audit returns and NDPC enforcement](https://o3legal.com/briefing-data-protection-audit-returns)
- [DLA Piper: NDPC issues GAID](https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/)
- [Banwo & Ighodalo: NDPA and GAID synopsis](https://www.banwo-ighodalo.com/grey-matter/synoptic-analysis-of-the-nigeria-data-protection-act-general-application-and-implementation-directive-gaid-2025/)
- [Afriwise: breach obligations under NDPA 2023](https://www.afriwise.com/blog/data-breaches-compliance-obligations-under-the-nigerian-data-protection-act-2023)
- [CookieYes: NDPA overview](https://www.cookieyes.com/blog/nigeria-data-protection-act-ndpa/)
- [Paystack: Dedicated Virtual Accounts guide](https://paystack.com/docs/payments/dedicated-virtual-accounts/) · [DVA API](https://paystack.com/docs/api/dedicated-virtual-account/) · [Transfers](https://paystack.com/docs/transfers/single-transfers/) · [Refunds](https://paystack.com/docs/api/refund/) · [Webhooks](https://paystack.com/docs/payments/webhooks/)
- [Dojah: vNIN](https://dojah.io/blog/virtual-nin-verification) · [CAC lookup](https://docs.dojah.io/api-reference/business-verification/lookup-cac.md) · [BVN validate](https://docs.dojah.io/api-reference/individual-verification/nigeria/validate-bvn.md) · [Auth](https://docs.dojah.io/api-reference/get-started/authentication.md)
- [Prembly: NIN and vNIN](https://docs.prembly.com/docs/nin-and-virtual-nin-copy) · [VerifyMe: vNIN](https://docs.verifyme.ng/identity-verifications/match-1)
