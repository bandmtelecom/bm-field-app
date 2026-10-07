/**
 * OPGW form logic (0015) — coordinates, labels, what saves.
 *
 * Run: npx tsx apps/web/test/opgw.test.ts
 */
import {
  parseCoord, parseCoordPair, looksEastern, spliceTypeLabel, cableCountLabel,
  customerLabel, emptyOpgwForm, formProblems, rowFromForm, formFromPoint, pointSummary,
} from '../src/lib/opgw';
import { splitNames } from '../src/lib/num';

// ---- the same 20-line shim the billing suite uses -------------------------
let failures = 0;
let passes = 0;
function describe(name: string, fn: () => void) { console.log(`\n${name}`); fn(); }
function it(name: string, fn: () => void) {
  try { fn(); passes++; console.log(`  ok   ${name}`); }
  catch (e: any) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function expect(actual: any) {
  return {
    toEqual(want: any) {
      const a = JSON.stringify(actual); const b = JSON.stringify(want);
      if (a !== b) throw new Error(`got ${a}, wanted ${b}`);
    },
  };
}

describe('reading a coordinate the way a tech types it', () => {
  it('plain decimal, as the Grab button writes it', () => {
    expect(parseCoord('32.3992940')).toEqual(32.399294);
    expect(parseCoord('-96.5792710')).toEqual(-96.579271);
  });
  it("A.J.'s 18/9 on 25-497: 32°15'42\"N 96°21'30\"W", () => {
    expect(parseCoord('32°15\'42"N')).toEqual(32.261667);
    expect(parseCoord('96°21\'30"W')).toEqual(-96.358333);
  });
  it('degrees minutes seconds with spaces', () => {
    expect(parseCoord('32 15 42 N')).toEqual(32.261667);
  });
  it('degrees and decimal minutes', () => {
    expect(parseCoord('96 21.5 W')).toEqual(-96.358333);
  });
  it('empty is null, words are undefined', () => {
    expect(parseCoord('')).toEqual(null);
    expect(parseCoord('see notes')).toEqual(undefined);
  });
  it('a whole pair in one box is not taken as one coordinate', () => {
    expect(parseCoord('32.3992940, -96.5792710')).toEqual(undefined);
  });
  it('minutes of 60 or more is a typo, not a coordinate', () => {
    expect(parseCoord('32 75 10 N')).toEqual(undefined);
  });
});

describe('a pasted pair lands in both boxes', () => {
  it('decimal with a comma', () => {
    expect(parseCoordPair('32.3992940, -96.5792710')).toEqual({ lat: 32.399294, lng: -96.579271 });
  });
  it('decimal with a space', () => {
    expect(parseCoordPair('32.3992940 -96.5792710')).toEqual({ lat: 32.399294, lng: -96.579271 });
  });
  it('degrees-minutes-seconds pair', () => {
    expect(parseCoordPair('32°15\'42"N 96°21\'30"W')).toEqual({ lat: 32.261667, lng: -96.358333 });
  });
  it('a single number is not a pair', () => {
    expect(parseCoordPair('32.39')).toEqual(null);
  });
});

describe('the dropped minus sign', () => {
  it('positive longitude is flagged', () => { expect(looksEastern('96.57')).toEqual(true); });
  it('negative is fine', () => { expect(looksEastern('-96.57')).toEqual(false); });
  it('W makes it negative, so not flagged', () => { expect(looksEastern('96 21 30 W')).toEqual(false); });
});

describe('labels', () => {
  it('2-way reads as 2-way', () => {
    expect(spliceTypeLabel({ splice_type: '2way', splice_type_other: null })).toEqual('2-way');
  });
  it('Other reads as what they typed', () => {
    expect(spliceTypeLabel({ splice_type: 'other', splice_type_other: ' Splice-in-place ' })).toEqual('Splice-in-place');
  });
  it('cable count Other reads as what they typed', () => {
    expect(cableCountLabel({ cable_count: 'other', cable_count_other: '288' })).toEqual('288');
  });
  it('customer Other shows the typed name', () => {
    expect(customerLabel('Other', 'Quanta')).toEqual('Quanta');
    expect(customerLabel('Primoris', null)).toEqual('Primoris');
    expect(customerLabel('Other', '  ')).toEqual('Other');
  });
});

describe('a new splice', () => {
  it('starts on 2-way — "95% of the time"', () => {
    expect(emptyOpgwForm('2026-10-07').splice_type).toEqual('2way');
  });
  it('needs a structure number, a cable count and GPS', () => {
    expect(formProblems(emptyOpgwForm('2026-10-07'))).toEqual([
      'Put in the structure number.', 'Pick the cable count.', 'Grab the structure GPS.',
    ]);
  });
  it('Other with nothing typed is caught', () => {
    const f = { ...emptyOpgwForm('2026-10-07'), name: '34/9', splice_type: 'other' as const,
      cable_count: '48' as const, gps_lat: '32.39', gps_lng: '-96.57' };
    expect(formProblems(f)).toEqual(['Type what the splice is under Other.']);
  });
  it('half a ROW entrance is caught', () => {
    const f = { ...emptyOpgwForm('2026-10-07'), name: '34/9', cable_count: '48' as const,
      gps_lat: '32.39', gps_lng: '-96.57', row_lat: '32.40' };
    expect(formProblems(f)).toEqual(['The ROW entrance GPS needs both numbers.']);
  });
  it('a complete one saves clean', () => {
    const f = { ...emptyOpgwForm('2026-01-12', 'A.J. & Hunter'), name: ' Chrisp Switch ',
      cable_count: '48' as const, gps_lat: '32.3992940', gps_lng: '-96.5792710', notes: ' 2.4 km from the sub ' };
    expect(formProblems(f)).toEqual([]);
    expect(rowFromForm(f, splitNames)).toEqual({
      kind: 'splice', name: 'Chrisp Switch', tested_from: null,
      splice_type: '2way', splice_type_other: null, cable_count: '48', cable_count_other: null,
      gps_lat: 32.399294, gps_lng: -96.579271, row_lat: null, row_lng: null,
      notes: '2.4 km from the sub', techs: ['A.J.', 'Hunter'], work_date: '2026-01-12',
    });
  });
});

describe('a test point', () => {
  it('a hub with no GPS is allowed — Shankle sub had none in the email', () => {
    const f = { ...emptyOpgwForm('2026-01-14', '', 'test'), tested_from: 'hub' as const, name: 'Shankle sub' };
    expect(formProblems(f)).toEqual([]);
  });
  it('asks for the hub name when it is a hub', () => {
    const f = { ...emptyOpgwForm('2026-01-14', '', 'test'), tested_from: 'hub' as const };
    expect(formProblems(f)).toEqual(['Put in the hub name.']);
  });
  it('saves no splice fields, even if they were touched before switching', () => {
    const f = { ...emptyOpgwForm('2026-01-14', 'AJ', 'test'), name: '18/9', cable_count: '96' as const,
      row_lat: '32.1', row_lng: '-96.1', gps_lat: '32°15\'42"N', gps_lng: '96°21\'30"W' };
    const r = rowFromForm(f, splitNames);
    expect([r.splice_type, r.cable_count, r.row_lat, r.tested_from, r.gps_lat, r.gps_lng])
      .toEqual([null, null, null, 'structure', 32.261667, -96.358333]);
  });
  it('summary line', () => {
    expect(pointSummary({ kind: 'test', tested_from: 'hub' } as any)).toEqual('Test point · tested from a hub');
  });
});

describe('editing round-trips', () => {
  it('a stored point comes back into the form unchanged', () => {
    const p: any = { id: 'x', job_id: 'j', kind: 'splice', name: '33/6', tested_from: null,
      splice_type: '3way', splice_type_other: null, cable_count: '144', cable_count_other: null,
      gps_lat: '32.387353', gps_lng: '-96.560100', row_lat: null, row_lng: null, notes: null,
      techs: ['A.J.', 'Hunter'], work_date: '2026-01-13', ordinal: 4, created_by: null };
    const f = formFromPoint(p);
    expect([f.splice_type, f.cable_count, f.gps_lat, f.techs]).toEqual(['3way', '144', '32.387353', 'A.J., Hunter']);
    expect(pointSummary(p)).toEqual('3-way · 144 ct');
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
