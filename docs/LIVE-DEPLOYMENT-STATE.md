# B&M Field App — LIVE deployment state & handoff

_Read this first on a new session. Updated 2026-08-13 — deployed live._

## Live URLs
- **Web (PWA the crew opens):** https://bm-field-web.onrender.com
- **API:** https://bm-field-api.onrender.com  (health check: `/health`)
- A stray duplicate static site named **bm-field-app** may exist from an earlier
  try — the working web app is **bm-field-web**. Delete the stray in Render.

## What's DONE and confirmed working
- **Supabase:** ran `bm-supabase-setup.sql` (schema + RLS + 69 rate-card units,
  verified 69). `attachments` storage bucket (private). Admin user
  **aballard@bandmtelecom.com** (`profiles.role='admin'`). Sample jobs seeded:
  **26-408** (Lumen, capital) and **26-298** (Lumen, emergency/LOR).
- **Render:** `bm-field-api` (Node web service, Node 20) + `bm-field-web`
  (static site) both deployed and green.
- **Verified live:** login, admin role, job list, opening 26-408, running-record
  view, admin-only invoice link.

## Render env vars (reference)
- `bm-field-api`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `CORS_ORIGINS=https://bm-field-web.onrender.com`
- `bm-field-web`: `VITE_SUPABASE_URL` (the `.supabase.co` URL!),
  `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL=https://bm-field-api.onrender.com`
- VITE_ vars are **build-time** — change one → must redeploy the static site.

## Gotchas already solved (don't repeat)
1. API build TS2305 → billing now uses NodeNext + `.js` extensions (v0.1.1).
2. API startup "Node 20 no WebSocket" → `ws` transport in `apps/api/src/supabase.ts` (v0.1.2).
3. Static site build → `build:web` is just `vite build`; typecheck is `npm run typecheck` (v0.1.3).
4. "Failed to fetch" login → `VITE_SUPABASE_URL` had been set to the API URL by mistake; must be the Supabase `.supabase.co` URL.
5. CORS → API `CORS_ORIGINS` must equal the real web URL.

## v0.2.0 — Admin screen (NEW)
- Admin-only **Admin** button in the Jobs header → `/admin`.
- **Users panel:** add a login (email + name + role + temp password), change anyone's
  role, and **Deactivate/Reactivate** (instant lockout — profile `is_active=false`
  AND auth-level ban). Can't deactivate your own account.
- **Create job panel:** add a job (B&M #, customer, identifier, title, billing mode —
  LOR/TT auto-set to emergency/hourly) → appears on the crew roster instantly.
  Add a customer inline.
- API routes (service role, admin-only): `GET/POST /admin/users`, `PATCH /admin/users/:id`.
- **To add Matt King + Billie as admins:** deploy v0.2.0, then Admin → Users → Add user
  (their email + a temp password + role Admin). No SQL needed anymore.

## v0.2.1 — see prior work + clearer user management (2026-08-18)
- **Tap any location in the running record → full read-only detail.** Opens under the
  location: structure + owner + GPS (Google Maps link), case action / enclosure,
  splice count & type, trays, fibers tested, as-found / as-built / notes, cables with
  footages, panel ports, OTDR shots, downtime, and any additional units logged.
  Child tables load on demand, so the list stays fast. No prices anywhere in this
  panel — it renders identically for a tech and for the office.
- **Users panel fixed:** the Status column was an action button labeled "Deactivate",
  which read as if everyone WAS deactivated. Status is now a plain label
  (● Active / ○ Locked out) with the action in its own column ("Lock out" /
  "Restore access"), plus each user's last sign-in date and a plain-English note on
  what each role can see.
- **Role changes take effect on app focus.** The profile is re-read whenever the PWA
  comes back to the foreground, so promoting someone tech → admin (or locking them
  out) lands on their next glance at the phone instead of needing a sign-out.
- **Note on the Admin button:** it only shows for role `admin`. Accounts created
  directly in Supabase Auth default to role `tech` — fix in Admin → Users → role
  dropdown → admin.

## v0.2.2 — field-form tweaks, maintenance-window adder, rate-card export (2026-08-18)

