# CrowdLens — Admin Settings & Staff Roles: Implementation Plan

Audience: a coding agent working in this repo (Vite + React multi-page, Supabase direct from the browser, no router).
Read `README.md`, `BUILD-PLAN.md`, `supabase/migrations/*.sql`, `src/lib/*`, and the three `src/*/App.jsx` files before starting.

---

## 0. Goals

1. Organizers/admins customize, from `/moderate/`: daily photo limit, submission master switch, important notice, tagline, group list, group-mode switch.
2. A prominent "Open app" button on the moderate page.
3. Staff accounts with three roles — `admin` (everything, incl. users), `organizer` (moderate + settings), `moderator` (moderate only) — managed by an admin from the moderate page.
4. Minimal Supabase free-tier usage. Display settings are baked in at **build time**; participants' pages make **zero** extra requests for settings.

## 1. Key design decisions (already made — do not re-litigate)

| Topic | Decision | Why |
|---|---|---|
| Settings storage | One row in `app_settings` (`id = 1`), plain columns | 1 read / 1 write; column types give validation |
| Settings delivery to participants | Baked into the bundle at build via `vite.config.js` `define` (`__APP_SETTINGS__`) | Zero runtime requests; matches "build-time is enough" |
| Enforcement of master switch, daily limit, group validity | **Server-side in Postgres** (trigger + storage policy) reading `app_settings` | UI is bypassable; in-DB lookups cost no API requests. Also means the switch/limit take effect **immediately**, before any rebuild |
| Roles | `staff_users(email pk, role)` allowlist + `staff_rank()` SQL function used by all RLS policies | Simple, no JWT-refresh lag, no Auth hook to configure |
| Sign-in | **Google SSO** (primary) + existing email/password (kept) | Hosted Supabase's built-in email sender only delivers to project team members and is heavily rate-limited, so email invites/magic links would need custom SMTP. Google SSO needs no email sending. Admin-defined passwords are not built (see §9) |
| Provisioning | Admin adds `email + role` to the allowlist; person signs in with Google; role applies automatically by email match | No Edge Function needed for user management |
| Group storage | Keep storing the group **name** as text in `photos.group_name` (as today). Group mode off ⇒ `group_name = NULL` | Minimal change; existing photos/paths keep working |
| Publishing | Settings screen shows "unpublished changes" by comparing live `updated_at` with the baked one; optional Publish button calls an Edge Function that hits a deploy hook (Phase 5) | Cheap, works even if deploy hook isn't available |

### Request budget (per action)
- Participant page load: **0** settings requests. Upload: 1 storage upload + 1 insert (trigger reads settings inside Postgres — not an API request).
- Gallery load: 1 (unchanged).
- Moderate page load: **1** `rpc('moderate_bootstrap')` (returns role rank + settings row) + queue query (unchanged).
- Users tab: 1 list query. Settings save: 1 update. Publish: 1 Edge Function call.
- Do **not** use Realtime, polling, or refetch on `TOKEN_REFRESHED` auth events (only refetch bootstrap when the user id changes).

## 2. Pre-existing facts the agent must know

- `supabase/config.toml` has `enable_signup = true` and the `photos`/storage policies grant **all** `authenticated` users full staff access (`using (true)`). Enabling Google sign-in without first replacing those policies would let **any Google account** moderate. **Phase 1 (policies) must ship and be applied before Google is enabled in production.**
- The daily limit is hardcoded in the trigger (`>= 3`) and in `src/lib/config.js`; the consent copy in `src/lib/i18n.js` hardcodes "3 photos" in both languages.
- `src/lib/config.js` exports `GROUPS` (~49 names), `DAILY_LIMIT`, `CAMP_TIMEZONE`, `PENDING_BUCKET`, `APPROVED_BUCKET`. `GROUPS`/`DAILY_LIMIT` are used by `upload/App.jsx`, `gallery/App.jsx`, `moderate/App.jsx`, `lib/identity.js`, and tests.
- Approval copies `pending/{id}.jpg` → `approved/{slugified-group}/{id}.jpg`. With group mode off use folder `ungrouped`.
- `index.html` loads `/_vercel/insights/script.js`, so hosting is most likely Vercel; README says Cloudflare Pages drag-and-drop. **Drag-and-drop deploys have no deploy hook** — Phase 5 only works with a Git-connected host (Vercel/Cloudflare Pages Git integration). Phases 1–4 work regardless.
- Notice modal currently renders `t('consent')` (title `importantNotice`). "Important notice" setting = override of that body text. Tagline setting = override of `t('tagline')`. Both are HU/EN.
- Moderation queue does `select('*')` with no pagination; `max_rows = 1000` silently truncates. Not in scope, but do not make it worse; consider a follow-up.

