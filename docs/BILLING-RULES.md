# Billing rules — the invoice engine spec

This is the plain-English source of truth for `packages/billing`. Every rule
here has a matching test in `packages/billing/test/engine.test.ts`. Prices come
from the **Lumen BAFO R1 · 2026LE000053 TX** rate card (69 billable units,
seeded in `supabase/migrations/*_seed_ratecard.sql`).

> Confidential: dollar figures are back-office only (Austin, Matt, Billie).

## Billing mode — set by the job

- **Capital / day-to-day** → **per-unit** billing (splices, setups, materials,
  civil). Downtime bills at **$125/hr** (`DOWNTIME - CAPITAL PROJECT`).
- **Emergency / LOR** (outage TT#, or a Lumen LOR) → **hourly** billing:
  `SPLICER - FIBER` at **$125/hr** off the lead-tech clocker hours. This is the
  only time the hourly splicer unit is used. Per-unit lines are **not** billed
  on these jobs.

The engine picks the mode from `job.billing_mode` (`capital` | `emergency`),
which is derived when the job is created from its identifier type
(LOR / TT → emergency; N-number / address → capital). Austin can override.

## Per-unit rules (capital jobs)

### Setup / teardown — one per hole (structure), per visit
The structure type sets the fee, charged **once per hole** regardless of how
many closures are in it:

| Structure | Unit | Rate |
|---|---|---|
| Manhole | `SPL SETUP-TEARDOWN VAULT-MH-FIB` | $253.00 |
| Aerial | `SPL SETUP-TEARDOWN AERIAL-FIB` | $200.00 |
| Building | `SPL SETUP-TEARDOWN BUILDING-FIB` | $195.00 |
| Handhole | `SPL SETUP-TEARDOWN HH-FIB` | $150.00 |

### Re-enter — one per **enclosure** opened
`RE-ENTER EXIST FIBER CASE` **$60.63** for each existing closure opened. Two
closures in one manhole = **one** MH setup + **two** re-enters. Re-entering a
panel in a Building uses this same unit.

### Case action (per closure) — Re-enter · New case · Midsheath prep
- **Re-enter** → the $60.63 above.
- **New case** → `CASE FIBER NEW` **$242.00** (labor) **plus** the physical case
  **material** the tech picked (aerial or UG, size B/D). The case material is
  always billed on a new case.
- **Midsheath prep** → `PREP FIBER CABLE MIDSHEATH CASE` **$245.45** *only* — no
  new case billed.

### Splices — the count made at that location sets the band
Applied **per closure**, with a **6-fiber minimum** (`bill = max(actual, 6)`).

- **Single fusion** — bill `bandCount × single-band rate`, where the band is
  chosen by the count:

  | Count falls in | Unit | Rate/ea |
  |---|---|---|
  | 1–4 | `SPLICE FIBER FUSION 1-4` | $62.19 |
  | 5–12 | `SPLICE FIBER FUSION 5-12` | $65.19 |
  | 13–24 | `SPLICE FIBER FUSION 13-24` | $55.19 |
  | 25–48 | `SPLICE FIBER FUSION 25-48` | $45.19 |
  | 49–144 | `SPLICE FIBER FUSION 49-144` | $35.19 |
  | 145–288 | `SPLICE FIBER FUSION 145-288` | $30.19 |
  | 289–432 | `SPLICE FIBER FUSION 289-432` | $27.19 |
  | 433–864 | `SPLICE FIBER FUSION 433-864` | $25.19 |
  | > 864 | `SPLICE FIBER FUSION > 864` | $23.19 |

  (The 6-fiber floor means we never actually land in the 1–4 band.) The count
  lands in the band whose range contains it — 48 is the **top** of the 25-48
  band, so 48 singles → 25-48 band → **48 × $45.19 = $2,169.35**. It crosses
  into 49-144 at 49.

  > ⚠️ **CONFIRM WITH AUSTIN:** the source rate-card mapping doc contradicts
  > itself here — its band table says `48 → 25-48`, but one later example says
  > `48 → 49-144`. The engine uses the literal band boundaries (`48 → 25-48`).
  > If B&M actually bills 48 at the 49-144 rate, change one line in
  > `packages/billing/src/bands.ts` (`<= 48` → `< 48`).

- **Ribbon** — the tech enters the number of **ribbons** (1 ribbon = 12 fibers).
  Bill `ribbons × ribbon-band rate` — **per ribbon, fiber count is irrelevant**:

  | Ribbons | Unit | Rate/ea |
  |---|---|---|
  | ≤ 2 | `SPLICE FIBER RIBBONS <=2` | $257.48 |
  | 3–12 | `SPLICE FIBER RIBBONS 3-12` | $231.48 |
  | 13–24 | `SPLICE FIBER RIBBONS 13-24` | $200.00 |
  | 25–36 | `SPLICE FIBER RIBBONS 25-36` | $179.48 |
  | 37–72 | `SPLICE FIBER RIBBONS 37-72` | $174.00 |
  | 73–144 | `SPLICE FIBER RIBBONS 73-144` | $151.48 |
  | 145–288 | `SPLICE FIBER RIBBONS 145-288` | $122.48 |

  Example: 12 ribbons (144 fibers on the glass) → 3-12 band →
  **12 × $231.48 = $2,777.80**. Ribbonize ≤12 and the maint adders are
  tap-to-add extras.

### Testing — only on test-only jobs
`TEST FIBER - PWR-MTR OTDR` (banded per fiber) or `TEST FIBER BARE`.
**If any splice unit exists anywhere on the job, all test lines are zeroed** —
the splice units cover testing. Crews still record shots; it just doesn't bill.

### Trays / materials — only when new/added
- `ADD FIBER TRAY OR BASKET` **$20.75** labor per tray, plus the tray material
  (type inferred from enclosure model + single/ribbon: 450B-24 $8.66,
  600D-24 ribbon $37.62, 600D-48 $21.35).
- A plain re-enter with no new material adds nothing.
- Trickier materials (ground bracket kit, jumper footage, adapters) ride in
  notes and are reconciled on the back end.

### Downtime (capital jobs)
`DOWNTIME - CAPITAL PROJECT` at **$125/hr** — `hours × 125`. Example:
44 hrs → **$5,500**.

### Civil / underground (tap-to-add)
Dewatering $338.40, Expose HH-MH ≤12in $300 (+$130 each additional 12in), etc.

## Hourly rules (emergency / LOR jobs)
`SPLICER - FIBER` **$125/hr** × the lead-tech hours across the job's visits.
Downtime, per-unit splices/setups/tests are **not** separately billed — the
hourly line is the bill (materials still bill when added).

## What the engine returns
A draft invoice: an array of line items (`unit_code`, `description`,
`quantity`, `rate`, `extended`) plus a `total`. Each line records **why** it
exists (which closure/visit drove it) so the back office can audit before Austin
approves and sends. Nothing is sent to the customer automatically.
