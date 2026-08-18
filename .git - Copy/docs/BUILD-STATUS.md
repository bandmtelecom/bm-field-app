# Build status

_Updated: 2026-08-13 (Cowork session)_

## Done — this cut

- **Monorepo scaffold** (npm workspaces): `supabase/`, `packages/billing/`,
  `apps/api/`, `apps/web/`, `docs/`, `render.yaml`, `.env.example`.
- **Database** (`supabase/migrations/`): full running-record schema; row-level
  security with **prices gated to office/admin at the DB level**; the **69
  billable Lumen units seeded** from the actual BAFO rate card. Optional dev
  `seed.sql`.
- **Invoice engine** (`packages/billing/`): every billing rule implemented and
  **proven by a 19-test suite (all passing)** — splice bands, 6-fiber minimum,
  setup-per-hole, re-enter-per-closure, case actions, testing-zeroed-if-spliced,
  emergency/LOR hourly, downtime $125/hr. Rate card mirrored into TS from the
  same source so it can't drift from the DB.
- **API** (`apps/api/`): `POST /jobs/:id/invoice` (mark-complete → draft, prices
  server-side only), `GET /jobs/:id/invoice` (office draft), `GET /closures.kml`.
- **PWA** (`apps/web/`): installable app — login, job lookup, running-record
  view, add-visit with location blocks (structure, GPS grab, enclosure, case
  action, single/ribbon + count, shots, cables / panel-ports for buildings,
  downtime, tap-to-add extras), mark-complete, office invoice view with approve.
- **Setup-from-zero guides** for Supabase, GitHub, and Render.

## Confirm with Austin (billing)

- **48-splice band ambiguity**: the source mapping doc contradicts itself
  (`48 → 25-48` in the table vs `48 → 49-144` in one example). The engine uses
  the literal boundary (`48 → 25-48 = $45.19`). One-line change in
  `packages/billing/src/bands.ts` if B&M bills it the other way. See
  `docs/BILLING-RULES.md`.

## Next up (continued development)

- **Closure return-visit matching / dedup** — right now every GPS location
  creates a new closure registry entry. v1.1: on GPS capture, find nearby
  closures, show their prior cable sequentials, tech confirms or creates new.
- **Photo / OTDR uploads** to Supabase Storage (schema + bucket ready; wire the
  upload UI + attachment rows).
- **Offline capture** — cache active jobs, submit when back in range; cache tied
  to login, wiped on logout/deactivation (hook already present).
- **Admin screens** — user management (add/deactivate), job creation form
  (so a job auto-appears on the roster when Austin assigns the B&M number).
- **Invoice polish** — export/PDF, edit lines before approve, send integration.
- **Report types** — outage timeline UI, test/FQA-only flow.
- **Harden the engine build** for the API: run `npm run build:billing` before
  `dev:api` (or add a dev alias) so `@bm/billing` resolves locally.

## Note on this session's environment

The engine was tested here (19/19 pass via tsx). The API and PWA could not be
`npm install`-ed in this sandbox (registry blocked), so they haven't been run
here — they're written to compile and deploy on your machine / Render. First
local run: `npm install` then `npm run test:billing`, `npm run dev:api`,
`npm run dev:web`.
