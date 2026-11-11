-- F-107 follow-up: open the zero-retention gate
--
-- The owner answered the question this feature raised (Sage 7 question 3e793b14, answered
-- 2026-11-10): "Lovable has ZDR and gpt also has ZDR in place so this is okay to function now."
-- The gate was built closed on purpose, and the only thing that was missing was the contract.
-- It now exists, so this file records it.
--
-- What this file does:
--   * writes the owner's confirmation into app_private.ai_settings, with the provider, a reference
--     back to the answer, and the moment it was confirmed.
--   * leaves the table revoked from every application role. The gate is still the owner's: no
--     application path opens it, and closing it again is one statement (below).
--
-- What this file does NOT do:
--   * it does not weaken the trail. The payment log stays minimised, every read is still a
--     sensitive read with a purpose, and the 'ai_investigation' grant still carries no fund
--     authority. OwanbeAI can read and open a case; it cannot move money.
--   * it does not close F-65. The zero-retention feature is about the contract itself and stays
--     open; this file only records the owner's confirmation that the platform's current provider
--     already holds one.
--
-- To close the gate again, run this as the database owner:
--
--   update app_private.ai_settings
--      set zdr_confirmed = false,
--          zdr_provider = null,
--          zdr_contract_ref = null,
--          zdr_confirmed_at = null,
--          zdr_confirmed_by = null,
--          updated_at = now()
--    where id;

update app_private.ai_settings
   set zdr_confirmed = true,
       zdr_provider = 'Lovable AI Gateway (OpenAI gpt, zero data retention)',
       zdr_contract_ref = 'owner confirmation 2026-11-10, Sage 7 question 3e793b14',
       zdr_confirmed_at = now(),
       zdr_confirmed_by = null,
       updated_at = now()
 where id;

comment on table app_private.ai_settings is
  'F-107: the platform''s AI settings. One row. The zero-retention gate was closed until the owner recorded a contracted provider here; it was opened on 2026-11-10 when the owner confirmed that the platform''s provider (Lovable AI Gateway, OpenAI gpt) holds a zero-data-retention agreement.';
