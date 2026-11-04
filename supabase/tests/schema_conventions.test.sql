-- Schema conventions (F-77). Runs after all migrations; applies to every table in public,
-- so tables added by later features are held to the same rules automatically.
\set ON_ERROR_STOP on
do $$
declare r record; problems text[] := '{}';
begin
  for r in select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' loop
    -- uuid primary key "id" with a generated default
    if not exists (select 1 from information_schema.columns col
                   join information_schema.table_constraints tc on tc.table_schema = 'public' and tc.table_name = r.relname and tc.constraint_type = 'PRIMARY KEY'
                   join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = 'public' and k.column_name = 'id'
                   where col.table_schema = 'public' and col.table_name = r.relname and col.column_name = 'id'
                     and col.data_type = 'uuid' and col.column_default like 'gen_random_uuid()%') then
      problems := problems || format('%s: needs uuid primary key "id" default gen_random_uuid()', r.relname);
    end if;
    if not (r.relrowsecurity and r.relforcerowsecurity) then
      problems := problems || format('%s: RLS must be enabled and forced', r.relname);
    end if;
    if r.relname <> 'audit_events' and (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = r.relname
          and column_name in ('created_at', 'updated_at', 'version')) <> 3 then
      problems := problems || format('%s: needs created_at, updated_at, version', r.relname);
    end if;
    if has_table_privilege('anon', r.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', r.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      problems := problems || format('%s: clients must not write directly', r.relname);
    end if;
    if has_table_privilege('anon', r.oid, 'SELECT') then
      problems := problems || format('%s: anon must not read tables (use projections)', r.relname);
    end if;
  end loop;

  -- UTC timestamps only; integer minor units with an explicit currency for money
  for r in select table_name, column_name, data_type from information_schema.columns
           where table_schema = 'public' loop
    if r.data_type in ('timestamp without time zone', 'time without time zone', 'time with time zone') then
      problems := problems || format('%s.%s: use timestamptz', r.table_name, r.column_name);
    end if;
    if r.data_type in ('real', 'double precision', 'numeric', 'money') then
      problems := problems || format('%s.%s: no float/numeric/money types; use bigint *_minor', r.table_name, r.column_name);
    end if;
    if (r.column_name like '%\_minor' or r.column_name like '%amount%') then
      if r.data_type <> 'bigint' or r.column_name not like '%\_minor' then
        problems := problems || format('%s.%s: money columns are bigint named *_minor', r.table_name, r.column_name);
      end if;
      if not exists (select 1 from information_schema.columns c2 where c2.table_schema = 'public'
                     and c2.table_name = r.table_name and c2.column_name like '%currency') then
        problems := problems || format('%s.%s: money needs a currency column', r.table_name, r.column_name);
      end if;
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception E'schema convention violations:\n  %', array_to_string(problems, E'\n  ');
  end if;
end $$;
\pset tuples_only on
select 'Schema conventions passed' as result;
