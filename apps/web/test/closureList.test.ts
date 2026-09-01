/**
 * The line each closure gets in the pick-from-the-list dropdown.
 *
 * Small, but worth testing: it is what a man reads on a phone at 2am to decide
 * which of 38 closures he is standing in, and the fields it joins are null far
 * more often than anyone expects — two closures in the live registry have no
 * GPS at all, and most have no building address.
 *
 * Run: npx tsx apps/web/test/closureList.test.ts
 */
import { closureOptionLabel, type ClosureListItem } from '../src/lib/closureLabel';

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
      if (actual !== want) throw new Error(`got ${JSON.stringify(actual)}, wanted ${JSON.stringify(want)}`);
    },
  };
}

const c = (o: Partial<ClosureListItem>): ClosureListItem => ({
  id: 'x', closure_code: 'Lumen-0003', structure_type: 'hh',
  structure_owner: null, building_address: null, enclosure_model: null,
  gps_lat: 33.1, gps_lng: -97.1, hasGps: true, ...o,
} as ClosureListItem);

describe('the dropdown line', () => {
  it('leads with the code — that is what he is looking for', () => {
    expect(closureOptionLabel(c({}))).toEqual('Lumen-0003 · Handhole');
  });

  it('spells the structure out, not the database code', () => {
    expect(closureOptionLabel(c({ structure_type: 'mh' }))).toEqual('Lumen-0003 · Manhole');
  });

  it('adds the owner tag when there is one', () => {
    expect(closureOptionLabel(c({ structure_owner: 'Unmarked' })))
      .toEqual('Lumen-0003 · Handhole · Unmarked');
  });

  it('adds a building address', () => {
    expect(closureOptionLabel(c({ structure_type: 'building', building_address: '1950 Stemmons' })))
      .toEqual('Lumen-0003 · Building · 1950 Stemmons');
  });

  it('says so when there is no GPS — two in the live registry have none', () => {
    // A closure with no GPS is legitimate; it just cannot be found by standing
    // next to it, which is exactly why this list exists.
    expect(closureOptionLabel(c({ hasGps: false })))
      .toEqual('Lumen-0003 · Handhole · no GPS');
  });

  it('never says "no GPS" when it has some', () => {
    expect(closureOptionLabel(c({ hasGps: true }))).toEqual('Lumen-0003 · Handhole');
  });

  it('survives a closure with almost nothing on it', () => {
    expect(closureOptionLabel(c({ structure_type: null, hasGps: false })))
      .toEqual('Lumen-0003 · no GPS');
  });

  it('an Oncor code reads the same way', () => {
    expect(closureOptionLabel(c({ closure_code: 'Oncor-0001', structure_type: 'mh' })))
      .toEqual('Oncor-0001 · Manhole');
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
