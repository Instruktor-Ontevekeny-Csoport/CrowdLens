# Freshmen Camp Photo Sharing — Implementation Plan

Build window: 1–2 days. No login for participants. No live-screen feature. Two outputs: per-group albums and an aftermovie photo pool.

## 1. Confirmed scope

- A single QR code, displayed physically around camp, points to one public URL.
- Participants take a photo with their camera (no gallery picker) and submit it with a group selection.
- Limit: 3 photos per person per day.
- No accounts, no SSO — identity is a persistent browser token.
- Group choice is remembered after the first submission so it doesn't have to be re-picked.
- Staff review every photo before it's usable anywhere (moderation gate).
- Two outputs: a gallery per group, and a full-resolution pool for aftermovie editors.

## 2. Stack

- **Frontend**: React + Vite, scaffolded with `npm create vite@latest crowdlens -- --template react`. No client-side router — the three pages never navigate to each other, so Vite's multi-page build (multiple HTML entry points) produces three small independent bundles instead of one SPA that ships react-router and the moderation dashboard's code to every participant's phone. Deploy by running `npm run build` locally and dragging the resulting `dist/` folder to Cloudflare Pages — still no git/CI required, just one extra command before each deploy.

  ```
  crowdlens/
    index.html            → participant upload page, served at "/"
    moderate/index.html   → staff moderation page, served at "/moderate/"
    gallery/index.html    → group gallery page, served at "/gallery/"
    src/
      upload/App.jsx
      moderate/App.jsx
      gallery/App.jsx
      lib/supabase.js     → shared client init, imported by all three
  ```

  ```js
  // vite.config.js
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  import { resolve } from 'path'

  export default defineConfig({
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          moderate: resolve(__dirname, 'moderate/index.html'),
          gallery: resolve(__dirname, 'gallery/index.html'),
        },
      },
    },
  })
  ```

- **Backend**: none. Each page talks directly to **Supabase** (Postgres + Storage + Auth) using the `@supabase/supabase-js` npm package.
- **Auth**: only for staff moderators. 5–10 accounts created manually in the Supabase Auth dashboard — no signup flow to build.
- **Image handling**: client-side resize/compress before upload (canvas resize to ~1920px longest edge, JPEG quality ~0.8, or the `browser-image-compression` library via CDN) — cuts upload time and storage cost, and matters a lot on camp WiFi.

This intentionally has zero servers to provision, patch, or scale. Supabase's free tier will likely cover the whole event given the volume (see §7); upgrade to Pro ($25/mo) only if storage gets tight, and downgrade after.

## 3. Identity & rate limiting

**Client side** (localStorage, with a cookie as fallback in case a browser blocks localStorage):
- `client_token`: a random UUID generated on first visit, persisted indefinitely.
- `last_group`: the participant's most recent group selection, pre-filled on return visits.
- `today_count` + `today_date`: an optimistic local counter, reset when the stored date != today, used to hide the upload button client-side once 3 is hit (no need to round-trip to the server just to check).

**Server side (the real enforcement)**: a Postgres trigger counts existing rows for that `client_token` on that calendar day and rejects the insert past 3 (see §4). This is the actual backstop — the client-side counter is just a UX nicety to avoid people going through the camera flow only to be rejected.

**Known limitation, stated plainly**: refreshing the page or opening a new tab in the same browser is fine — localStorage persists across both. The real gap is private/incognito browsing: opening a fresh private window is a single tap that hands someone a new token and a reset count. Switching browser apps or devices does the same. This is a genuine, low-effort bypass, not something requiring deliberate technical work — don't represent it internally as a hard cap.

What keeps this acceptable anyway: the counter's job is to stop the moderation queue from being flooded by one person, not to be a security boundary. However many photos someone manages to submit, every one of them still needs human approval before it's usable anywhere — a bypass means more moderation work, not more published content. Given a private camp QR code with no adversarial incentive, that trade-off is fine for a 1–2 day build. Don't spend time on device fingerprinting or IP-based limiting to close this gap further; fingerprinting is unreliable against modern browser privacy protections, and IP limiting doesn't implement cleanly here since there's no backend to check it in and camp WiFi means many participants share the same IP anyway.

If a hard per-person cap becomes genuinely important, the only real fix without login is moving identity into the link itself — a unique QR/URL per participant sourced from your registration list. That's a bigger change (distributing individual codes) and is a deliberate scope decision, not something to fold in silently.

**Timezone note**: "per day" should mean the camp's local day, not UTC. Use an explicit timezone in the trigger (`Europe/Budapest` assumed below — change if the camp is elsewhere).

## 4. Database schema (run in the Supabase SQL editor)

```sql
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

-- Atomic daily limit enforcement
create or replace function enforce_daily_limit()
returns trigger as $$
declare
  current_count int;
begin
  select count(*) into current_count
  from photos
  where client_token = new.client_token
    and submitted_date = new.submitted_date;

  if current_count >= 3 then
    raise exception 'Daily photo limit reached';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_daily_limit
before insert on photos
for each row execute function enforce_daily_limit();

-- Row Level Security
alter table photos enable row level security;

-- Anyone can submit (trigger enforces the real limit)
create policy "anon can insert" on photos
for insert to anon
with check (true);

-- Public can only ever see approved photos (albums)
create policy "anon can view approved" on photos
for select to anon
using (status = 'approved');

-- Staff (authenticated) see and manage everything
create policy "staff full access" on photos
for all to authenticated
using (true) with check (true);
```

