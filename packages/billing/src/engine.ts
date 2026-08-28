// The invoice engine. Pure function: JobInput → InvoiceDraft.
// Every rule here is documented in docs/BILLING-RULES.md and covered by tests.

import { RATE_CARD, rate } from './ratecard.js';
import {
  singleFusionBand, ribbonBand, otdrTestBand, bareTestBand,
} from './bands.js';
import type {
  JobInput, VisitInput, LocationInput, InvoiceLine, InvoiceDraft, StructureType,
} from './types.js';

const FIBER_MIN = 6;          // 6-fiber minimum per enclosure
const DOWNTIME_RATE = 125;    // $/hr, DOWNTIME - CAPITAL PROJECT (capital only)
const TRAVEL_HOURS_PER_TECH = 2;  // 1 hr to the job + 1 hr back, per tech, per trip (LOR only)
const SETUP_BY_STRUCTURE: Record<StructureType, string> = {
  mh: 'SETUP_MH',
  hh: 'SETUP_HH',
  aerial: 'SETUP_AERIAL',
  building: 'SETUP_BUILDING',
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function desc(code: string): string {
  return RATE_CARD[code]?.assembly ?? code;
}

function line(code: string, qty: number, unitRate: number, source: string): InvoiceLine {
  return {
    unitCode: code,
    description: desc(code),
    quantity: qty,
    rate: unitRate,
    extended: round2(qty * unitRate),
    source,
  };
}

/** A stable key for "the same hole" so setup/teardown bills once per hole/visit. */
function holeKeyOf(loc: LocationInput): string {
  if (loc.holeKey) return loc.holeKey;
  if (loc.gpsLat != null && loc.gpsLng != null) {
    return `${loc.structureType}@${loc.gpsLat.toFixed(5)},${loc.gpsLng.toFixed(5)}`;
  }
  return `loc:${loc.id}`; // no grouping info → treat as its own hole
}

function jobHasSplicing(job: JobInput): boolean {
  return job.visits.some(v =>
    v.locations.some(l => !!l.spliceType && (l.spliceCount ?? 0) > 0));
}

/**
 * The men who worked one hole.
 *
 * 26-352, night of 8/21: Armando and Spencer were in Lumen-0016 while Jesus and
 * Josh L were in Lumen-0017. Downtime bills per tech, so multiplying every hole
 * by the whole visit crew billed 7.5 standby hours against four men when two
 * were standing there — about $1,900 wrong on one job.
 *
 * Locations filed before 8/28/26 have no crew of their own; those fall back to
 * the visit, which is exactly how they billed when they were filed.
 */
function crewAt(loc: LocationInput, visit: VisitInput): string[] {
  if (loc.techs?.length) return loc.techs;
  return visit.techs ?? [];
}

/** Nobody can work a hole with no men in it — an unnamed crew still counts as one. */
const crewSize = (names: string[]): number => Math.max(names.length, 1);

/**
 * Every distinct man who worked the job, however his name was capitalised.
 *
 * Travel is 2 hr a man for the roll-out (1 hr there, 1 hr back) and it is earned
 * ONCE, per man, per cut — not per report filed. Austin, 8/28, on the two 8/21
 * reports: "8/21 was not another trip it was an added location." Counting per
 * visit row billed a second drive-out that never happened.
 */
function techsOnJob(job: JobInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of job.visits) {
    for (const loc of v.locations) {
      for (const name of crewAt(loc, v)) {
        const key = name.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name.trim());
      }
    }
    // a report with no locations on it still had men on the trip
    for (const name of v.techs ?? []) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name.trim());
    }
  }
  return out;
}

