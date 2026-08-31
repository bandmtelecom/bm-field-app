/**
 * The numbers the form shows a tech, and the title everything else prints.
 *
 * These are unit tests because reading the code was not enough last time:
 * `.20 km` parsing as 20 instead of 0.2 survived a careful read and died in the
 * first test run. The same arithmetic exists twice on purpose — here for the
 * preview and in the trigger in migration 0012 for the real thing — so both
 * sides get tested, and the SQL side has its own suite.
 *
 * Run: npx tsx apps/web/test/numbering.test.ts
 */
import { previewNumbers, nextJobLocationNo, type PriorLocation } from '../src/lib/locationNo';
import { locationTitle } from '../src/lib/types';

// ---- the smallest shim that runs describe/it/expect -----------------------
// vitest cannot run here: the npm registry is blocked in the container.
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

const hole = (n: number, id = `h${n}`): PriorLocation => ({
  id, job_location_no: n, pm_location_no: null, closure_id: null, closure_code: null,
  structure_type: 'hh', structure_owner: null, gps_lat: null, gps_lng: null,
  visit_date: '2026-08-17', cables: [],
});

describe('the number a block will get', () => {
  it('a job with nothing on it yet starts at 1', () => {
    expect(previewNumbers([], [{ revisit_of: null }])).toEqual([1]);
  });

  it('four crews, four new holes — 1, 2, 3, 4 and never two 1s', () => {
    expect(previewNumbers([], [
      { revisit_of: null }, { revisit_of: null }, { revisit_of: null }, { revisit_of: null },
    ])).toEqual([1, 2, 3, 4]);
  });

  it('carries on from what is already on the job', () => {
    expect(previewNumbers([hole(1), hole(2)], [{ revisit_of: null }])).toEqual([3]);
  });

  it('a return trip reuses that hole’s number', () => {
    expect(previewNumbers([hole(1), hole(2)], [{ revisit_of: 'h2' }])).toEqual([2]);
  });

  it('a return trip consumes nothing — the next new hole is still 3', () => {
    expect(previewNumbers([hole(1), hole(2)], [
      { revisit_of: 'h2' }, { revisit_of: null },
    ])).toEqual([2, 3]);
  });

  it('two return trips to the same hole both show that number', () => {
    expect(previewNumbers([hole(1), hole(2)], [
      { revisit_of: 'h2' }, { revisit_of: 'h2' }, { revisit_of: null },
    ])).toEqual([2, 2, 3]);
  });

  it('a hole that is not in the list shows nothing rather than a wrong number', () => {
    expect(previewNumbers([hole(1)], [{ revisit_of: 'gone' }])).toEqual([null]);
  });

  it('legacy rows with no number do not push the count', () => {
    const legacy = { ...hole(0, 'old'), job_location_no: null };
    expect(nextJobLocationNo([legacy, hole(2)])).toEqual(3);
  });
});

describe('what a location is called on screen', () => {
  it('uses B&M’s job-wide number', () => {
    expect(locationTitle({ job_location_no: 3 })).toEqual('Location 3');
  });

  it('says so when it is a return trip', () => {
    expect(locationTitle({ job_location_no: 2, revisit_of: 'h2' })).toEqual('Location 2 · revisit');
  });

  it('the customer’s own number never becomes the heading on its own', () => {
    expect(locationTitle({ job_location_no: 4, pm_location_no: '1' })).toEqual('Location 4');
  });

  it('falls back to the typed number on rows filed before the migration', () => {
    expect(locationTitle({ job_location_no: null, pm_location_no: '7' })).toEqual('Location 7');
  });

  it('an unnumbered legacy row shows a gap, not a confident wrong number', () => {
    expect(locationTitle({ job_location_no: null, pm_location_no: null })).toEqual('Location ?');
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
