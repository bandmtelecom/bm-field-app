import { describe, it, expect } from 'vitest';
import { computeInvoice, rate } from '../src/index';
import type { JobInput, LocationInput } from '../src/index';

// helpers -------------------------------------------------------------------
const loc = (o: Partial<LocationInput> & { id: string }): LocationInput => ({
  structureType: 'mh', ...o,
});
const capitalJob = (locations: LocationInput[], over: Partial<JobInput> = {}): JobInput => ({
  bmNumber: '26-408', billingMode: 'capital',
  visits: [{ id: 'v1', date: '2026-05-22', locations }], ...over,
});
const lineFor = (draft: ReturnType<typeof computeInvoice>, code: string) =>
  draft.lines.filter(l => l.unitCode === code);
const totalOf = (draft: ReturnType<typeof computeInvoice>, code: string) =>
  lineFor(draft, code).reduce((s, l) => s + l.extended, 0);

// ---------------------------------------------------------------------------
describe('setup / teardown — one per hole per visit', () => {
  it('MH setup billed once at $253', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', structureType: 'mh', closureCode: 'Lumen-0001',
            spliceType: 'single', spliceCount: 48 }),
    ]));
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(1);
    expect(totalOf(d, 'SETUP_MH')).toBe(253);
  });

  it('two closures in ONE manhole = one setup + two re-enters + each splices', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', holeKey: 'MH-7', closureCode: 'Lumen-0042',
            caseAction: 'reenter', spliceType: 'single', spliceCount: 24 }),
      loc({ id: 'b', holeKey: 'MH-7', closureCode: 'Lumen-0043',
            caseAction: 'reenter', spliceType: 'single', spliceCount: 12 }),
    ]));
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(1);          // one hole → one setup
    expect(lineFor(d, 'REENTER')).toHaveLength(2);           // per enclosure
    expect(totalOf(d, 'REENTER')).toBeCloseTo(rate('REENTER') * 2, 2);
    // 24 → 13-24 band, 12 → 5-12 band (different bands)
    expect(lineFor(d, 'FUSION_13_24').some(l => l.quantity === 24)).toBe(true);
    expect(lineFor(d, 'FUSION_5_12').some(l => l.quantity === 12)).toBe(true);
  });

  it('two different holes = two setups', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', holeKey: 'MH-1', structureType: 'mh', spliceType: 'single', spliceCount: 6 }),
      loc({ id: 'b', holeKey: 'AER-9', structureType: 'aerial', spliceType: 'single', spliceCount: 6 }),
    ]));
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(1);
    expect(lineFor(d, 'SETUP_AERIAL')).toHaveLength(1);
  });
});

describe('splices — count sets the band', () => {
  it('48 singles → 25-48 band → 48 × rate = $2,169.35 (48 is the TOP of the 25-48 band)', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 48 }),
    ]));
    const l = lineFor(d, 'FUSION_25_48')[0];
    expect(l.quantity).toBe(48);
    expect(l.extended).toBe(2169.35);
  });

  it('49 singles crosses into the 49-144 band', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 49 }),
    ]));
    expect(lineFor(d, 'FUSION_49_144')[0].quantity).toBe(49);
  });

  it('12 ribbons → 3-12 band → 12 × rate = $2,777.80 (per ribbon, not per fiber)', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'ribbon', spliceCount: 12 }),
    ]));
    const l = lineFor(d, 'RIBBON_3_12')[0];
    expect(l.quantity).toBe(12);
    expect(l.extended).toBe(2777.8);
  });

  it('6-fiber minimum: 3 singles bills as 6 in the 5-12 band', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 3 }),
    ]));
    const l = lineFor(d, 'FUSION_5_12')[0];
    expect(l.quantity).toBe(6);
    expect(l.extended).toBeCloseTo(6 * rate('FUSION_5_12'), 2);
  });

  it('single band boundaries pick the right unit', () => {
    const bands: [number, string][] = [
      [6, 'FUSION_5_12'], [24, 'FUSION_13_24'], [25, 'FUSION_25_48'],
      [144, 'FUSION_49_144'], [200, 'FUSION_145_288'], [900, 'FUSION_GT_864'],
    ];
    for (const [count, code] of bands) {
      const d = computeInvoice(capitalJob([loc({ id: 'x', spliceType: 'single', spliceCount: count })]));
      expect(lineFor(d, code)).toHaveLength(1);
    }
  });
});