export function computeInvoice(job: JobInput): InvoiceDraft {
  const lines: InvoiceLine[] = [];

  // Capital and Emergency/LOR bill the SAME units — every setup, re-enter,
  // splice, tray, case and extra the crew earned. The difference is the hours:
  //
  //   capital    → downtime bills as unit 76 DOWNTIME - CAPITAL PROJECT,
  //                $125/hr, entered on the rate card as dollars
  //   emergency  → unit 223 SPLICER - FIBER ($125/hr), which ALSO covers travel:
  //                1 hr out + 1 hr back, PER TECH, per cut
  //
  // Downtime is PER TECH on both: 2 hr with 3 techs = 6 billable hours, counted
  // against the men in THAT hole. On-site WORKING time does NOT bill hourly —
  // the units cover it.
  //
  // Unit 223 is emergency/LOR only; unit 76 is capital only. They never mix.
  const isEmergency = job.billingMode === 'emergency';
  const hasSplicing = jobHasSplicing(job);
  let downtimeHours = 0;       // raw hours × the crew standing at each hole
  let rawDowntime = 0;         // the hours as the crew logged them, for the audit line

  // Drive time is only earned when B&M rolls out on the call. If the customer's
  // tech scheduled it a day or two out, no travel hours — but downtime on site
  // still bills under 223.
  const billsTravel = isEmergency && job.scheduledAhead !== true;

  // 2 hr for each man who rolled out on the cut, counted once for the job. Two
  // reports filed on one night are two locations, not two drive-outs.
  const jobCrew = techsOnJob(job);
  const travelHours = billsTravel ? TRAVEL_HOURS_PER_TECH * crewSize(jobCrew) : 0;

  for (const v of job.visits) {
    // Downtime bills for EVERY tech standing on it, on capital and LOR alike,
    // and only for the men who were actually in that hole. A crew that splits
    // between two closures the same night bills each hole against its own men.
    for (const l of v.locations) {
      const hrs = l.downtimeHours ?? 0;
      if (!hrs) continue;
      rawDowntime += hrs;
      downtimeHours += hrs * crewSize(crewAt(l, v));
    }
    // one setup per hole per visit
    const seenHoles = new Set<string>();
    for (const loc of v.locations) {
      const hk = holeKeyOf(loc);
      if (!seenHoles.has(hk)) {
        seenHoles.add(hk);
        const setupCode = SETUP_BY_STRUCTURE[loc.structureType];
        lines.push(line(setupCode, 1, rate(setupCode),
          `Setup/teardown — ${labelHole(loc)} · ${v.date}`));
      }
    }

    for (const loc of v.locations) {
      const src = `${loc.closureCode ?? 'closure'} · ${v.date}`;

      // case action
      switch (loc.caseAction) {
        case 'reenter':
          lines.push(line('REENTER', 1, rate('REENTER'), `Re-enter · ${src}`));
          break;
        case 'new_case':
          lines.push(line('CASE_NEW', 1, rate('CASE_NEW'), `New case labor · ${src}`));
          if (loc.newCaseMaterialCode) {
            lines.push(line(loc.newCaseMaterialCode, 1, rate(loc.newCaseMaterialCode),
              `New case material · ${src}`));
          }
          break;
        case 'midsheath':
          lines.push(line('PREP_MIDSHEATH', 1, rate('PREP_MIDSHEATH'),
            `Midsheath prep · ${src}`));
          break;
      }

      // splices (6-fiber minimum per enclosure)
      // On a scheduled maintenance-window (night) CAPITAL job every splice also
      // carries the maint adder, at the same billed quantity as the splice line.
      // An LOR worked at night never gets it, even if the flag is somehow set.
      const maintAdder = job.maintWindow === true && !isEmergency;
      if (loc.spliceType && (loc.spliceCount ?? 0) > 0) {
        if (loc.spliceType === 'single') {
          const count = Math.max(loc.spliceCount ?? 0, FIBER_MIN);
          const band = singleFusionBand(count);
          lines.push(line(band, count, rate(band),
            `${count} single splices · ${src}`));
          if (maintAdder) {
            lines.push(line('FUSION_MAINT_ADDER', count, rate('FUSION_MAINT_ADDER'),
              `Maintenance window adder — ${count} splices · ${src}`));
          }
        } else {
          const ribbons = Math.max(loc.spliceCount ?? 0, 1); // >=1 ribbon
          const band = ribbonBand(ribbons);
          lines.push(line(band, ribbons, rate(band),
            `${ribbons} ribbon splices · ${src}`));
          if (maintAdder) {
            lines.push(line('RIBBON_MAINT_ADDER', ribbons, rate('RIBBON_MAINT_ADDER'),
              `Maintenance window adder — ${ribbons} ribbons · ${src}`));
          }
        }
      }

      // trays + tray material
      pushMaterials(lines, loc, v.date);
      // tap-to-add extras (civil, case work, misc materials)
      pushExtras(lines, loc, v.date, hasSplicing);

      // testing — only counted here; zeroed later if the job has any splicing
      if (!hasSplicing && (loc.testFiberCount ?? 0) > 0) {
        const n = loc.testFiberCount as number;
        const band = (loc.testType ?? 'otdr') === 'bare'
          ? bareTestBand(n) : otdrTestBand(n);
        lines.push(line(band, n, rate(band), `${n} fibers tested · ${src}`));
      }

      // (downtime is totted up per visit above, so it can multiply by the crew)
    }
  }

  // ---- the hours, rolled up for the job ----
  if (isEmergency) {
    // travel and downtime both bill under unit 223 SPLICER - FIBER, kept as two
    // lines so the invoice shows WHY each hour is there. The rate-card export
    // sums them back onto the one row.
    if (travelHours > 0) {
      const h = round2(travelHours);
      const who = jobCrew.length ? jobCrew.join(', ') : 'crew not named';
      lines.push(line('SPLICER_FIBER', h, rate('SPLICER_FIBER'),
        `Travel — ${TRAVEL_HOURS_PER_TECH} hr per tech on the cut × ${crewSize(jobCrew)} tech(s): ${who}`));
    }
    if (downtimeHours > 0) {
      const h = round2(downtimeHours);
      lines.push(line('SPLICER_FIBER', h, rate('SPLICER_FIBER'),
        `Downtime — ${round2(rawDowntime)} hr on site × the crew in each hole = ${h} tech-hour(s)`));
    }
  } else if (downtimeHours > 0) {
    const h = round2(downtimeHours);
    lines.push(line('DOWNTIME_CAPITAL', h, DOWNTIME_RATE,
      `Downtime — ${round2(rawDowntime)} hr on site × the crew in each hole = ${h} tech-hour(s) × $${DOWNTIME_RATE}/hr`));
  }

  return finalize(job, lines);
}

