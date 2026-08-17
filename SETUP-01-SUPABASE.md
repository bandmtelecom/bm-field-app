# Setup 1 — Supabase (the database) from zero

Supabase is the data brain: Postgres database + per-tech logins + file storage.
You'll create the project, run our SQL, and add the crew. ~20 minutes.

## 1. Create the project
1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub or email.
2. **New project.** Name it `bm-field-app`. Pick a strong database password and
   **save it in your password manager** — you'll rarely need it, but you can't
   recover it. Region: pick the closest US region (e.g. US East or US Central).
3. Wait ~2 min for it to provision.

## 2. Grab your keys
Project → **Settings (gear)** → **API**. Copy these into your `.env` (and later
into Render). Three values:
- **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` (safe for the browser)
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` — **SECRET.** Server only.
  Never put this in the web app or commit it.

## 3. Run the migrations (creates every table + the security rules + rate card)
Easiest path — the SQL editor:
1. Project → **SQL Editor** → **New query**.
2. Open each file under `supabase/migrations/` **in order** and paste + **Run**:
   1. `..._init.sql` — all the tables
   2. `..._rls.sql` — row-level security (the price wall)
   3. `..._seed_ratecard.sql` — the 69 billable Lumen units
3. (Optional, for a test drive) run `supabase/seed.sql` to load a couple of
   sample jobs.

*Dev-buddy alternative (CLI):* `npm i -g supabase`, then `supabase link
--project-ref <ref>` and `supabase db push`. The SQL-editor route above needs
no tooling.

## 4. Turn on email logins & add the crew
1. **Authentication → Providers → Email**: keep it enabled. For a small crew,
   turn **Confirm email** off (or on, your call) so you can add accounts fast.
2. **Authentication → Users → Add user** for each person (Austin, Matt, Billie,
   and each tech). Set a temporary password; they change it on first login.
3. After adding a user, set their role. In **SQL Editor**, run (swap the email):
   ```sql
   -- roles: 'admin' (Austin/Matt/Billie), 'office', or 'tech'
   update profiles set role = 'admin', is_active = true
   where id = (select id from auth.users where email = 'aballard@bandmtelecom.com');
   ```
   Everyone else defaults to `tech` (units only, no prices). A `profiles` row is
   created automatically by a trigger when the auth user is created.

## 5. The kill-switch (departed employee)
To lock someone out instantly:
```sql
update profiles set is_active = false
where id = (select id from auth.users where email = 'someone@bandmtelecom.com');
```
Then **Authentication → Users → (the user) → Delete user** (or "Ban") to fully
revoke their session. Their app becomes a dead shell and the offline cache wipes
on next launch.

## 6. Storage for photos & OTDR files
**Storage → New bucket** → name it `attachments`, keep it **Private**. The RLS
migration already restricts access to authenticated users. Photos/traces upload
here from the app.

➡️ Next: [`SETUP-03-GITHUB.md`](SETUP-03-GITHUB.md), then
[`SETUP-02-RENDER.md`](SETUP-02-RENDER.md).
