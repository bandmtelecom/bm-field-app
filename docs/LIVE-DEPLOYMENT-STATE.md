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

## v0.3.0 — the closure registry actually works (2026-08-19)

**No SQL. Code push only.**

### The problem it fixes
A diagnostic on 8/19 found the `closures` table **completely empty**: 0 closures,
0 with GPS, 16 locations all with `closure_id` null. The Google Earth export had
no pins because there was nothing to plot. Two causes:
1. A closure was only ever created `if (L.gps_lat && L.gps_lng)`, and GPS had
   never once been captured — the 16 existing locations were back-entered from
   the office off paper reports, where there is no GPS to grab.
2. Even when captured, every visit minted a BRAND NEW code, so a return trip to
   the same hole could never accumulate history.

### Austin's identity rule — the thing that shapes the design
> "If it's close we need to look at the cables that my techs put in and see if
> they match. If they do it's the same closure. If they are different it's a new
> closure. **We have holes with more than 1 closure in it.**"

Proximity can therefore NEVER decide identity — two closures in one hole share
coordinates. GPS only narrows candidates; the tech confirms by cable.

### What shipped
- **`lib/closures.ts`** — registry queries: `closuresNear()` (bounding-box
  prefilter + haversine, 150 ft default), `searchClosures()` by code,
  `closureHistory()`, and `cableLabel()`. Each candidate carries its cables on
  record, last worked date and visit count.
- **`ClosurePicker`** on every location block. Once GPS lands it lists nearby
  known closures **with their cables**, so the tech matches what's in the hole
  and taps the right one — or taps "＋ New closure" explicitly. Also a
  search-by-code path for office back-entry with no GPS. Nothing auto-picks.
- **`AddVisit`** now attaches to the picked closure and only mints a new code
  when the tech asked for one. This is what stops duplicates.
- **`/closures`** — "Closures near me" (the field path; the tech knows where he
  is, not the number) plus search by code, and the Google Earth KML link.
- **`/closures/:id`** — the whole point: everything B&M has ever done at that
  closure, newest first. Cables on record, then per visit: date, techs, job
  number, case action, splice counts, trays, fibers tested, as-found, as-built,
  narrative, and the cables recorded that visit. No prices — techs can use it.
- Jobs header now links to **Closures** (the raw KML link moved inside it).

### Still open
The 16 existing locations have no closure attached and no GPS, so they can't be
backfilled automatically — someone has to say where they were. A backfill tool
is worth building once real closures start landing.

## v0.2.8 — kill Excel's stale-value strikethrough on the rate card (2026-08-19)

**No SQL. Code push only.**

### What the "strikethrough" actually was
Excel's **stale value formatting**. In *Partial* calculation mode Excel draws a
line through any formula result it has not itself computed. Because the export
injects quantities into cells that formulas depend on, every cell in the three
formula columns — I (Tax), J (Total Per Unit), L (Extended) — got flagged. Plain
value columns E-H and K were never touched, which is exactly the pattern Austin
saw. It appeared on open, and came back whenever he sorted, because sorting
triggers a recalculation.

It is NOT a font strikethrough: Format Cells → Font shows Strikethrough
unchecked, `styles.xml` has no strike font, and the only conditional formatting
applies thin borders. LibreOffice renders it clean, so it could never be
reproduced from the cloud session — Austin found the Microsoft doc that named it.

### The fix (all three together, or it doesn't work)
1. **Drop `xl/calcChain.xml`** entirely — Excel rebuilds it from scratch. Also
   strip its `[Content_Types].xml` override and its `workbook.xml.rels`
   relationship, or the file is malformed.
2. **`calcId="0"`** — tells Excel the file was written by something that cannot
   calculate.
3. **`fullCalcOnLoad="1"`**.

**`fullCalcOnLoad` on its own makes it WORSE** — that was v0.2.6, and removing it
in v0.2.7 fixed the open-time case but not sorting. Excel still trusted its
existing calculation chain. Only dropping the chain forces a genuine full recalc.

Verified against Austin's Excel: TEST-A (his untouched file) clean, TEST-B (patch,
no flag) clean on open but not after sorting, **TEST-C (chain dropped + calcId 0 +
fullCalcOnLoad) clean including after sorting**. Shipped as TEST-C.

### Also worth knowing
Austin's Excel is in **Partial** calculation mode, which is what enables stale
formatting at all. Formulas → Calculation Options → **Automatic** would also
solve it, per-machine. The file-side fix is better because it doesn't depend on
anyone's settings. The numbers were never wrong — stale formatting is Excel being
cautious about values it didn't compute, not a miscalculation.

## v0.2.7 — drop fullCalcOnLoad from the rate-card export (2026-08-19)

**No SQL. Code push only. One-line fix, found by A/B test.**

v0.2.6 set `calcPr fullCalcOnLoad="1"` on `workbook.xml` as belt-and-braces on the
cached values. In Excel that made **every cell in the three formula columns (I Tax,
J Total Per Unit, L Extended) render with a line through it** on all 251 rows —
while the plain-value columns E-H stayed clean.

It is NOT a font strikethrough (Format Cells → Font shows Strikethrough
unchecked), there is no strike font in `styles.xml`, and the only conditional
formatting rules apply thin borders. LibreOffice renders it clean, so it is
Excel-specific and could not be reproduced from the cloud session.

Isolated by sending Austin two files:
- **TEST-A** — his rate card byte-for-byte untouched → clean
- **TEST-B** — the same cell patch, workbook.xml left alone → clean

Same 13 cell edits in both the broken and clean versions, so the per-cell patch
was never the problem. The flag was the only workbook-level change, and it was
the cause. Removed.

