-- CrowdLens schema: photos table, daily-limit trigger, RLS, storage buckets.

create table photos (
  id uuid primary key default gen_random_uuid(),
  client_token text not null,
  group_name text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_date date not null default ((now() at time zone 'Europe/Budapest')::date),
  created_at timestamptz not null default now()
);

create index idx_photos_token_date on photos(client_token, submitted_date);
create index idx_photos_status_group on photos(status, group_name);

-- Atomic daily limit: advisory lock serializes concurrent inserts per token.
-- security definer: the count must see all rows, not what anon's RLS allows.
create or replace function enforce_daily_limit()
returns trigger
security definer set search_path = public
as $$
declare
  current_count int;
begin
  perform pg_advisory_xact_lock(hashtext(new.client_token));

  select count(*) into current_count
  from photos
  where client_token = new.client_token
    and submitted_date = new.submitted_date;

  -- Keep in sync with DAILY_LIMIT in src/lib/config.js.
  if current_count >= 3 then
    raise exception 'Daily photo limit reached';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_daily_limit
before insert on photos
for each row execute function enforce_daily_limit();

alter table photos enable row level security;

-- Participants may only create pending rows dated today (camp timezone) —
-- prevents self-approving or backdating around the daily limit.
create policy "anon can insert pending today" on photos
for insert to anon
with check (
  status = 'pending'
  and submitted_date = ((now() at time zone 'Europe/Budapest')::date)
);

create policy "anon can view approved" on photos
for select to anon
using (status = 'approved');

create policy "staff full access" on photos
for all to authenticated
using (true) with check (true);

-- Storage: private bucket for pending/rejected originals, public bucket for
-- approved photos (per-prefix public access isn't possible in one bucket).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pending', 'pending', false, 10485760, array['image/jpeg']),
  ('approved', 'approved', true, 10485760, array['image/jpeg']);

create policy "anyone can upload pending" on storage.objects
for insert to anon, authenticated
with check (bucket_id = 'pending');

create policy "staff can read pending" on storage.objects
for select to authenticated
using (bucket_id = 'pending');

create policy "staff can delete pending" on storage.objects
for delete to authenticated
using (bucket_id = 'pending');

create policy "public can read approved" on storage.objects
for select to anon, authenticated
using (bucket_id = 'approved');

create policy "staff can write approved" on storage.objects
for insert to authenticated
with check (bucket_id = 'approved');

-- Un-approving a photo removes it from the public bucket.
create policy "staff can delete approved" on storage.objects
for delete to authenticated
using (bucket_id = 'approved');