function labelHole(loc: LocationInput): string {
  const s: Record<StructureType, string> = {
    mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
  };
  return loc.closureCode ? `${s[loc.structureType]} (${loc.closureCode})` : s[loc.structureType];
}

// Every tray B&M installs bills as unit 173 FIB TRAY 72 FOSC 600 D ($26.402175).
// The app used to guess the tray from the enclosure model, which put trays on
// unit 171 (FIB TRAY 48, $21.35) and other wrong rows. Austin's rule, 8/18: it's
// always 173. `loc.trayMaterialCode` is deliberately ignored — the column stays
// in the database as a record of what the tech saw, but it does not price.
const TRAY_MATERIAL = 'TRAY_72_600D';

function pushMaterials(lines: InvoiceLine[], loc: LocationInput, date: string) {
  const src = `${loc.closureCode ?? 'closure'} · ${date}`;
  if ((loc.traysAdded ?? 0) > 0) {
    const n = loc.traysAdded as number;
    lines.push(line('ADD_TRAY', n, rate('ADD_TRAY'), `${n} trays added · ${src}`));
    lines.push(line(TRAY_MATERIAL, n, rate(TRAY_MATERIAL), `Tray material ×${n} · ${src}`));
  }
}

// Tap-to-add units that are TESTING charges. B&M cannot bill testing on a job
// that involved any splicing, so these drop out exactly like the OTDR/bare test
// lines do — even though the tech correctly reported doing the work.
const TESTING_EXTRAS = new Set(['TEST_CD_PMD']);

function pushExtras(lines: InvoiceLine[], loc: LocationInput, date: string, hasSplicing = false) {
  const src = `${loc.closureCode ?? 'closure'} · ${date}`;
  for (const e of loc.extraUnits ?? []) {
    if (hasSplicing && TESTING_EXTRAS.has(e.code)) continue;
    const qty = e.qty ?? 1;
    lines.push(line(e.code, qty, rate(e.code),
      e.note ? `${e.note} · ${src}` : `Added unit · ${src}`));
  }
}

function finalize(job: JobInput, lines: InvoiceLine[]): InvoiceDraft {
  const subtotal = round2(lines.reduce((s, l) => s + l.extended, 0));
  return {
    bmNumber: job.bmNumber,
    billingMode: job.billingMode,
    lines,
    subtotal,
    total: subtotal, // tax already included in rate-card rates
  };
}
