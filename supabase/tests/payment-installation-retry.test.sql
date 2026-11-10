-- After base migrations, verify old installation -> combined installation -> retry.
\ir ../../docs/sql/2026-11-10-cancellation-tokens-dva.sql
\ir ../../docs/sql/2026-11-10-f13-booking-completion.sql

create temporary table payment_installation_before as
select oid, relname from pg_class
where oid in ('public.booking_cancellations'::regclass,
              'public.payment_authorizations'::regclass,
              'public.dedicated_accounts'::regclass,
              'public.quote_requests'::regclass);

\ir ../../docs/sql/2026-11-10-f13-booking-completion.sql

do $$
begin
  if (select count(*) from payment_installation_before b
      join pg_class c on c.oid = b.oid and c.relname = b.relname) <> 4 then
    raise exception 'Retry must retain all four existing tables, not drop/recreate them';
  end if;
  if has_function_privilege('anon', 'public.cancel_booking(uuid,text)', 'execute') then
    raise exception 'Retry must not grant anonymous cancellation access';
  end if;
  if has_function_privilege('authenticated',
      'public.save_payment_authorization(uuid,text,text,text,text,text,boolean)', 'execute') then
    raise exception 'Retry must retain service-only authorization writes';
  end if;
  if app_private.cancellation_refund_minor('host', 10000, 31) <> 8000 then
    raise exception 'Host refund above 30 days must remain 80 percent';
  end if;
end $$;
drop table payment_installation_before;