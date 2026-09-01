/**
 * The location number the form shows a tech, and the title everything prints.
 *
 * There is ONE number and it lives in the tech's box. The same arithmetic exists
 * twice on purpose — here for the preview and in the trigger in migration 0013
 * for the real thing — so both sides get tested, and the SQL side has its own
 * suite.
 *
 * Run: npx tsx apps/web/test/numbering.test.ts
 */
import {
  previewPmNumbers, highestNumber, isSequenceNumber, type PriorLocation,
} from '../src/lib/locationNo';
import { locationTitle } from '../src/lib/types';

// ---- the smallest shim that runs describe/it/expect -----------------------
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

const hole = (pm: string | null, id = `h${pm}`): PriorLocation => ({
  id, job_location_no: null, pm_location_no: pm, closure_id: null, closure_code: null,
  structure_type: 'hh', structure_owner: null, building_address: null,
  gps_lat: null, gps_lng: null, visit_date: '2026-09-01', cables: [],
});
const blank = { pm_location_no: '', revisit_of: null };
const typed = (v: string) => ({ pm_location_no: v, revisit_of: null });

describe('a number in the box, or a name', () => {
  it('a plain number is a place in a sequence', () => {
    expect(isSequenceNumber('5')).toEqual(true);
  });
  it('spaces around it do not change that', () => {
    expect(isSequenceNumber('  4 ')).toEqual(true);
  });
  it('an address is a name — 26-354 calls all four locations 1950 Stemmons', () => {
    expect(isSequenceNumber('1950 Stemmons')).toEqual(false);
  });
  it('"1a" is a name — 26-364 uses 1a, 1b, 2a, 2b', () => {
    expect(isSequenceNumber('1a')).toEqual(false);
  });
  it('empty is not a number', () => {
    expect(isSequenceNumber('')).toEqual(false);
  });

  it('names never push the count', () => {
    expect(highestNumber(['1950 Stemmons', 'West', 'Wayne ILA'])).toEqual(0);
  });
  it('the highest plain number wins, whatever the order', () => {
    expect(highestNumber(['3', '11', '7'])).toEqual(11);
  });
});

describe('the number a block will get', () => {
  it('what the tech typed always stands', () => {
    expect(previewPmNumbers([], [typed('5')])).toEqual(['5']);
  });

  it('a job with nothing on it yet starts at 1', () => {
    expect(previewPmNumbers([], [blank])).toEqual(['1']);
  });

  it('a blank carries on from what is already on the job', () => {
    expect(previewPmNumbers([hole('1'), hole('2')], [blank])).toEqual(['3']);
  });

  it('a blank counts past a number typed above it', () => {
    expect(previewPmNumbers([], [typed('5'), blank])).toEqual(['5', '6']);
  });

  it('and past one typed BELOW it', () => {
    // Otherwise the first blank hands out a 6 that is already spoken for.
    expect(previewPmNumbers([], [blank, typed('6')])).toEqual(['7', '6']);
  });

  it('two blanks in one report do not collide', () => {
    expect(previewPmNumbers([hole('2')], [blank, blank])).toEqual(['3', '4']);
  });

  it('a name on the job does not push the count', () => {
    expect(previewPmNumbers([hole('1950 Stemmons')], [blank])).toEqual(['1']);
  });

  it('a name alongside a number counts only the number', () => {
    expect(previewPmNumbers([hole('1950 Stemmons'), hole('4')], [blank])).toEqual(['5']);
  });

  it('a return trip reads as that hole again', () => {
    expect(previewPmNumbers(
      [hole('5', 'x')], [{ pm_location_no: '', revisit_of: 'x' }],
    )).toEqual(['5']);
  });

  it('a return trip consumes nothing — the next new hole is still 6', () => {
    expect(previewPmNumbers(
      [hole('5', 'x')], [{ pm_location_no: '', revisit_of: 'x' }, blank],
    )).toEqual(['5', '6']);
  });

  it('a number the tech typed beats the hole he is returning to', () => {
    expect(previewPmNumbers(
      [hole('5', 'x')], [{ pm_location_no: '5A', revisit_of: 'x' }],
    )).toEqual(['5A']);
  });

  it('returning to a hole with no number falls through to the next one', () => {
    expect(previewPmNumbers(
      [hole(null, 'x'), hole('3')], [{ pm_location_no: '', revisit_of: 'x' }],
    )).toEqual(['4']);
  });
});

describe('what a location is called', () => {
  it('a plain number gets the word in front', () => {
    expect(locationTitle({ pm_location_no: '5' })).toEqual('Location 5');
  });

  it('a name stands on its own — never "Location 1950 Stemmons"', () => {
    expect(locationTitle({ pm_location_no: '1950 Stemmons' })).toEqual('1950 Stemmons');
  });

  it('says so when it is a return trip', () => {
    expect(locationTitle({ pm_location_no: '2', revisit_of: 'x' }))
      .toEqual('Location 2 · revisit');
  });

  it('the old internal number only stands in when the box is empty', () => {
    expect(locationTitle({ pm_location_no: '', job_location_no: 3 })).toEqual('Location 3');
  });

  it('the tech\'s number wins over the internal one', () => {
    expect(locationTitle({ pm_location_no: '5', job_location_no: 3 })).toEqual('Location 5');
  });

  it('with nothing at all it still reads as something', () => {
    expect(locationTitle({})).toEqual('Location');
  });
});

describe('the address rides the same line', () => {
  it('number then the place — 26-354 worked 1950 Stemmons four times', () => {
    expect(locationTitle({ pm_location_no: '2', building_address: '1950 Stemmons' }))
      .toEqual('Location 2 · 1950 Stemmons');
  });

  it('a hole has no address and reads clean', () => {
    expect(locationTitle({ pm_location_no: '2', building_address: null }))
      .toEqual('Location 2');
  });

  it('an empty address box adds nothing', () => {
    expect(locationTitle({ pm_location_no: '2', building_address: '   ' }))
      .toEqual('Location 2');
  });

  it('a return trip to a building says all three', () => {
    expect(locationTitle({
      pm_location_no: '2', building_address: '1950 Stemmons', revisit_of: 'x',
    })).toEqual('Location 2 · 1950 Stemmons · revisit');
  });

  it('the number still comes first when the box holds a name', () => {
    // A legacy row where the tech typed the address into the number box.
    expect(locationTitle({
      pm_location_no: '1950 Stemmons', building_address: '1950 Stemmons',
    })).toEqual('1950 Stemmons · 1950 Stemmons');
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
