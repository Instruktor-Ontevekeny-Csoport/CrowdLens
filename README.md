# CrowdLens 📸

Disposable-camera style photo sharing for a freshmen camp. Participants scan a QR code, get a few shots a day (camera or gallery), staff moderate every photo, approved photos appear live in per-group galleries and feed the aftermovie pool. Organizers configure the limit, texts and groups from the staff page.

Pages (independent bundles, no router):

- `/` — participant upload page (HU/EN, disposable-camera UI)
- `/moderate/` — staff page: moderation queue, settings, staff users (Google or email+password login)
- `/gallery/` — public per-group gallery of approved photos

## Local development

Prereqs: Node 20+, Docker.

```sh
npm install
npx supabase start          # local Postgres+Storage+Auth; prints keys
cp .env.example .env        # paste the printed ANON_KEY (and SERVICE_ROLE_KEY) into .env
npm run bootstrap-admin     # makes FIRST_ADMIN_EMAIL from .env an admin
npm run dev
```

The app settings are read from the database once, when the dev server (or a build) starts — restart `npm run dev` after changing settings to see them on the participant pages. Locally, create the password account for your admin email in Supabase Studio (Authentication → Add user, auto-confirm), then sign in on `/moderate/` under "Sign in with email & password".

Tests:

```sh
npm test                    # unit + component tests (vitest)
npm run test:backend        # trigger/RLS/role-matrix/storage-policy integration tests
                            # needs SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY env vars
npm run test:e2e            # real-browser end-to-end tests (playwright)
```

## Production setup (once, ~30 minutes)