describe('case actions', () => {
  it('new case → CASE_NEW labor + the physical case material', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', caseAction: 'new_case', newCaseMaterialCode: 'CASE_UG_D_1130',
            spliceType: 'single', spliceCount: 6 }),
    ]));
    expect(totalOf(d, 'CASE_NEW')).toBe(242);
    expect(totalOf(d, 'CASE_UG_D_1130')).toBeCloseTo(rate('CASE_UG_D_1130'), 2);
  });

  it('midsheath prep → PREP_MIDSHEATH only, NO new case', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', caseAction: 'midsheath', spliceType: 'single', spliceCount: 6 }),
    ]));
    expect(lineFor(d, 'PREP_MIDSHEATH')).toHaveLength(1);
    expect(lineFor(d, 'CASE_NEW')).toHaveLength(0);
  });
});

describe('testing rule', () => {
  it('is zeroed when the job has any splicing', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 24, testFiberCount: 24 }),
    ]));
    expect(lineFor(d, 'TEST_OTDR_13_24')).toHaveLength(0);
  });

  it('bills on a test-ONLY job (no splicing anywhere)', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', structureType: 'mh', testFiberCount: 24, testType: 'otdr' }),
    ]));
    const l = lineFor(d, 'TEST_OTDR_13_24')[0];
    expect(l.quantity).toBe(24);
    expect(l.extended).toBeCloseTo(24 * rate('TEST_OTDR_13_24'), 2);
  });
});

describe('downtime (capital)', () => {
  it('44 hrs → 44 × $125 = $5,500', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 6, downtimeHours: 20 }),
      loc({ id: 'b', spliceType: 'single', spliceCount: 6, downtimeHours: 24 }),
    ]));
    const l = lineFor(d, 'DOWNTIME_CAPITAL')[0];
    expect(l.quantity).toBe(44);
    expect(l.extended).toBe(5500);
  });
});

describe('trays / materials', () => {
  // Austin, 8/18: every tray is unit 1 ADD_TRAY + unit 173 TRAY_72_600D, whatever
  // the enclosure. This test used to expect the tray the tech's enclosure implied
  // (TRAY_600D_48) and has been failing on main ever since that rule landed —
  // `trayMaterialCode` is now recorded and deliberately not priced.
  it('2 trays → ADD_TRAY ×2 + unit 173 tray material ×2, whatever the enclosure', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 6,
            traysAdded: 2, trayMaterialCode: 'TRAY_600D_48' }),
    ]));
    expect(lineFor(d, 'ADD_TRAY')[0].quantity).toBe(2);
    expect(lineFor(d, 'TRAY_72_600D')[0].quantity).toBe(2);
    expect(lineFor(d, 'TRAY_600D_48')).toHaveLength(0);
    // 2 × ($20.75 + $26.402175) = $94.30
    expect(totalOf(d, 'ADD_TRAY') + totalOf(d, 'TRAY_72_600D')).toBeCloseTo(94.30, 2);
  });
});

