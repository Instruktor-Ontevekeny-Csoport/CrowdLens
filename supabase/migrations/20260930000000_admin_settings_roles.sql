-- Admin settings + staff roles. Supersedes the hardcoded limit in
-- 20260901104843_limit-3-photos.sql: limits, the submission switch and the
-- group list now live in app_settings and are enforced here.

-- Roles ---------------------------------------------------------------------
create table public.staff_users (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin','organizer','moderator')),
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.staff_users enable row level security;

-- 0 = no access, 1 = moderator, 2 = organizer, 3 = admin.
-- Requires a confirmed email so an unconfirmed password signup with an
-- allowlisted address cannot hijack a role.
create or replace function public.staff_rank() returns int
language sql stable security definer set search_path = public, auth as $$
  select coalesce((
    select case s.role when 'admin' then 3 when 'organizer' then 2 when 'moderator' then 1 end
    from public.staff_users s
    join auth.users u on lower(u.email) = s.email
    where u.id = auth.uid() and u.email_confirmed_at is not null
  ), 0)
$$;
grant execute on function public.staff_rank() to anon, authenticated;

create policy "admins manage staff" on public.staff_users
  for all to authenticated
  using ((select public.staff_rank()) >= 3)
  with check ((select public.staff_rank()) >= 3);

-- Signed-in admins can never delete/demote the last admin. Service role and
-- direct SQL are exempt (recovery, test cleanup).
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.staff_users where role = 'admin' and email <> old.email) then
    raise exception 'Cannot remove the last admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_last_admin before update or delete on public.staff_users
  for each row execute function public.guard_last_admin();

-- Settings ------------------------------------------------------------------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  submissions_open boolean not null default true,
  daily_limit int not null default 3 check (daily_limit between 1 and 50),
  group_mode boolean not null default true,
  groups jsonb not null default '[]'::jsonb
    check (jsonb_typeof(groups) = 'array' and jsonb_array_length(groups) <= 200),
  tagline_hu text not null default '' check (length(tagline_hu) <= 120),
  tagline_en text not null default '' check (length(tagline_en) <= 120),
  notice_hu  text not null default '' check (length(notice_hu)  <= 4000),
  notice_en  text not null default '' check (length(notice_en)  <= 4000),
  last_publish_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Same list as DEFAULTS.groups in src/lib/settings.defaults.js.
insert into public.app_settings (id, groups) values (1, '[
  "A","B","C","D","E","F","G","H","J","K","L","M","N","S","R","T",
  "FOK1","FOK2","GYOK1","GYOK2","GYOK3","PAK","I","IE1","IE2","ID1","ID2","ID3",
  "Cirka","Csillag","DekorChill","Fütyikocsi","Gyros","Joker","Hotdog","Kapu",
  "Koktél","Maki","Parancsnoki Maca","Raktár-tesco","Piaraktár","Ranger",
  "Söröző","Sörsátor","Teaház","Streetfood","Tábori rádió","KFT","Vezetőség"
]'::jsonb);

alter table public.app_settings enable row level security;
create policy "anyone can read settings" on public.app_settings
  for select to anon, authenticated using (true);
create policy "organizers can update settings" on public.app_settings
  for update to authenticated
  using ((select public.staff_rank()) >= 2)
  with check ((select public.staff_rank()) >= 2);
-- No insert/delete policies: the single row is seeded above.

-- updated_at only moves when a participant-visible setting changes, so
-- recording a publish does not look like an unpublished change.
create or replace function public.touch_app_settings() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - '{last_publish_at,updated_at,updated_by}'::text[])
     is distinct from (to_jsonb(old) - '{last_publish_at,updated_at,updated_by}'::text[]) then
    new.updated_at := now();
    new.updated_by := auth.jwt() ->> 'email';
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;
create trigger trg_touch_app_settings before update on public.app_settings
  for each row execute function public.touch_app_settings();

