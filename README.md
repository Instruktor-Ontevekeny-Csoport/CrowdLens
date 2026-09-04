# CrowdLens 📸

Disposable-camera style photo sharing for a freshmen camp. Participants scan a QR code, get 3 shots a day (camera or gallery), staff moderate every photo, approved photos appear live in per-group galleries and feed the aftermovie pool.

Pages (independent bundles, no router):

- `/` — participant upload page (HU/EN, disposable-camera UI)
- `/moderate/` — staff moderation queue (email+password login)
- `/gallery/` — public per-group gallery of approved photos

## Local development

Prereqs: Node 20+, Docker.

```sh
npm install
npx supabase start          # local Postgres+Storage+Auth; prints keys
cp .env.example .env        # paste the printed ANON_KEY into .env
npm run dev
```

Tests:

```sh
npm test                    # unit + component tests (vitest)
npm run test:backend        # trigger/RLS/storage-policy integration tests
                            # needs SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY env vars
npm run test:e2e            # real-browser end-to-end tests (playwright)
```

## Production setup (once, ~15 minutes)

1. **Create the Supabase project** at [database.new](https://database.new) (free tier is fine).
2. **Apply the schema**: either link and push —

   ```sh
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   or paste `supabase/migrations/20260828000000_init.sql` into the dashboard's SQL editor and run it. This creates the `photos` table, the daily-limit trigger, RLS policies, and both storage buckets (`pending` private, `approved` public).
3. **Create staff accounts**: dashboard → Authentication → Users → "Add user" (email + password, confirm email manually). 5–10 accounts, one per moderator.
4. **Configure the frontend**: put the project's URL and anon/publishable key (dashboard → Settings → API) into `.env`:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

5. **Set the real group names** in `src/lib/config.js` (do this before launch; names are stored in the DB and shouldn't change after).
6. **Deploy**: `npm run build`, then drag the `dist/` folder into Cloudflare Pages (no git/CI needed). Re-run both steps for any later change.
7. **Generate the QR code** for the deployed URL:

   ```sh
   node scripts/make-qr.mjs https://your-site.pages.dev
   ```

   Test the printed QR by scanning it with a phone's native camera app.
8. **Verify the backend** against production once: run `npm run test:backend` with the production URL/keys (it cleans up after itself, but do it before participants arrive).

## Staff moderation guide

Open `/moderate/` on the deployed site and sign in. Every submitted photo waits here — nothing is public until you press **Approve**. Approve moves the photo into its group's public gallery immediately; **Reject** hides it permanently (the file stays in private storage for disputes, participants are not notified). Filter by group or day if the queue gets long, and press Refresh to pull in new submissions. Check the queue after meals and evening programs — that's when bursts arrive.

## Aftermovie export

Video editors don't need a page: give them Supabase dashboard access (or a read-only member invite) and they can browse/download everything under the `approved` storage bucket, organised by group.

## Storage backup / restore (CLI)

Download full bucket contents:

```sh
npx supabase storage download --bucket approved --destination ./backup/approved
npx supabase storage download --bucket pending --destination ./backup/pending
```

Upload (restore) full bucket contents:

```sh
npx supabase storage upload --bucket approved --source ./backup/approved --recursive
npx supabase storage upload --bucket pending --source ./backup/pending --recursive
```

Notes:

- Run commands against the correct project (use `npx supabase link --project-ref <ref>` first for cloud).
- Use a service-role context for restore operations.
- Restoring files does not update `photos.storage_path`; DB rows and storage objects must stay in sync.

## Operational notes

- The 3/day limit is enforced server-side by a Postgres trigger keyed on a browser-stored token. Incognito/another browser resets the token — that's accepted; every photo still passes moderation, so a bypass only means more moderation work.
- "Per day" means the camp's local day (`Europe/Budapest`, set in the migration).
- Client-side compression targets ~1920px JPEG (~0.5 MB); storage buckets cap uploads at 10 MB and only accept `image/jpeg`.
- After the camp: export approved photos, then delete pending/rejected objects and (per the consent text) eventually everything, and pause/downgrade the project.
