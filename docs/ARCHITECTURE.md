# Architecture

## The shape of it

```
   PHONE (field tech)                  BACK OFFICE (Austin/Matt/Billie)
   ┌───────────────┐                   ┌───────────────────────────┐
   │  PWA (apps/web)│                  │  PWA (apps/web) — admin view│
   │  units only    │                  │  sees prices + invoices     │
   └───────┬────────┘                  └──────────────┬─────────────┘
           │                                          │
           │ supabase-js (anon key + user login)      │
           ▼                                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                        SUPABASE                                │
   │  Postgres  ·  Auth (per-tech logins)  ·  Storage (photos/OTDR) │
   │  Row-Level Security = the price wall (techs can't read $)      │
   └───────────────────────┬──────────────────────────────────────┘
                           │ service-role key (secret, server only)
                           ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                   API  (apps/api, on Render)                   │
   │  • POST /jobs/:id/invoice   → runs the billing engine, writes  │
   │                                the draft (prices computed here)│
   │  • GET  /closures.kml       → exports the closure registry     │
   │  uses packages/billing (the invoice engine)                    │
   └──────────────────────────────────────────────────────────────┘
```

Two Render services deploy from this one repo: `bm-field-web` (the static PWA)
and `bm-field-api` (the Node backend). Supabase is a managed service — no server
of ours to run; we just own the Postgres data and can export it any time.

## Why the invoice math runs on the server, not the phone

Prices must never reach a tech's device. So the billing engine
(`packages/billing`) is imported by the **API only**. When a job is marked
complete, the phone calls `POST /jobs/:id/invoice`; the API reads the captured
units with the **service-role key**, prices them, and writes an `invoice_draft`
row. The tech's app never receives a dollar figure — it just sees "invoice
drafted, sent for approval."

## Security model

Price gating is enforced in **three** layers, deepest first:

1. **Database (row-level security).** The `rate_card`, `invoice_drafts`, and
   `invoice_lines` tables have RLS policies that only allow `SELECT` when the
   requesting user's role is `office` or `admin`. A tech's JWT carries
   `role = tech`, so a tech's query for a price returns **zero rows** — even if
   someone tampered with the app. This is the real wall.
2. **API.** The engine runs behind the service-role key, which lives only in the
   Render API env. The phone can't call Supabase with it.
3. **UI.** The web app simply never renders price components for a tech role.
   (Convenience only — layers 1 and 2 are what actually protect the data.)

Roles live on each user (`profiles.role`): `tech`, `office`, `admin`.
**Instant kill-switch:** an admin flips `profiles.is_active = false` (and/or
disables the Supabase auth user) → the account can't log in and its offline
cache is wiped on next launch. See `docs/SETUP-01-SUPABASE.md`.

## Data model (the running record)

A **job** holds many **visits** (one per tech per trip — nothing overwrites).
A visit holds many **locations** (closures). Each location carries its
enclosure, case action, splices (single/ribbon + count), shots, cables (or
panel ports when it's a Building), downtime, materials, and photos. Closures
also register in a company-wide **closure registry** (customer + sequential ID,
e.g. `Lumen-0042`) that feeds the Google Earth KML. Full column-by-column
detail is in the migration files under `supabase/migrations/`.

## Offline (planned, v1.1)

The PWA caches the tech's active jobs so a report can be filled with no signal
and synced when back in range. The cache is keyed to the login and cleared on
logout/deactivation. Not in the first cut — noted here so it isn't lost.
