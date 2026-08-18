// The invoice engine. Pure function: JobInput → InvoiceDraft.
// Every rule here is documented in docs/BILLING-RULES.md and covered by tests.

import { RATE_CARD, rate } from './ratecard.js';
import {
  singleFusionBand, ribbonBand, otdrTestBand, bareTestBand,
} from './bands.js';
import type {
  JobInput, LocationInput, InvoiceLine, InvoiceDraft, StructureType,
} from './types.js';

const FIBER_MIN = 6;          // 6-fiber minimum per enclosure
const DOWNTIME_RATE = 125;    // $/hr, DOWNTIME - CAPITAL PROJECT
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

export function computeInvoice(job: JobInput): InvoiceDraft {
  const lines: InvoiceLine[] = [];

  if (job.billingMode === 'emergency') {
    // ---- Emergency / LOR: hourly splicer + materials only ----
    const hours = round2(
      job.visits.reduce((s, v) => s + (v.leadHours ?? 0), 0));
    if (hours > 0) {
      lines.push(line('SPLICER_FIBER', hours, rate('SPLICER_FIBER'),
        `Emergency/LOR hourly — ${hours} hr across ${job.visits.length} visit(s)`));
    }
    // materials still bill when added
    const splicingEmg = jobHasSplicing(job);
    for (const v of job.visits) {
      for (const loc of v.locations) {
        pushMaterials(lines, loc, v.date);
        pushExtras(lines, loc, v.date, splicingEmg);
      }
    }
    return finalize(job, lines);
  }

  // ---- Capital / day-to-day: per-unit ----
  const hasSplicing = jobHasSplicing(job);
  let downtimeHours = 0;

  for (const v of job.visits) {
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
      // On a scheduled maintenance-window (night) job every splice also carries
      // the maint adder, at the same billed quantity as the splice line itself.
      // Emergency/LOR never reaches here — that path returns hourly above — so a
      // night LOR can't pick up the adder.
      if (loc.spliceType && (loc.spliceCount ?? 0) > 0) {
        if (loc.spliceType === 'single') {
          const count = Math.max(loc.spliceCount ?? 0, FIBER_MIN);
          const band = singleFusionBand(count);
          lines.push(line(band, count, rate(band),
            `${count} single splices · ${src}`));
          if (job.maintWindow) {
            lines.push(line('FUSION_MAINT_ADDER', count, rate('FUSION_MAINT_ADDER'),
              `Maintenance window adder — ${count} splices · ${src}`));
          }
        } else {
          const ribbons = Math.max(loc.spliceCount ?? 0, 1); // >=1 ribbon
          const band = ribbonBand(ribbons);
          lines.push(line(band, ribbons, rate(band),
            `${ribbons} ribbon splices · ${src}`));
          if (job.maintWindow) {
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

      downtimeHours += loc.downtimeHours ?? 0;
    }
  }

  // downtime (one rolled-up line for the job)
  if (downtimeHours > 0) {
    const h = round2(downtimeHours);
    lines.push(line('DOWNTIME_CAPITAL', h, DOWNTIME_RATE,
      `Downtime ${h} hr × $${DOWNTIME_RATE}/hr`));
  }

  return finalize(job, lines);
}

function labelHole(loc: LocationInput): string {
  const s: Record<StructureType, string> = {
    mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
  };
  return loc.closureCode ? `${s[loc.structureType]} (${loc.closureCode})` : s[loc.structureType];
}

function pushMaterials(lines: InvoiceLine[], loc: LocationInput, date: string) {
  const src = `${loc.closureCode ?? 'closure'} · ${date}`;
  if ((loc.traysAdded ?? 0) > 0) {
    const n = loc.traysAdded as number;
    lines.push(line('ADD_TRAY', n, rate('ADD_TRAY'), `${n} trays added · ${src}`));
    if (loc.trayMaterialCode) {
      lines.push(line(loc.trayMaterialCode, n, rate(loc.trayMaterialCode),
        `Tray material ×${n} · ${src}`));
    }
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