## 3. Phase 1 — Database migration (`supabase/migrations/<timestamp>_admin_settings_roles.sql`)

Sketch below; the agent must finish/verify it with the backend tests in §8.

```sql
-- 3.1 Roles ---------------------------------------------------------------
create table public.staff_users (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin','organizer','moderator')),
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.staff_users enable row level security;

-- 0 = no access, 1 = moderator, 2 = organizer, 3 = admin.
-- Requires a CONFIRMED email so an unconfirmed password signup with an
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

-- Never allow the last admin to be deleted/demoted.
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.staff_users where role = 'admin' and email <> old.email) then
    raise exception 'Cannot remove the last admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_last_admin before update or delete on public.staff_users
  for each row execute function public.guard_last_admin();

-- 3.2 Settings --------------------------------------------------------------
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
-- SEED: copy the current GROUPS array from src/lib/config.js into `groups`
-- (as a JSON array of strings) so behaviour is unchanged after migration.
insert into public.app_settings (id, groups) values (1, '[ ...current GROUPS... ]'::jsonb);

alter table public.app_settings enable row level security;
create policy "anyone can read settings" on public.app_settings
  for select to anon, authenticated using (true);
create policy "organizers can update settings" on public.app_settings
  for update to authenticated
  using ((select public.staff_rank()) >= 2)
  with check ((select public.staff_rank()) >= 2);
-- no insert/delete policies: the single row is seeded here.

create or replace function public.touch_app_settings() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end $$;
create trigger trg_touch_app_settings before update on public.app_settings
  for each row execute function public.touch_app_settings();

-- Helper for storage policy (anon must be able to evaluate it).
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

-- 3.3 photos ------------------------------------------------------------------
alter table public.photos alter column group_name drop not null;

create or replace function public.enforce_daily_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.app_settings; current_count int;
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
  perform pg_advisory_xact_lock(hashtext(new.client_token));
  select count(*) into current_count from public.photos
    where client_token = new.client_token and submitted_date = new.submitted_date;
  if current_count >= s.daily_limit then
    raise exception 'Daily photo limit reached';
  end if;
  return new;
end $$;
-- trigger trg_enforce_daily_limit already exists and keeps pointing at this function.

-- Replace the "any authenticated user is staff" policy.
drop policy "staff full access" on public.photos;
create policy "staff read" on public.photos for select to authenticated
  using ((select public.staff_rank()) >= 1);
create policy "staff moderate" on public.photos for update to authenticated
  using ((select public.staff_rank()) >= 1) with check ((select public.staff_rank()) >= 1);
create policy "admins delete" on public.photos for delete to authenticated
  using ((select public.staff_rank()) >= 3);
-- (anon policies stay as-is.)

-- 3.4 storage.objects ---------------------------------------------------------
drop policy "anyone can upload pending" on storage.objects;
create policy "upload pending when open" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'pending' and public.submissions_open());

drop policy "staff can read pending"  on storage.objects;
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
-- "public can read approved" stays.
```

Notes for the agent:
- Verify the exact existing policy names against `20260828000000_init.sql` before dropping.
- Keep the `select public.staff_rank()` wrapping (initPlan caching) in every policy.
- Optionally add a trigger restricting staff `update`s on `photos` to `status` and `storage_path` only.
- **Bootstrap (document in README, do not automate):** in the SQL editor run
  `insert into staff_users(email, role) values ('<owner-email-lowercase>', 'admin');`
  and add every existing password-based staff account as `moderator`/`organizer`, otherwise they are locked out after this migration.
- Update `20260901…limit-3-photos.sql` comment ("keep in sync with config.js") — no longer true; the new migration supersedes it.

## 4. Phase 2 — Build-time settings + participant pages