**⚠ RUN THE SQL FIRST, THEN PUSH.** `supabase/migrations/20260818000004_maint_window.sql`
adds `jobs.maint_window`. The new code reads that column — if the code goes live
before the column exists, the job screen and Mark Complete will error for the
crew. Adding the column is invisible to the version currently running, so there
is no broken window if you do it in this order.

### Field form
- "PM location #" is now **Location #** with an empty box (and the read-only
  detail view says "Location #" too).
- Downtime reasons gained **Troubleshooting / DT**, and a new downtime row now
  starts blank ("— pick a reason —") instead of defaulting to "Waiting on
  construction". A blank reason saves as null and reads back as "unspecified".
- **CD / PMD test adder** button (rate card unit 250, $300 EACH) appears in
  "Other work at this closure" **only when Structure = Building**. Tapping it on
  opens a count box; the count bills as the quantity. On any other structure the
  button is not in the list at all.

### Maintenance window (scheduled night work)
- New job-level flag, set in **Admin → Create job** ("Normal hours" /
  "Maintenance window"). Capital jobs only — pick Emergency/LOR and the switch
  disappears and clears itself.
- Every splice on a flagged job carries the adder at the same billed quantity as
  the splice line (6-fiber minimum included): unit 203 FUSION_MAINT_ADDER $6.50
  for single fusion, unit 215 RIBBON_MAINT_ADDER $24.00 for ribbon.
- **Emergency/LOR can never get the adder** — that path returns hourly before
  any splice line is produced. Covered by a test that forces the flag on.
- Flagged jobs show a 🌙 pill on the job screen.

### Testing rule
- B&M cannot bill testing on a job that involved any splicing. The OTDR/bare
  test lines already followed that rule job-wide; the new CD/PMD adder now does
  too, on capital AND emergency. A test-only job still bills both.

### Rate-card Excel export
- Office/admin: **View draft invoice → ⬇ Download rate card (.xlsx)**.
- `GET /jobs/:id/invoice.xlsx` lays the draft onto the customer's own rate card
  (`apps/api/assets/rate-card-template.xlsx`, committed as supplied). All 251
  rows in their order, their rates, their formulas, their formatting. We write
  ONLY the Quantity column plus a job stamp on the two blank rows above the
  header. Blank rows stay blank and editable.
- **"ACTUAL" rows take dollars, not hours.** Unit 76 DOWNTIME - CAPITAL PROJECT
  is priced $1.00/unit, so 4 hr of downtime writes **500**, not 4. Same for unit
  251 traffic control and 252 trip charge. Unit 223 SPLICER - FIBER is a real
  $125.00 HOUR row, so hours go in as hours there. The rule is generic: when the
  billed rate differs from the card's unit rate, the extended dollars go in the
  quantity cell. Verified: sheet TOTAL matches the engine to the penny.
- **Formula cells keep their cached value.** A formula cell stores both the
  formula and its last computed answer; Excel renders the answer. Writing the
  formula without the answer makes the cell look blank. The export refreshes the
  cached value on each filled row's Extended cell and on the bottom TOTAL, and
  never touches any formula.
- Adds `exceljs` to the API. If that build ever fails, Render keeps the previous
  API live and only the download button errors.

## RESUME HERE — end-to-end smoke test on 26-408
Add a visit: MH · Re-enter · Single · 48 splices · 2 hr downtime → Mark complete
→ View draft invoice. **Expected total $2,732.98**
(MH setup $253 + re-enter $60.63 + 48×$45.19485 [25-48 band = $2,169.35] +
2×$125 downtime $250). If Mark Complete errors → API `CORS_ORIGINS`.

## Open billing question (money — confirm with Austin)
48-splice band: source doc contradicts itself (`48→25-48` table vs `48→49-144`
example). Engine uses literal `48→25-48 ($45.19)`. One-line change in
`packages/billing/src/bands.ts` if B&M bills it the other way.

## Next up (continued dev)
Admin job-create UI + user management · closure return-visit dedup ·
photo/OTDR uploads to `attachments` · offline capture · invoice PDF/edit/send ·
outage + test-only report flows.

## Where the code lives
GitHub `bandmtelecom/bm-field-app` (Render auto-deploys `main`) · this repo zip ·
the running services. Standing rule: full-repo zip delivered after every update.
