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