## 5. Storage layout & access control

Use one bucket (`crowdlens`) with three path prefixes, and scope bucket policies to match:

- `pending/{photo_id}.jpg` — written by anon on upload, readable only by `authenticated` (staff).
- `approved/{group_name}/{photo_id}.jpg` — the moderator action **copies** the object here on approval and updates `storage_path`; readable by everyone (public gallery + aftermovie pool).
- `rejected/{photo_id}.jpg` — kept for a short retention window in case of moderation disputes, staff-only; safe to bulk-delete after the camp.

This keeps unapproved content from ever being publicly guessable, while still letting the frontend query the `approved/` prefix directly for galleries and aftermovie downloads — no signed URLs needed.

**Upload order**: upload the file to `pending/` first, then insert the DB row referencing it. In the rare case the trigger rejects the insert (edge case — client already hides the button after 3), the orphaned storage object is a negligible, acceptable cost at this scale; don't build cleanup logic for it in this timeframe.

## 6. Pages to build

1. **`/` (upload)** — the page the QR code points to.
   - `<input type="file" accept="image/*" capture="environment">` for camera-only capture. Note: `capture` is respected on mobile Safari/Chrome (opens the camera directly) but is typically ignored on desktop, falling back to a normal file picker — acceptable given this is a QR-scanned, phone-first flow.
   - Group `<select>`, pre-filled from `last_group` if present; a hardcoded array/JSON of group names is enough — no need for a groups table.
   - Client-side compress → upload to `pending/` → insert DB row → update local counter and `last_group` on success.
   - Show "X of 3 used today" and disable the upload control once at 3.

2. **`/moderate` (staff only, Supabase Auth email+password)**
   - Query `pending`, thumbnail grid, filter by group/day.
   - Approve → copy storage object to `approved/{group}/…`, update `storage_path` and `status`.
   - Reject → update `status`, leave file in place (or delete).

3. **`/gallery/` (public)**
   - No `{group}` in the path since there's no router — a `<select>` on the page (same hardcoded group list as the upload page) picks the group, and the query filters `approved` rows by the chosen value, rendered as a grid straight from public storage URLs.

4. **Aftermovie export** — no custom page needed. Give video editors access to the Supabase dashboard's Storage browser (or a shared read-only credential) so they can browse/download `approved/*` directly. Building a dedicated export UI isn't worth the time here.

## 7. Rough scale check

Assuming <50% of ~2,000 people participate (~1,000) across a multi-day camp at 3 photos/day: a 4-day camp tops out around 12,000 photos. Compressed to a reasonable web size, that's comfortably under Supabase's free-tier storage; even uncompressed originals kept for the aftermovie pool stay well under the Pro tier's 100GB. Cost risk here is low — the risk is entirely build-time, not infrastructure.

## 8. Build order (1–2 days)

**Day 1 — morning**
- Create Supabase project, run the schema/trigger/RLS SQL above, create the storage bucket and its three path policies.
- Finalize the group name list (get it from staff now — don't block on it later).
- Skeleton `/` page: camera input, group select, wired to Supabase insert (no styling yet) — confirm the full round trip works, including a 4th-upload rejection test.

**Day 1 — afternoon**
- `/moderate` page: pending queue, approve/reject, storage copy-on-approve logic.
- Create staff accounts in Supabase Auth dashboard.
- End-to-end test with real phones: iOS Safari and Android Chrome (camera capture behavior differs slightly between them).

**Day 2 — morning**
- `/gallery/` page (group picked via dropdown).
- Mobile styling/polish pass on the upload page — this is the page 1,500+ people will actually use, prioritize it over the moderation UI's visual polish.
- Generate the QR code pointing at the production URL; confirm it resolves correctly from a phone's native camera (not a messaging app's in-app browser, which can have flaky camera/storage behavior).

**Day 2 — afternoon (buffer)**
- Edge cases: non-image file rejected gracefully, large image handled, upload failure/retry on flaky WiFi.
- Light concurrent-upload test (simulate a burst right after an activity ends — this is when real usage will spike).
- Deploy, final QA on the actual QR signage, write a 1-paragraph moderation guide for staff.

## 9. Risks to watch

- **Venue connectivity**: if WiFi/mobile signal is weak at the venue, uploads will fail regardless of backend quality — worth confirming ahead of time, and make upload failures retry gracefully rather than losing the photo.
- **In-app browsers**: if the QR code is ever shared as a link inside a chat app instead of scanned by a camera, some in-app browsers restrict camera access or have inconsistent localStorage — test the primary QR-scan path specifically.
- **Consent/GDPR**: brief consent copy on the upload page (what the photo will be used for) and a defined post-camp deletion timeline are worth the few extra minutes given this is personal data of identifiable people.

## 10. After the camp

- Export/archive approved photos, then downgrade or pause the Supabase project if on a paid tier.
- Apply the stated retention/deletion timeline to pending/rejected photos and, per your consent terms, eventually the approved ones too.
