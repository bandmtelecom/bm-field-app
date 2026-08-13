# Setup 3 — Render (hosting) from zero

Render hosts two things from this one repo: the **API** (backend) and the
**web PWA** (what the phones load). The `render.yaml` blueprint sets both up.
Do Supabase and GitHub first.

## 1. Connect
1. Go to <https://render.com> → sign in with GitHub.
2. **New + → Blueprint** → pick your `bm-field-app` repo. Render reads
   `render.yaml` and proposes two services: `bm-field-api` and `bm-field-web`.

## 2. Fill in the environment variables
Render will ask for the values marked `sync: false`. Paste from your Supabase
keys (Setup 1):

**bm-field-api**
- `SUPABASE_URL` = your Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = the **service_role** secret
- `CORS_ORIGINS` = `https://bm-field-web.onrender.com` (add your custom domain
  later, comma-separated)

**bm-field-web**
- `VITE_SUPABASE_URL` = your Project URL
- `VITE_SUPABASE_ANON_KEY` = the anon public key
- `VITE_API_BASE_URL` = the API URL, `https://bm-field-api.onrender.com`
  (you'll know the exact name after the first deploy — set it, then trigger a
  redeploy of the web service so it bakes in)

## 3. Deploy
Click **Apply**. Render builds both. First build takes a few minutes. When
done you'll have:
- API at `https://bm-field-api.onrender.com` (check `/health` returns `ok`)
- PWA at `https://bm-field-web.onrender.com`

## 4. Plans / cost
- Blueprint sets the API to the **Starter** plan (always-on, ~$7/mo) so the
  first request each morning isn't slow. The web static site is free.
- Supabase free tier is fine to start; move to Pro (~$25/mo) when you want daily
  backups and no idle pausing. *(Confirm current pricing — it changes.)*

## 5. Install on a phone (the "app")
On the tech's phone, open the PWA URL in Chrome/Safari → **Add to Home Screen**.
It installs like an app; no app store. They log in with the account you made in
Supabase.

## Redeploys
Every `git push` to `main` auto-deploys. To roll back, Render → the service →
**Deploys** → pick a previous one → **Rollback**.

## Custom domain (optional, later)
Render → service → **Settings → Custom Domains**. Point e.g.
`field.bandmtelecom.com` at the web service; add it to `CORS_ORIGINS` on the API.
