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
  it('2 trays → ADD_TRAY ×2 + tray material ×2', () => {
    const d = computeInvoice(capitalJob([
      loc({ id: 'a', spliceType: 'single', spliceCount: 6,
            traysAdded: 2, trayMaterialCode: 'TRAY_600D_48' }),
    ]));
    expect(lineFor(d, 'ADD_TRAY')[0].quantity).toBe(2);
    expect(lineFor(d, 'TRAY_600D_48')[0].quantity).toBe(2);
  });
});

describe('emergency / LOR jobs bill hourly', () => {
  it('SPLICER_FIBER × hours, and NO per-unit splice lines', () => {
    const job: JobInput = {
      bmNumber: '26-298', billingMode: 'emergency',
      visits: [
        { id: 'v1', date: '2026-07-03', leadHours: 7,
          locations: [loc({ id: 'a', structureType: 'mh', spliceType: 'single', spliceCount: 24 })] },
      ],
    };
    const d = computeInvoice(job);
    const l = lineFor(d, 'SPLICER_FIBER')[0];
    expect(l.quantity).toBe(7);
    expect(l.extended).toBe(875);                 // 7 × 125
    expect(lineFor(d, 'FUSION_13_24')).toHaveLength(0);
    expect(lineFor(d, 'SETUP_MH')).toHaveLength(0);
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
      visits: [{ id: 'v1', date: '2026-05-22', leadHours: 6, locations: [
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