### 4.1 Loader
Create `scripts/load-settings.mjs` exporting `async loadSettings({ url, anonKey, strict })`:
- `GET {url}/rest/v1/app_settings?id=eq.1&select=*` with `apikey` + `Authorization: Bearer <anon>` headers; 5 s timeout.
- Returns the row (`groups` already an array).
- On failure: if `strict` → throw (fail the build); else warn and return `DEFAULTS` from `src/lib/settings.defaults.js` (values equal to today's hardcoded config: 3 / open / group mode on / current group list / empty texts / `updated_at: null`).
- `strict` = `process.env.CI || process.env.VERCEL || process.env.CF_PAGES` (override with `ALLOW_DEFAULT_SETTINGS=1`). A production deploy must never silently ship default settings.

Make `vite.config.js` `defineConfig(async ({ mode }) => …)`:
- `const env = loadEnv(mode, process.cwd(), '')`; base URL = `VITE_SUPABASE_URL` if it starts with `http`, else `SUPABASE_URL` env, else `http://127.0.0.1:54321` (dev proxy path `/sb` is not reachable from Node).
- Under Vitest (`process.env.VITEST`) skip the fetch and use `DEFAULTS`.
- Add `define: { __APP_SETTINGS__: JSON.stringify(settings) }`.
- Settings are read once when the dev server / build starts (document: restart dev after changing settings).

### 4.2 `src/lib/config.js`
Keep all current export names; source values from `typeof __APP_SETTINGS__ !== 'undefined' ? __APP_SETTINGS__ : DEFAULTS`:
`GROUPS`, `DAILY_LIMIT`, plus new `GROUP_MODE`, `SUBMISSIONS_OPEN`, `CUSTOM_TAGLINE = {hu,en}`, `CUSTOM_NOTICE = {hu,en}`, `SETTINGS_UPDATED_AT`. Remove the hardcoded group array (moved to `settings.defaults.js` and the migration seed).

### 4.3 `src/lib/i18n.js`
- Add helpers `getTagline(lang)` → `CUSTOM_TAGLINE[lang] || t('tagline', lang)` and `getNotice(lang)` → custom notice if non-empty, else `t('consent', lang)` + blank line + dynamic `t('dailyLimitLine', lang)` with `{n}` replaced by `DAILY_LIMIT`.
- Remove the hardcoded "3 photos per day" final paragraph from both `consent` strings; add `dailyLimitLine` (HU: `Naponta legfeljebb {n} képet tölthetsz fel.` / EN: `You may upload a maximum of {n} photos per day.`).
- New keys (HU + EN; `i18n.test.js` completeness test must pass): `submissionsClosed`, `submissionsClosedHint`, `groupInvalid`.

### 4.4 `src/upload/App.jsx`
- Tagline: `getTagline(lang)`. Notice modal body: `getNotice(lang)` (keeps `white-space: pre-line`, render as text — never `dangerouslySetInnerHTML`).
- `!SUBMISSIONS_OPEN` → replace the shoot/preview area with a "closed" panel (`submissionsClosed` + hint); keep gallery link, notice link, footer.
- `!GROUP_MODE` → don't render the group `<select>`; camera/gallery buttons enabled without a group; `insert({ group_name: null, … })`; skip `setLastGroup`. `submit()` must not require `group` in this mode.
- Counter frames: if `DAILY_LIMIT > 10`, show only the numeric text instead of one frame per shot.
- Error mapping (stale bundle vs. newer server settings):
  - storage upload error matching `/row-level security|violates/i` **or** insert error `/submissions are closed/i` → show `submissionsClosed`, go idle;
  - insert error `/invalid group/i` → show `groupInvalid`;
  - existing `/daily photo limit/i` handling unchanged.

### 4.5 `src/gallery/App.jsx`
- `!GROUP_MODE` → hide the group `<select>`, never add `.eq('group_name', …)`, and show only the timestamp in photo meta (no group label). Handle `group_name === null` in `displayGroupName`.

### 4.6 Tests for this phase — see §8.

## 5. Phase 3 — Moderate page: auth, roles, shell, "Open app" button

### 5.1 File structure (split the 11 KB `src/moderate/App.jsx`)
```
src/moderate/
  App.jsx        auth gate + bootstrap + shell (header, nav, view switch)
  Login.jsx      Google button + collapsed email/password form
  NoAccess.jsx   signed in but rank 0: show email, "ask an admin to add you", sign-out
  Queue.jsx      existing Queue moved verbatim, now receiving { groups, groupMode } props
  Settings.jsx   Phase 4
  Users.jsx      Phase 3.4
  roles.js       RANK map + can(rank, 'moderate'|'settings'|'users')
  moderate.css   extend; keep existing class names (e2e tests depend on .card, .zoom, .controls select, etc.)
```
Do not change the DOM structure/labels the existing e2e tests rely on inside `Queue` (headings "Pending photos (n)", buttons "Approve"/"Reject", `.controls select` first = group filter). When group mode is off, hide the group filter **and** keep the date filter as the first `select` in a way that doesn't break tests running with group mode on.

First admin email shall be configured in env variable!

### 5.2 Auth & bootstrap
- `App.jsx`: `getSession()` + `onAuthStateChange`. On session with a **new user id** call `supabase.rpc('moderate_bootstrap')` once → `{ rank, settings }`. Do not refetch on `TOKEN_REFRESHED`.
- `rank === 0` → `<NoAccess/>`. Otherwise render the shell with view state persisted in `location.hash` (`#photos` default, `#settings`, `#users`); hash change re-renders, no router. Views above the user's rank redirect to `#photos`.
- Client-side gating is UX only; RLS is the enforcement.

### 5.3 Login
- Primary: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/moderate/', queryParams: { prompt: 'select_account' } } })`.
- Secondary (inside a `<details>`, label "Sign in with email & password"): existing form, unchanged behaviour and placeholders (`Email`, `Password`, button `Sign in`) so existing e2e tests keep working — if the `<details>` breaks them, keep it open by default when `?password=1` or update the tests to expand it.

### 5.4 Users tab (admin only)
- Load: `from('staff_users').select('*').order('created_at')` once on tab open.
- Add: email (trim + lowercase, basic format check) + role select → `insert({ email, role, created_by: <my email> })`.
- Change role: `update({ role }).eq('email', …)`. Remove: `delete().eq('email', …)` with confirm. Surface the DB error "Cannot remove the last admin" verbatim.
- Show a hint: "They sign in with Google using this exact email. Changes apply on their next request — no re-login needed." Show the current user's row as "(you)".
- Note in UI: removing a row revokes access but does not delete the Supabase Auth user (acceptable).

### 5.5 "Open app" button
- In the shell header (all views, all roles): a clearly styled primary link `📸 Open CrowdLens app` → `href="/"` `target="_blank" rel="noopener"`. Also show the same link (smaller) on `Login` and `NoAccess`. Optional secondary text link to `/gallery/`.
- Give it `data-testid="open-app"`.

## 6. Phase 4 — Settings tab (organizer + admin)

`Settings.jsx` receives the bootstrap `settings` row and an `onSaved(row)` callback.

Form fields (single form, one Save):
1. **Accept photo submissions** — toggle (`submissions_open`).
2. **Daily photo limit** — integer 1–50.
3. **Tagline** — HU and EN text inputs, placeholder = the built-in default; empty = use default; max 120.
4. **Important notice** — HU and EN textareas, placeholder = built-in default consent; empty = use default; max 4000; plain text only. Help text: "If you write a custom notice, mention the daily limit yourself."
5. **Group mode** — toggle. Off ⇒ photos are collected without a group; group picker disappears for participants and gallery.
6. **Groups** — one textarea, one name per line. Pure helper `parseGroups(text)` (unit-tested): trim, drop empties, dedupe case-sensitively, max 60 chars each, max 200. Show live count and validation errors. Disabled (but visible) when group mode is off.
   Warning banner: "Group names are stored on each photo. Renaming or removing a group does not migrate existing photos — they stay under the old name and remain visible under 'All groups'."

Save behaviour:
- One request: `from('app_settings').update(payload).eq('id', 1).eq('updated_at', loaded.updated_at).select().single()`. Zero rows ⇒ "Someone else changed the settings — reload" (optimistic concurrency, avoids clobbering another organizer).
- Dirty tracking; disable Save when clean or invalid; show success toast; call `onSaved`.

Two-tier status banner at the top of the tab:
- Static explainer: "Submission switch, daily limit and group validity apply **immediately** on the server. Tagline, notice, group list and group mode are shown to participants after the site is republished."
- Publish status: compare live `updated_at` with `SETTINGS_UPDATED_AT` from `config.js` (baked at the moderate bundle's build). If newer ⇒ amber "Unpublished changes" + instructions ("Redeploy the site") or the Publish button (Phase 5). If equal ⇒ green "Live site is up to date".
- Also feed the live `groups`/`group_mode` from the bootstrap row (not the baked config) into `Queue`, so moderation filters are always current. Compute the group filter options as `live groups ∪ distinct group_name in loaded photos` so photos from removed groups stay filterable. Approve path: `slugifyGroup(group_name)` or `ungrouped` when null.

Guidance for organizers (show in UI help text): change settings before the event, save, publish immediately after saving (a removed group is rejected by the server as soon as it's saved, while participants' cached pages still list it until the republish finishes).

## 7. Phase 5 — Publish button (optional, requires Git-connected host)

- Create a Vercel (or Cloudflare Pages) **Deploy Hook**; store as Edge Function secret: `supabase secrets set DEPLOY_HOOK_URL=…`. Never expose it to the browser.
- `supabase/functions/publish-site/index.ts` (Deno):
  1. Build a Supabase client with the caller's `Authorization` header; `rpc('staff_rank')` must be ≥ 2 else 403.
  2. With the service-role client read `app_settings.last_publish_at`; if < 60 s ago return 429.
  3. `fetch(DEPLOY_HOOK_URL, { method: 'POST' })`; on success set `last_publish_at = now()`; return 200.
  4. CORS headers for the site origin. Keep `verify_jwt = true`.
- UI: "Publish now" button in the amber banner → `supabase.functions.invoke('publish-site')`; disable for 60 s afterwards; text "Build takes ~1–2 min; the banner turns green after the new deployment loads /moderate/".
- Build environment must have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set (already required) so `loadSettings` works in strict mode.
- If the host is drag-and-drop only, skip this phase and keep the banner's manual instructions (`npm run build`, upload `dist/`).

## 8. Tests (update existing, add new)

**Unit / component (vitest):**
- `config.test.js`: new exports exist and are typed correctly (`GROUP_MODE` boolean, `CUSTOM_TAGLINE.hu` string, …).
- `i18n.test.js`: completeness still passes with new keys; `getTagline`/`getNotice` fall back to defaults when custom text is empty; default notice includes the dynamic limit line.
- `parseGroups` unit tests (trim, dedupe, empty, too long, too many).
- `upload-app.test.jsx`: existing tests keep passing; add — submissions closed panel (mock `config.js` via `vi.mock` with overridden `SUBMISSIONS_OPEN=false`), group mode off (no combobox, buttons enabled, `insert` called with `group_name: null`, no `cl_group` stored), custom tagline shown, `Submissions are closed` insert error maps to the closed message, `Invalid group` error message.
- New moderate component tests with a mocked supabase: rank 0 ⇒ NoAccess; rank 1 ⇒ only Photos nav; rank 2 ⇒ Photos + Settings; rank 3 ⇒ all; "Open app" link present with `href="/"`; hash routing to a forbidden view redirects to photos.

**Backend integration (`scripts/backend-test.mjs`, update + extend):**
- Replace `'Group 1'` with a real group from the seeded settings (trigger now validates groups). Reset `app_settings` to defaults in `cleanup()`.
- Helper to create confirmed users and insert `staff_users` rows via service role, with roles admin/organizer/moderator, plus (a) a confirmed user **not** in the allowlist, (b) an **unconfirmed** user whose email *is* allowlisted.
- Matrix assertions:
  - not-allowlisted user and unconfirmed user: cannot select `photos`, cannot read `pending` storage, cannot update settings, `moderate_bootstrap().rank = 0`.
  - moderator: can select/update photos, copy pending→approved; cannot update `app_settings`; cannot read `staff_users`; cannot delete photos.
  - organizer: everything moderator can + update `app_settings`; cannot read/write `staff_users`.
  - admin: all of the above + CRUD `staff_users` + delete photos.
  - anon: can `select` `app_settings`, cannot update it.
  - guard: deleting/demoting the last admin fails; succeeds when a second admin exists.
- Trigger behaviour: `submissions_open=false` ⇒ anon storage upload to `pending` fails **and** insert fails with `Submissions are closed`; raising `daily_limit` to 5 allows 5 inserts and blocks the 6th; `group_mode=true` + group not in list ⇒ `Invalid group`; `group_mode=false` ⇒ row stored with `group_name IS NULL`.
- Concurrent burst test still yields exactly `daily_limit` successes.

**E2E (playwright):**
- `helpers.mjs`: `ensureStaffUser(role = 'moderator')` also upserts `staff_users`; add helpers to reset `app_settings`.
- Existing `moderate.spec.mjs` must still pass (password login, staff user as moderator).
- New `settings.spec.mjs`: organizer logs in, sees Settings tab, changes limit + closes submissions, save succeeds, "Unpublished changes" banner appears, anon insert is rejected; moderator does not see Settings/Users tabs and `#settings` redirects; admin adds a user and changes a role; "Open app" opens `/`.
- Google OAuth is not e2e-testable; test only that the button exists.

## 9. Auth/deploy setup steps (write into README; user performs them)

1. Apply the migration. Run the bootstrap SQL (§3) with the owner as `admin` and all existing staff accounts as `moderator`/`organizer`. **Do this before enabling Google.**
2. Google Cloud Console → OAuth client (Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase dashboard → Authentication → Providers → Google: enable, paste client ID/secret.
4. Authentication → URL Configuration: Site URL = production origin; Additional Redirect URLs = `https://<prod>/moderate/` and `http://localhost:5173/moderate/`.
5. Authentication → Sign In / Providers → Email: keep "Confirm email" **on** in production (the role function also requires a confirmed email).
6. Optional hardening: a "Before user created" Auth hook rejecting emails not in `staff_users` (verify availability on the current plan). Without it, strangers can create Auth accounts but get rank 0 and see only the no-access screen.
7. Local dev: add a `[auth.external.google]` block to `supabase/config.toml` (secrets via `env(...)`, `skip_nonce_check = true`) — optional; password users cover local testing.
8. Hosting env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` on the build machine; deploy hook (Phase 5) if Git-connected.
9. Update `README.md`: replace step "Create staff accounts" and step "Set the real group names in src/lib/config.js" with the new flow; document roles, publish flow, and the "immediate vs. after publish" split.

**Admin-defined passwords (not built):** would require an Edge Function using the service role to call `auth.admin.createUser` + insert the allowlist row, and the admin would hold other people's credentials. Not recommended; for non-Google staff, create the user in the Supabase dashboard (email + password, confirm manually) and add their email to the allowlist — the existing password login keeps working.

## 10. Change of Approval Flow
Approval of photo should not copy the file, because we are low on storage space. Instead, move the file from the pending bucket to the approved bucket.

## 11. Rollout order & acceptance criteria

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Migration + backend tests | `npm run test:backend` green incl. full role matrix; existing photo flows unchanged |
| 2 | Loader, config, i18n, upload/gallery changes | `npm test` green; `npm run build` embeds live settings (verify by changing a tagline in DB and rebuilding); production-mode build fails when the DB is unreachable |
| 3 | Moderate shell, Google login, NoAccess, Users tab, Open-app button | Role gating works for all 3 roles + rank 0; existing moderate e2e still green |
| 4 | Settings tab + publish-status banner | Save works with optimistic concurrency; group filters use live groups; banner flips amber→green after rebuild |
| 5 (opt.) | Edge Function + Publish button | Button triggers a deploy; rate-limited; secret never in the client |
| 6 | README + rollout checklist | A fresh reader can set everything up from README alone |

Do phases in order; each phase ends with the full test suite green before moving on.

## 12. Risks / things to flag to the maintainer

- **Free-tier storage limit:** 1 GB - verify against expected photo volume (1,500 participants × limit × days) and consider Pro for the event month.
- **Queue truncation** at 1000 rows (`max_rows`) — needs pagination if volume is high.
- **Stale cached pages:** participants who loaded the app before a publish still run old baked settings; server enforcement guarantees correctness, and the new error mappings guarantee a sensible message.
- **Lowering the daily limit mid-event** is enforced server-side immediately, but the UI counter (local, baked limit) may still show shots left until republish/next load.
- if the last admin is somehow lost, recover via SQL.