1. **Create the Supabase project** at [database.new](https://database.new) (free tier is fine).
2. **Apply the schema**: link and push —

   ```sh
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   or paste the files in `supabase/migrations/` into the dashboard's SQL editor, in order. This creates the `photos` table, the `app_settings` row, the `staff_users` allowlist, the triggers, RLS policies, and both storage buckets (`pending` private, `approved` public).
3. **Configure `.env`** (dashboard → Settings → API):

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   FIRST_ADMIN_EMAIL=<owner's email, the one they sign in with>
   SUPABASE_SERVICE_ROLE_KEY=<service role key — never commit or expose it>
   ```

4. **Create the first admin** — do this *before* enabling Google sign-in:

   ```sh
   npm run bootstrap-admin
   ```

   It adds `FIRST_ADMIN_EMAIL` to the staff allowlist as `admin` (safe to re-run). Everyone else is added by an admin on `/moderate/` → Users. Password accounts that existed before this migration have no access until their email is on the list. If every admin is ever lost, run the script again (or `insert into staff_users(email, role) values ('<email>', 'admin');` in the SQL editor).
5. **Enable Google sign-in**:
   1. Google Cloud Console → create an OAuth client (type: Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   2. Supabase dashboard → Authentication → Providers → Google: enable, paste the client ID and secret.
   3. Authentication → URL Configuration: Site URL = the production origin; Additional Redirect URLs = `https://<prod>/moderate/` and `http://localhost:5173/moderate/`.
   4. Authentication → Sign In / Providers → Email: keep "Confirm email" **on** (roles only apply to confirmed emails).

   Anyone with a Google account can sign in, but only allowlisted emails get any access — others see a "no access" screen. Optional hardening: a "Before user created" Auth hook that rejects emails missing from `staff_users`.

   Staff without a Google account: create the user in the dashboard (Authentication → Users → "Add user", email + password, confirm manually) and add the same email on `/moderate/` → Users; they use "Sign in with email & password".
6. **Deploy**: `npm run build`, then upload `dist/` to the host (or let a Git-connected host run the build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set). The build reads the settings from the database and bakes them into the pages; it fails if the database is unreachable, so a deploy never silently ships default settings (`ALLOW_DEFAULT_SETTINGS=1` overrides).
7. **Set up the event** on `/moderate/` → Settings: daily limit, tagline, notice, groups. Save, then republish (see below).
8. **Generate the QR code** for the deployed URL:

   ```sh
   node scripts/make-qr.mjs https://your-site.pages.dev
   ```

   Test the printed QR by scanning it with a phone's native camera app.
9. **Verify the backend** against production once: run `npm run test:backend` with the production URL/keys. It creates and removes its own test users and restores the settings afterwards, but briefly closes submissions — do it before participants arrive.

## Staff roles

| Role | Moderate photos | Settings | Manage staff users |
|---|---|---|---|
| `moderator` | ✓ | | |
| `organizer` | ✓ | ✓ | |
| `admin` | ✓ | ✓ | ✓ |

Roles live in the `staff_users` table (email → role) and are enforced by the database on every request; the page only hides what a role cannot use. Role changes apply on the person's next request, no re-login needed. Removing someone revokes access but does not delete their sign-in account. The last admin cannot be removed or demoted from the page.

## Settings and publishing

Organizers and admins edit the settings on `/moderate/` → Settings. They take effect in two steps:

- **Immediately, on the server**: closing submissions, the daily limit, and which group names are accepted. These are enforced by the database, so they hold even for participants with an old page open.
- **After the site is republished**: tagline, notice text, the group list shown in the pickers, group mode, the limit shown in the counter — and re-opening submissions that were closed when the site was last built. Participant pages get the settings baked in at build time and make no extra requests for them.

The Settings tab shows "Unpublished changes" until the deployed site was built from the current settings. To republish, rebuild and redeploy (`npm run build` + upload `dist/`, or trigger a deploy on the host).

Change settings before the event and republish right after saving: a removed group is refused by the server as soon as it is saved, while already-loaded pages still list it. Group names are stored on each photo — renaming or removing a group does not migrate existing photos.

### Optional: "Publish now" button

Works only with a Git-connected host (Vercel, Cloudflare Pages with Git) — drag-and-drop deploys have no deploy hook.

1. Create a Deploy Hook on the host and store it as a function secret (never in the frontend env):

   ```sh
   npx supabase secrets set DEPLOY_HOOK_URL=<hook url> SITE_ORIGIN=https://<prod>
   npx supabase functions deploy publish-site
   ```

2. Set `VITE_ENABLE_PUBLISH=true` in the build environment and redeploy.

The function only accepts organizers/admins and at most one publish per minute.

## Staff moderation guide

Open `/moderate/` on the deployed site and sign in. Every submitted photo waits here — nothing is public until you press **Approve**. Approve moves the photo into its group's public gallery immediately; **Reject** hides it (the file stays in private storage for disputes, participants are not notified). Both can be reverted from the Approved/Rejected tabs. Filter by group or day if the queue gets long, and press Refresh to pull in new submissions. Check the queue after meals and evening programs — that's when bursts arrive. The **Open CrowdLens app** button opens the participant page.

## Aftermovie export

Video editors don't need a page: give them Supabase dashboard access (or a read-only member invite) and they can browse/download everything under the `approved` storage bucket, organised by group (`ungrouped/` when group mode is off).

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

- The daily limit is enforced server-side by a Postgres trigger keyed on a browser-stored token. Incognito/another browser resets the token — that's accepted; every photo still passes moderation, so a bypass only means more moderation work.
- "Per day" means the camp's local day (`Europe/Budapest`, set in the migration).
- Each photo is stored once: approval moves the file from the `pending` bucket to `approved`, un-approving moves it back. The free tier has 1 GB of storage (~0.5 MB per photo) — check it against participants × daily limit × days.
- The moderation queue loads at most 1000 photos per tab (API row limit).
- Lowering the daily limit applies on the server at once, but the on-page counter follows only after a republish.
- Client-side compression targets ~1920px JPEG (~0.5 MB); storage buckets cap uploads at 10 MB and only accept `image/jpeg`.
- After the camp: export approved photos, then delete pending/rejected objects and (per the consent text) eventually everything, and pause/downgrade the project.
