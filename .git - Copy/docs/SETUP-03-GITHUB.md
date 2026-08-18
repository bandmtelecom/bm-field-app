# Setup 2 — Put the repo on GitHub

Render deploys from GitHub, and it's how you and your dev buddy share the code.
Claude hands you this repo as a zip after every update — this is how you get an
updated zip onto GitHub.

## First time — create the repo
1. Unzip the delivered `bm-field-app.zip` somewhere permanent (e.g.
   `Documents\bm-field-app`).
2. Go to <https://github.com> → **New repository**. Name: `bm-field-app`.
   Set it **Private**. Don't add a README/gitignore (the repo already has them).
3. On your machine (Git must be installed — <https://git-scm.com>):
   ```bash
   cd path/to/bm-field-app
   git init
   git add .
   git commit -m "Initial commit — B&M field app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/bm-field-app.git
   git push -u origin main
   ```
4. Add your dev buddy: repo → **Settings → Collaborators → Add people**.

## Every later update (new zip from Claude)
Easiest is to let your dev buddy manage this, but here's the simple path: unzip
the new version over your working copy, then:
```bash
cd path/to/bm-field-app
git add .
git commit -m "Update from Claude — <what changed>"
git push
```
Render auto-deploys on push (once it's connected — next guide).

> ⚠️ Never commit `.env` — it holds secrets. The `.gitignore` already blocks it.

➡️ Next: [`SETUP-02-RENDER.md`](SETUP-02-RENDER.md).