describe('emergency / LOR jobs bill the same units as capital', () => {
  // Austin, 8/18: "an LOR is not hourly-only." It bills every setup, re-enter,
  // splice, tray, case and extra, exactly like capital. What is different is the
  // hours: unit 223 covers travel and downtime, and on-site WORKING time never
  // bills hourly on either job type — the units cover it. This test used to
  // assert the opposite and has been failing on main since that rule landed.
  it('units bill, and the lead-tech hours do NOT bill on top of them', () => {
    const job: JobInput = {
      bmNumber: '26-298', billingMode: 'emergency',
      visits: [
        { id: 'v1', date: '2026-07-03', leadHours: 7, techs: ['Armando'],
          locations: [loc({ id: 'a', structureType: 'mh', spliceType: 'single', spliceCount: 24 })] },
      ],
    };
    const d = computeInvoice(job);
    expect(lineFor(d, 'FUSION_13_24')).toHaveLength(1);
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(1);
    // the only hours are the travel: 2 hr for the one man who rolled out.
    // 7 hours of working time buys nothing extra.
    expect(lineFor(d, 'SPLICER_FIBER')).toHaveLength(1);
    expect(lineFor(d, 'SPLICER_FIBER')[0].quantity).toBe(2);
  });

  it('materials still bill on an emergency job', () => {
    const job: JobInput = {
      bmNumber: '26-298', billingMode: 'emergency',
      visits: [{ id: 'v1', date: '2026-07-03', leadHours: 4,
        locations: [loc({ id: 'a', structureType: 'mh',
          extraUnits: [{ code: 'DEWATERING', qty: 1, note: 'Pumped the hole' }] })] }],
    };
    const d = computeInvoice(job);
    expect(totalOf(d, 'DEWATERING')).toBeCloseTo(rate('DEWATERING'), 2);
  });
});

describe('multi-visit running record', () => {
  it('setups bill once per hole PER VISIT (two visits, same hole = 2 setups)', () => {
    const job: JobInput = {
      bmNumber: '26-408', billingMode: 'capital',
      visits: [
        { id: 'v1', date: '2026-05-22', locations: [loc({ id: 'a', holeKey: 'MH-1', spliceType: 'single', spliceCount: 48 })] },
        { id: 'v2', date: '2026-05-27', locations: [loc({ id: 'b', holeKey: 'MH-1', spliceType: 'single', spliceCount: 48 })] },
      ],
    };
    const d = computeInvoice(job);
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(2);
  });
});

