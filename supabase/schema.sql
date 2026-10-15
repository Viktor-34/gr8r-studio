-- Gr8r Studio: database schema for the Supabase backend.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- Every object in the workspace (task, comment, member, project…) is one row.
-- `collection` names the list it belongs to; 'meta' rows hold single settings.
create table if not exists public.records (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  seq        bigint generated always as identity,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);

create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records
  for each row execute function public.records_touch();

-- Only signed-in people can read or write. Sign-ups are switched off in the dashboard,
-- so "signed in" means "invited by the owner".
alter table public.records enable row level security;

drop policy if exists "members read" on public.records;
create policy "members read" on public.records
  for select to authenticated using (true);

drop policy if exists "members write" on public.records;
create policy "members write" on public.records
  for all to authenticated using (true) with check (true);

-- Live updates between open browsers.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
