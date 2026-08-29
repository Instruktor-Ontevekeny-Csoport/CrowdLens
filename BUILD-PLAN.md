# CrowdLens — Staged Build Plan

Disposable-camera photo sharing for a freshmen camp. Derived from `camp-photo-implementation-plan.md` with these confirmed changes:

- **Camera AND gallery**: participants can take a photo or pick one from their gallery (original plan was camera-only).
- **Name/vibe**: "CrowdLens", throw-away camera aesthetic (film counter, "shots left today", grain/film styling).
- **Language**: Hungarian + English toggle on participant pages, Hungarian default. Moderation page English-only.
- **Groups**: placeholder names (Group 1–10) in a single shared config file, swapped for the real list later.
- **Gallery timing**: live — approved photos appear publicly immediately.
- **Supabase**: no cloud project yet. Local Supabase stack (Docker, via `newgrp docker`) is the test backend; `.env` placeholders + migration SQL make the cloud switch a config change.

Each stage ends with a test gate that must pass before the next stage starts.

**Status (2026-08-28): all six stages built, all test gates passing** (25 vitest unit/component tests, 16 backend integration tests, 8 Playwright e2e tests). Remaining work is deployment-time only: real group names, cloud Supabase project, Cloudflare Pages deploy, real-phone QA (see README).

---

## Stage 0 — Scaffold & tooling

- Vite + React multi-page setup: `index.html` (upload), `moderate/index.html`, `gallery/index.html` as separate Rollup inputs — three independent bundles, no router.
- Directory layout per the original plan (`src/upload/`, `src/moderate/`, `src/gallery/`, `src/lib/`).
- `.env.example` + `.env` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (local-stack values during development).
- Test tooling: Vitest + @testing-library/react + jsdom.
- `.gitignore`, npm scripts (`dev`, `build`, `preview`, `test`).

**Test gate 0**: `npm run build` emits all three pages with separate JS chunks; `npm test` runs; dev server serves `/`, `/moderate/`, `/gallery/` (curl check).

## Stage 1 — Shared libraries

- `src/lib/config.js` — group list (placeholders), daily limit (3), camp timezone.
- `src/lib/i18n.js` — HU/EN string tables, language persisted in localStorage, HU default.
- `src/lib/identity.js` — `client_token` UUID (localStorage + cookie fallback), `last_group`, optimistic daily counter with local-date rollover.
- `src/lib/image.js` — canvas compression: longest edge ~1920px, JPEG q0.8; rejects non-images.
- `src/lib/supabase.js` — shared client init from env.

**Test gate 1**: Vitest unit tests — i18n lookup + missing-key fallback, token persistence/regeneration, counter increments and resets on date change, image util input validation.

## Stage 2 — Backend (local Supabase)

- `supabase init` + migration containing the `photos` table, daily-limit trigger (Europe/Budapest day), RLS policies, `crowdlens` bucket and storage policies for `pending/`, `approved/`, `rejected/` prefixes.
- `supabase start` (Docker) for a real local Postgres + Storage + Auth.
- Seed script: one staff test user.

**Test gate 2** (scripted against the local stack, anon + authenticated clients):
- anon can insert rows 1–3; insert 4 on the same day fails with the trigger error;
- anon `select` returns only `approved` rows; authenticated returns all;
- anon can upload to `pending/`, cannot read `pending/`; `approved/` is publicly readable;
- authenticated can copy `pending/` → `approved/` and update the row.

## Stage 3 — Upload page (the page 1,500 people use)

- Disposable-camera UI: CrowdLens branding, film-counter "shots left today", two actions — "Take photo" (`capture="environment"`) and "Pick from gallery" (no `capture`).
- Group `<select>` pre-filled from `last_group`; HU/EN toggle; consent/GDPR copy.
- Flow: pick/shoot → client compress → preview → upload to `pending/` → insert row → bump local counter. Retry on failed upload without losing the photo; graceful server-side limit rejection; limit-reached state ("film is full, come back tomorrow").

**Test gate 3**: component tests with a mocked client (counter gating, group persistence, error retry); live e2e against local stack — 3 uploads land in `pending/` + DB, 4th blocked client-side, and with the local counter cleared the server rejects it too.

## Stage 4 — Moderation page

- Supabase email+password login; pending queue as a thumbnail grid (authenticated storage reads), filter by group/day.
- Approve → copy object to `approved/{group}/{id}.jpg`, update `storage_path` + `status`. Reject → status update.

**Test gate 4**: e2e with the seeded staff user — login works, pending photo appears, approve moves the object and flips status (visible to anon afterwards), reject never becomes publicly readable. Anon cannot load the moderation data.

## Stage 5 — Gallery page

- Group `<select>` (same config), grid of approved photos from public storage URLs, newest first, tap-to-enlarge, HU/EN toggle.

**Test gate 5**: e2e — photo approved in stage 4 renders in its group's gallery; other groups' and non-approved photos don't; page works with zero photos.

## Stage 6 — Polish & production readiness

- Mobile-first styling pass on the upload page (primary), then gallery/moderation.
- Edge cases: non-image file, huge image, flaky-network retry.
- i18n completeness sweep; QR code generation for the production URL.
- `README.md`: cloud Supabase setup (create project, run migration, create staff accounts), Cloudflare Pages deploy steps, 1-paragraph staff moderation guide.

**Test gate 6**: full test suite green; production `npm run build` + `vite preview` smoke test of all three pages; bundle-size sanity check (upload page stays small).

---

## Out of scope (per plan)

Device fingerprinting / IP rate limiting, per-participant QR codes, aftermovie export UI (editors use the Supabase dashboard), orphaned-object cleanup for rejected inserts.