describe('invoice totals', () => {
  it('subtotal equals the sum of line extendeds and total mirrors subtotal', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0042', caseAction: 'reenter',
            spliceType: 'single', spliceCount: 48, downtimeHours: 2 }),
    ]));
    const sum = d.lines.reduce((s, l) => s + l.extended, 0);
    expect(d.subtotal).toBeCloseTo(sum, 2);
    expect(d.total).toBe(d.subtotal);
    // sanity: setup 253 + reenter 60.62785 + 48×45.19485 (25-48 band) + 2×125 downtime
    expect(d.total).toBeCloseTo(253 + 60.62785 + 2169.35 + 250, 1);
  });

  it('every line records a source (audit trail)', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0042', spliceType: 'single', spliceCount: 12 }),
    ]));
    expect(d.lines.every(l => l.source && l.source.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('maintenance window adder (scheduled night work)', () => {
  it('single fusion: adder rides at the same billed count', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0001', spliceType: 'single', spliceCount: 48 }),
    ], { maintWindow: true }));
    expect(lineFor(d, 'FUSION_MAINT_ADDER')).toHaveLength(1);
    expect(lineFor(d, 'FUSION_MAINT_ADDER')[0].quantity).toBe(48);
    expect(totalOf(d, 'FUSION_MAINT_ADDER')).toBe(48 * 6.5);
  });

  it('adder follows the 6-fiber minimum, same as the splice line', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0001', spliceType: 'single', spliceCount: 2 }),
    ], { maintWindow: true }));
    expect(lineFor(d, 'FUSION_MAINT_ADDER')[0].quantity).toBe(6);
  });

  it('ribbon work gets the ribbon adder, not the fusion one', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0001', spliceType: 'ribbon', spliceCount: 4 }),
    ], { maintWindow: true }));
    expect(lineFor(d, 'RIBBON_MAINT_ADDER')[0].quantity).toBe(4);
    expect(totalOf(d, 'RIBBON_MAINT_ADDER')).toBe(96);
    expect(lineFor(d, 'FUSION_MAINT_ADDER')).toHaveLength(0);
  });

  it('no adder when the flag is off', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0001', spliceType: 'single', spliceCount: 48 }),
    ]));
    expect(lineFor(d, 'FUSION_MAINT_ADDER')).toHaveLength(0);
  });

  it('EMERGENCY/LOR never gets the adder, even flagged and worked at night', () => {
    const d = computeInvoice({
      bmNumber: '26-349', billingMode: 'emergency', maintWindow: true,
      visits: [{ id: 'v1', date: '2026-05-22', techs: ['Armando'], locations: [
        loc({ id: 'a', closureCode: 'Lumen-0001', spliceType: 'single', spliceCount: 48 }),
      ] }],
    });
    expect(lineFor(d, 'FUSION_MAINT_ADDER')).toHaveLength(0);
    expect(lineFor(d, 'RIBBON_MAINT_ADDER')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('testing cannot be billed when the job involved splicing', () => {
  it('CD/PMD adder drops out when the job has any splicing', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', structureType: 'building', closureCode: 'Lumen-0001',
            spliceType: 'single', spliceCount: 12, testFiberCount: 24, testType: 'otdr',
            extraUnits: [{ code: 'TEST_CD_PMD', qty: 6 }] }),
    ]));
    expect(lineFor(d, 'TEST_CD_PMD')).toHaveLength(0);
    expect(d.lines.filter(l => l.unitCode.startsWith('TEST_OTDR'))).toHaveLength(0);
  });

  it('test-only job bills both the test and the CD/PMD adder', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', structureType: 'building', closureCode: 'Lumen-0001',
            testFiberCount: 24, testType: 'otdr',
            extraUnits: [{ code: 'TEST_CD_PMD', qty: 6 }] }),
    ]));
    expect(totalOf(d, 'TEST_CD_PMD')).toBe(1800);
    expect(d.lines.filter(l => l.unitCode.startsWith('TEST_OTDR'))).toHaveLength(1);
  });

  it('LOR with splicing also drops the CD/PMD adder', () => {
    const d = computeInvoice({
      bmNumber: '26-349', billingMode: 'emergency',
      visits: [{ id: 'v1', date: '2026-05-22', leadHours: 6, locations: [
        loc({ id: 'a', structureType: 'building', closureCode: 'Lumen-0001',
              spliceType: 'single', spliceCount: 12,
              extraUnits: [{ code: 'TEST_CD_PMD', qty: 6 }] }),
      ] }],
    });
    expect(lineFor(d, 'TEST_CD_PMD')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Emergency/LOR bills every unit the crew earned, SAME as capital. Unit 223
// SPLICER - FIBER covers travel (1 hr out + 1 hr back, per tech, per trip) and
// any downtime. On-site working time does not bill hourly.
describe('emergency / LOR billing', () => {
  const lorJob = (over: Partial<JobInput> = {}, techs = ['Armando', 'Sal']): JobInput => ({
    bmNumber: '26-349', billingMode: 'emergency',
    visits: [{ id: 'v1', date: '2026-08-17', techs, leadHours: 9, locations: [
      loc({ id: 'a', structureType: 'mh', closureCode: 'Lumen-0050', caseAction: 'reenter',
            spliceType: 'single', spliceCount: 48, downtimeHours: 2 }),
    ] }],
    ...over,
  });

  it('bills the units, not just hours', () => {
    const d = computeInvoice(lorJob());
    expect(totalOf(d, 'SETUP_MH')).toBe(253);
    expect(lineFor(d, 'REENTER')).toHaveLength(1);
    expect(lineFor(d, 'FUSION_25_48')[0].quantity).toBe(48);
  });

  it('travel = 2 hr per tech per trip, downtime = hours x techs, all under unit 223', () => {
    const d = computeInvoice(lorJob());
    // 2 techs x 2 hr travel = 4 hr; 2 hr downtime x 2 techs = 4 hr; 8 hr x $125
    expect(totalOf(d, 'SPLICER_FIBER')).toBe(1000);
  });

  it("downtime bills PER TECH standing on it — Austin's 26-349 numbers", () => {
    // 5 techs, one night, 3 hr downtime, rolled out:
    // drive 5 x 2 = 10 hr, downtime 3 x 5 = 15 hr, total 25 hr
    const d = computeInvoice({
      bmNumber: '26-349', billingMode: 'emergency',
      visits: [{ id: 'v1', date: '2026-08-17',
        techs: ['Armando', 'Sal', 'T3', 'T4', 'T5'], locations: [
          loc({ id: 'a', closureCode: 'Lumen-0050', caseAction: 'reenter',
                spliceType: 'single', spliceCount: 48, downtimeHours: 3 }),
        ] }],
    });
    const hours = lineFor(d, 'SPLICER_FIBER').reduce((s, l) => s + l.quantity, 0);
    expect(hours).toBe(25);
    expect(totalOf(d, 'SPLICER_FIBER')).toBe(3125);
  });

  it('capital downtime is ALSO multiplied by the crew', () => {
    // 2 hr with 3 techs = 6 billable hours = $750
    const d = computeInvoice({
      bmNumber: '26-500', billingMode: 'capital',
      visits: [{ id: 'v1', date: '2026-08-18', techs: ['A', 'B', 'C'], locations: [
        loc({ id: 'a', closureCode: 'Lumen-0050', spliceType: 'single', spliceCount: 12, downtimeHours: 2 }),
      ] }],
    });
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(6);
    expect(totalOf(d, 'DOWNTIME_CAPITAL')).toBe(750);
  });

  it('downtime counts per visit, against that night\'s crew', () => {
    const d = computeInvoice({
      bmNumber: '26-501', billingMode: 'capital',
      visits: [
        { id: 'v1', date: '2026-08-17', techs: ['A', 'B', 'C'], locations: [loc({ id: 'a', downtimeHours: 2 })] },
        { id: 'v2', date: '2026-08-18', techs: ['A'], locations: [loc({ id: 'b', downtimeHours: 1 })] },
      ],
    });
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(7);   // 2x3 + 1x1
  });

  // Travel is 2 hr a man for the CUT, not for every report filed. Austin, 8/28,
  // on 26-352's two 8/21 reports: "8/21 was not another trip it was an added
  // location." This test used to expect 12 hours (3 reports × 2 techs × 2 hr),
  // which billed two drive-outs that never happened.
  it('three reports, same two men, one cut = 4 travel hours', () => {
    const d = computeInvoice({
      bmNumber: '26-349', billingMode: 'emergency',
      visits: [1, 2, 3].map(i => ({
        id: `v${i}`, date: `2026-08-1${i}`, techs: ['Armando', 'Sal'],
        locations: [loc({ id: `a${i}`, closureCode: `Lumen-005${i}`, techs: ['Armando', 'Sal'],
                         spliceType: 'single', spliceCount: 12 })],
      })),
    });
    expect(lineFor(d, 'SPLICER_FIBER')[0].quantity).toBe(4);
  });

  it('a fourth man who only showed up on the last night still earns his 2 hours', () => {
    const d = computeInvoice({
      bmNumber: '26-350', billingMode: 'emergency',
      visits: [
        { id: 'v1', date: '2026-08-11', techs: ['Armando', 'Sal'],
          locations: [loc({ id: 'a', techs: ['Armando', 'Sal'], spliceType: 'single', spliceCount: 12 })] },
        { id: 'v2', date: '2026-08-12', techs: ['Armando', 'Jesus'],
          locations: [loc({ id: 'b', techs: ['Armando', 'Jesus'], spliceType: 'single', spliceCount: 12 })] },
      ],
    });
    // three distinct men on the cut — Armando does not earn it twice
    expect(lineFor(d, 'SPLICER_FIBER')[0].quantity).toBe(6);
  });

  it('on-site hours do NOT bill on top of the units', () => {
    const withHours = computeInvoice(lorJob());
    const noHours = computeInvoice(lorJob({
      visits: [{ id: 'v1', date: '2026-08-17', techs: ['Armando', 'Sal'], locations: [
        loc({ id: 'a', structureType: 'mh', closureCode: 'Lumen-0050', caseAction: 'reenter',
              spliceType: 'single', spliceCount: 48, downtimeHours: 2 }),
      ] }],
    }));
    expect(withHours.total).toBe(noHours.total);
  });

  it('a visit with no techs listed still bills one tech', () => {
    const d = computeInvoice(lorJob({}, []));
    // 1 tech x 2 hr travel + 2 hr downtime x 1 tech = 4 hr
    expect(totalOf(d, 'SPLICER_FIBER')).toBe(500);
  });

  it('scheduled-ahead LOR drops the drive time but keeps downtime', () => {
    const rolled = computeInvoice(lorJob());
    const sched = computeInvoice(lorJob({ scheduledAhead: true }));
    expect(totalOf(sched, 'SPLICER_FIBER')).toBe(500);   // downtime only: 2 hr x 2 techs
    expect(rolled.total - sched.total).toBe(500);        // the 4 travel hours
  });

  it('scheduled-ahead LOR with no downtime has no unit 223 at all', () => {
    const d = computeInvoice({
      bmNumber: '26-360', billingMode: 'emergency', scheduledAhead: true,
      visits: [{ id: 'v1', date: '2026-08-17', techs: ['Armando'], locations: [
        loc({ id: 'a', closureCode: 'Lumen-0090', caseAction: 'reenter', spliceType: 'single', spliceCount: 12 }),
      ] }],
    });
    expect(lineFor(d, 'SPLICER_FIBER')).toHaveLength(0);
  });

  it('unit 76 and unit 223 never mix', () => {
    const lor = computeInvoice(lorJob());
    expect(lineFor(lor, 'DOWNTIME_CAPITAL')).toHaveLength(0);
    const cap = computeInvoice({ ...lorJob(), bmNumber: '26-500', billingMode: 'capital' });
    expect(lineFor(cap, 'SPLICER_FIBER')).toHaveLength(0);
    expect(totalOf(cap, 'DOWNTIME_CAPITAL')).toBe(500);   // 2 hr x 2 techs
  });
});

// ---------------------------------------------------------------------------
describe('trays', () => {
  it('every tray bills unit 1 labor + unit 173 material, whatever the enclosure', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', closureCode: 'Lumen-0001', traysAdded: 2,
            enclosureModel: '450B', trayMaterialCode: 'TRAY_450B_24' } as any),
    ]));
    expect(totalOf(d, 'ADD_TRAY')).toBe(41.5);          // 2 x $20.75
    expect(totalOf(d, 'TRAY_72_600D')).toBe(52.8);      // 2 x $26.402175
    // the old guessed material rows must not appear
    expect(lineFor(d, 'TRAY_450B_24')).toHaveLength(0);
    expect(lineFor(d, 'TRAY_600D_48')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The crew belongs to the HOLE (8/28/26)
//
// 26-352, night of 8/21: Armando and Spencer were in Lumen-0016 while Jesus and
// Josh L were in Lumen-0017. Downtime bills per tech. Multiplying every hole by
// the whole visit crew billed 7.5 standby hours against four men when two were
// standing there.
// ---------------------------------------------------------------------------
describe('downtime bills against the men in that hole', () => {
  it('4 hrs with 2 techs = 8 tech-hours', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', techs: ['Armando', 'Spencer'], downtimeHours: 4 }),
    ]));
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(8);
    expect(totalOf(d, 'DOWNTIME_CAPITAL')).toBe(1000);   // 8 × $125
  });

  it('two crews splitting one night bill their OWN holes, not each others', () => {
    const d = computeInvoice({
      bmNumber: '26-352', billingMode: 'capital',
      visits: [{
        id: 'v1', date: '2026-08-21', techs: ['Armando', 'Spencer', 'Jesus', 'Josh L'],
        locations: [
          loc({ id: 'l16', closureCode: 'Lumen-0016', techs: ['Armando', 'Spencer'],
                downtimeHours: 7.5 }),
          loc({ id: 'l17', closureCode: 'Lumen-0017', techs: ['Jesus', 'Josh L'],
                downtimeHours: 0 }),
        ],
      }],
    });
    // 7.5 × the TWO men in that hole = 15. Billing it against all four gives 30.
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(15);
  });

  it('a location with no crew of its own falls back to the visit (pre-8/28 rows)', () => {
    const d = computeInvoice({
      bmNumber: '26-300', billingMode: 'capital',
      visits: [{
        id: 'v1', date: '2026-08-01', techs: ['Armando', 'Sal'],
        locations: [loc({ id: 'a', downtimeHours: 3 })],
      }],
    });
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(6);
  });

  it('nobody named still counts as one man, never zero', () => {
    const d = computeInvoice(capitalJob([loc({ id: 'a', downtimeHours: 4 })]));
    expect(lineFor(d, 'DOWNTIME_CAPITAL')[0].quantity).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 26-352 itself — the job that found all of this. The hours the draft must show.
// ---------------------------------------------------------------------------
describe('26-352 regression — the LOR that billed half a crew', () => {
  const job352 = (): JobInput => ({
    bmNumber: '26-352', billingMode: 'emergency',
    visits: [
      // 8/20 — found the damage, then waited on construction
      { id: 'v1', date: '2026-08-20', techs: ['Armando', 'Josh L'],
        locations: [loc({ id: 'entry', structureType: 'mh', caseAction: 'reenter',
                          techs: ['Armando', 'Josh L'], downtimeHours: 7.5 })] },
      // 8/21 — the DWDM find; Lumen-0018 midsheath
      { id: 'v2', date: '2026-08-21', techs: ['Armando', 'Spencer'],
        locations: [loc({ id: 'l18', closureCode: 'Lumen-0018', caseAction: 'midsheath',
                          techs: ['Armando', 'Spencer'], spliceType: 'ribbon', spliceCount: 6,
                          traysAdded: 1, downtimeHours: 1.5 })] },
      // 8/21 — the added locations, two crews split between two holes
      { id: 'v3', date: '2026-08-21', techs: ['Armando', 'Spencer', 'Jesus', 'Josh L'],
        locations: [
          loc({ id: 'l16', closureCode: 'Lumen-0016', caseAction: 'new_case',
                newCaseMaterialCode: 'CASE_UG_D_1130', techs: ['Armando', 'Spencer'],
                spliceType: 'single', spliceCount: 156, traysAdded: 3, downtimeHours: 7.5 }),
          loc({ id: 'l17', closureCode: 'Lumen-0017', caseAction: 'new_case',
                newCaseMaterialCode: 'CASE_UG_D_1130', techs: ['Jesus', 'Josh L'],
                spliceType: 'single', spliceCount: 156, traysAdded: 4 }),
        ] },
    ],
  });

  it('downtime = 33 tech-hours (15 + 3 + 15), not 18', () => {
    const d = computeInvoice(job352());
    const downtime = lineFor(d, 'SPLICER_FIBER').find(l => l.source.startsWith('Downtime'));
    expect(downtime!.quantity).toBe(33);
    expect(downtime!.extended).toBe(4125);           // 33 × $125
  });

  it('travel = 8 hours — 2 hr each for four men on one cut, not per report', () => {
    const d = computeInvoice(job352());
    const travel = lineFor(d, 'SPLICER_FIBER').find(l => l.source.startsWith('Travel'));
    expect(travel!.quantity).toBe(8);
    expect(travel!.extended).toBe(1000);
  });

  it('unit 223 comes to 41 hours / $5,125 across the two lines', () => {
    const d = computeInvoice(job352());
    expect(totalOf(d, 'SPLICER_FIBER')).toBe(5125);
  });

  it('the units still bill — an LOR is not hourly-only', () => {
    const d = computeInvoice(job352());
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(4);          // one per hole per visit
    expect(lineFor(d, 'FUSION_145_288')).toHaveLength(2);    // 156 splices, twice
    expect(lineFor(d, 'CASE_NEW')).toHaveLength(2);
    expect(lineFor(d, 'PREP_MIDSHEATH')).toHaveLength(1);
    expect(totalOf(d, 'ADD_TRAY')).toBeCloseTo(8 * 20.75, 2); // 1 + 3 + 4 trays
  });

  it('scheduled-ahead kills the travel but never the downtime', () => {
    const d = computeInvoice({ ...job352(), scheduledAhead: true });
    const travel = lineFor(d, 'SPLICER_FIBER').find(l => l.source.startsWith('Travel'));
    const downtime = lineFor(d, 'SPLICER_FIBER').find(l => l.source.startsWith('Downtime'));
    expect(travel).toBe(undefined);
    expect(downtime!.quantity).toBe(33);
  });
});
