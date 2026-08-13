# B&M Field App

Field reporting + auto-invoicing for B&M Telecom's fiber crews.

Techs file one structured report per location from their phone. When a job is
marked complete, the app drafts an invoice priced off the Lumen rate card and
routes it to Austin for approval. **Prices never appear on a tech's device.**

This is the production build. Stack: **Supabase** (Postgres + Auth + Storage +
row-level security) and **Render** (hosts the PWA and the API). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit.

---

## Repo layout

```
bm-field-app/
├── supabase/            # database: schema, security, rate-card seed (SQL migrations)
├── packages/billing/    # the invoice engine — pure TypeScript, fully unit-tested
├── apps/api/            # Express backend on Render (invoice drafting, KML export)
├── apps/web/            # the React PWA the techs install to their phones
├── docs/                # setup-from-zero guides + the billing rules
├── render.yaml          # Render blueprint (deploys both services)
└── .env.example         # copy to .env, fill in
```

## Standing up from zero — read these in order

1. [`docs/SETUP-01-SUPABASE.md`](docs/SETUP-01-SUPABASE.md) — create the database, run the migrations, add users.
2. [`docs/SETUP-03-GITHUB.md`](docs/SETUP-03-GITHUB.md) — put this repo on GitHub.
3. [`docs/SETUP-02-RENDER.md`](docs/SETUP-02-RENDER.md) — deploy the API + PWA.

## Run it locally (for the dev buddy)

```bash
npm install                 # installs all workspaces
cp .env.example .env        # then fill in the Supabase values
npm run test:billing        # prove the invoice engine (should pass)
npm run dev:api             # API on http://localhost:8080
npm run dev:web             # PWA on http://localhost:5173
```

## The two things that make this app worth owning

- **The invoice engine** ([`packages/billing/`](packages/billing/)) turns captured
  field units into a priced draft, applying every billing rule B&M uses. It's a
  pure function with a full test suite — see [`docs/BILLING-RULES.md`](docs/BILLING-RULES.md).
- **Price gating** is enforced in the database itself (row-level security), not
  just hidden in the UI. A tech account literally cannot read a price. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#security-model).

## Status

See [`docs/BUILD-STATUS.md`](docs/BUILD-STATUS.md) for what's done and what's next.