The cached values written by `patchQuantities()` are what Excel displays, so the
flag bought nothing. **`workbook.xml` is now read but never written** — the export
leaves 21 of 22 zip parts byte-identical to the customer's file.

Also confirmed 8/19: the "fresh untouched" rate card Austin re-uploaded is
**byte-for-byte identical** to the one already committed, so his highlighting was
never in the file and the template was never a variable.

## v0.2.6 — trays on unit 173, and an Excel export that doesn't get repaired (2026-08-18)

**No SQL needed.** Code push only.

### Trays always bill unit 173
Every tray now bills **unit 1 ADD FIBER TRAY OR BASKET ($20.75 labor) + unit 173
FIB TRAY 72 FOSC 600 D ($26.402175 material)**, regardless of enclosure model.
The app used to guess the tray material from the enclosure and put trays on unit
171 (FIB TRAY 48, $21.35) and other wrong rows — that's what the 8/18 download
showed (14 trays on 171 = $298.86). `locations.tray_material_code` still records
what the tech saw but no longer prices. Unit 173 added to `ratecard.ts` and the
seed. Austin's rule, 8/18.

### The Excel export no longer damages the workbook
Excel was warning "some parts are unreadable", repairing the file on open and
stripping the formatting — because exceljs **re-serialises the entire workbook**
when it saves, and it does not reproduce this file faithfully.

Replaced with surgical XML patching (`apps/api/src/lib/xlsxPatch.ts`, jszip):
open the customer's own .xlsx, rewrite ONLY the worksheet part, pass every other
part through byte-for-byte. Measured: **20 of 22 zip parts byte-identical** to the
supplied file — styles, theme, drawings, the logo image, print settings, external
links, shared strings all untouched. The two that change are the worksheet and
workbook.xml (the latter only to set `fullCalcOnLoad`).

- All 754 formulas stay live; we only refresh the cached answer Excel renders.
- **No stamp, no cosmetic edits.** The job number rides in the filename only —
  earlier versions wrote a job header into rows 1–2, which is the logo area.
- Unmappable unit codes come back in an `X-BM-Unmapped-Units` response header
  instead of being written into the sheet.
- `exceljs` removed, `jszip` added.

**Do not go back to a library that rebuilds the workbook.**

## v0.2.5 — downtime bills PER TECH on capital too (2026-08-18)

Neither v0.2.3 nor v0.2.4 was pushed — **v0.2.5 is the one to deploy.**

**Downtime is per tech on BOTH job types** (Austin, 8/18): 2 hr of downtime with
3 techs = 6 billable hours = $750, capital or LOR. Counted per visit against that
visit's tech list, so a job worked by different crews on different nights adds up
correctly (2 hr × 3 techs on night 1 + 1 hr × 1 tech on night 2 = 7 hr, not 9).

- capital → unit 76 DOWNTIME - CAPITAL PROJECT ($125/hr). On the rate card that's
  an ACTUAL row, so cell K gets the DOLLARS: 6 hr → **750**.
- LOR → unit 223 SPLICER - FIBER, alongside the travel hours.

## v0.2.4 — LOR downtime bills PER TECH (2026-08-18) · folded into v0.2.5

Correction on top of v0.2.3 (v0.2.3 was never pushed — use v0.2.4).

**Downtime on an LOR bills for every tech standing on it.** 3 hr of downtime with
5 techs on site = **15 billable hours**, not 3. Counted per visit against that
visit's "Techs on job" list, so a 3-night job with different crews each night
comes out right.

Austin's own numbers for 26-349, checked against the engine: 5 techs, one night,
3 hr downtime, rolled out → drive 5 × 2 = **10 hr**, downtime 3 × 5 = **15 hr**,
**25 hr** on unit 223 = $3,125. With one MH setup, a re-enter and 48 single
splices the job totals **$5,607.98**.

~~Capital downtime is NOT multiplied by the crew~~ — **superseded in v0.2.5:
Austin confirmed capital multiplies by the crew too.**

## v0.2.3 — LOR billing corrected (2026-08-18) · folded into v0.2.4

**⚠ RUN THE SQL FIRST:** `supabase/migrations/20260818000005_lor_scheduled.sql`
adds `jobs.scheduled_ahead`. Same rule as last time — column before code.

**This corrects a real billing error.** v0.2.2 billed an emergency/LOR as hourly
only, which would have dropped every unit the crew earned. Austin's rule:

- An LOR bills **100% of the units**, exactly like a capital job — setups,
  re-enters, splices, trays, cases, extras, all of it.
- Unit **223 SPLICER - FIBER** ($125/hr, HOUR — real rate, so hours go in as
  hours) covers two things and only these two:
  1. **Travel** — 1 hr out + 1 hr back, **per tech, per trip**. Tech count comes
     from the "Techs on job" box on each visit; a visit with nobody listed still
     bills one tech, since a visit can't happen with no one there.
  2. **Downtime × the crew** — every tech on site during downtime bills for it.
     On an LOR downtime bills under 223, NOT under unit 76.
- **On-site working time does NOT bill hourly.** The units cover it. The visit
  form's hours box is relabelled "Hours on site" and is record-only.
- **Scheduled-ahead LORs earn no drive time.** If the customer's tech asks us to
  come out in a day or two rather than rolling out on the call, no travel hours.
  Downtime still bills under 223. Set on the job at creation: Admin → Create job
  → "Rolled out on the call" / "Scheduled ahead".
- Unit 76 is capital-only, unit 223 is LOR-only. They never appear together.
- Maintenance-window adder still never applies to an LOR.

Worked example — 2 techs, one night, one MH, re-enter, 48 single splices, 2 hr
downtime: rolled-out LOR **$3,232.98**; the same work as capital **$2,732.98**;
the same LOR scheduled ahead **$2,732.98**.

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