-- Helper for the storage policy (anon must be able to evaluate it).
create or replace function public.submissions_open() returns boolean
language sql stable security definer set search_path = public as $$
  select submissions_open from public.app_settings where id = 1
$$;
grant execute on function public.submissions_open() to anon, authenticated;

-- One round-trip bootstrap for the moderate page.
create or replace function public.moderate_bootstrap() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rank', public.staff_rank(), 'settings', to_jsonb(a.*))
  from public.app_settings a where a.id = 1
$$;
grant execute on function public.moderate_bootstrap() to authenticated;

-- photos ----------------------------------------------------------------------
alter table public.photos alter column group_name drop not null;

create or replace function public.enforce_daily_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  current_count int;
begin
  select * into s from public.app_settings where id = 1;
  if not s.submissions_open then
    raise exception 'Submissions are closed';
  end if;
  if s.group_mode then
    if new.group_name is null or not (s.groups ? new.group_name) then
      raise exception 'Invalid group';
    end if;
  else
    new.group_name := null;
  end if;

  -- Atomic daily limit: advisory lock serializes concurrent inserts per token.
  perform pg_advisory_xact_lock(hashtext(new.client_token));
  select count(*) into current_count from public.photos
    where client_token = new.client_token and submitted_date = new.submitted_date;
  if current_count >= s.daily_limit then
    raise exception 'Daily photo limit reached';
  end if;
  return new;
end $$;
-- trg_enforce_daily_limit already exists and keeps pointing at this function.

-- Signed-in staff may only change a photo's status and storage_path.
create or replace function public.restrict_photo_update() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (to_jsonb(new) - '{status,storage_path}'::text[])
         is distinct from (to_jsonb(old) - '{status,storage_path}'::text[]) then
    raise exception 'Only status and storage_path can be changed';
  end if;
  return new;
end $$;
create trigger trg_restrict_photo_update before update on public.photos
  for each row execute function public.restrict_photo_update();

-- Replace the "any authenticated user is staff" policy.
drop policy "staff full access" on public.photos;
create policy "staff read" on public.photos for select to authenticated
  using ((select public.staff_rank()) >= 1);
create policy "staff moderate" on public.photos for update to authenticated
  using ((select public.staff_rank()) >= 1) with check ((select public.staff_rank()) >= 1);
create policy "admins delete" on public.photos for delete to authenticated
  using ((select public.staff_rank()) >= 3);
-- Signed-in users (staff or not) can still use the participant pages.
create policy "authenticated can view approved" on public.photos
  for select to authenticated using (status = 'approved');
create policy "authenticated can insert pending today" on public.photos
  for insert to authenticated
  with check (
    status = 'pending'
    and submitted_date = ((now() at time zone 'Europe/Budapest')::date)
  );

-- storage.objects -------------------------------------------------------------
drop policy "anyone can upload pending" on storage.objects;
create policy "upload pending when open" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'pending' and public.submissions_open());

drop policy "staff can read pending" on storage.objects;
drop policy "staff can delete pending" on storage.objects;
drop policy "staff can write approved" on storage.objects;
drop policy "staff can delete approved" on storage.objects;
create policy "staff read pending" on storage.objects for select to authenticated
  using (bucket_id = 'pending' and (select public.staff_rank()) >= 1);
create policy "admins delete pending" on storage.objects for delete to authenticated
  using (bucket_id = 'pending' and (select public.staff_rank()) >= 3);
create policy "staff write approved" on storage.objects for insert to authenticated
  with check (bucket_id = 'approved' and (select public.staff_rank()) >= 1);
create policy "staff delete approved" on storage.objects for delete to authenticated
  using (bucket_id = 'approved' and (select public.staff_rank()) >= 1);
-- Approving moves the file pending → approved; un-approving moves it back.
create policy "staff move between buckets" on storage.objects for update to authenticated
  using (bucket_id in ('pending', 'approved') and (select public.staff_rank()) >= 1)
  with check (bucket_id in ('pending', 'approved') and (select public.staff_rank()) >= 1);
-- "public can read approved" stays.
