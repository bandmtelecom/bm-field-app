/**
 * Offering a crew the cables that were in a hole last time.
 *
 * Run: npx tsx apps/web/test/cableSuggest.test.ts
 */
import {
  cableToForm, hasAnyCableContent, pickLatestWithCables, suggestionAge,
  type CableSource,
} from '../src/lib/cableSuggest';

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

const cable = (o: any = {}) => ({
  direction: null, count: null, manufacturer: null,
  date_code: null, footage: null, role: null, ...o,
});
const src = (o: Partial<CableSource> & { id: string }): CableSource => ({
  visitDate: null, createdAt: null, cables: [], ...o,
});

describe('turning a stored cable into a form row', () => {
  it('every field becomes a string, never null', () => {
    expect(cableToForm(cable({ direction: 'N', count: '312' }))).toEqual({
      direction: 'N', count: '312', manufacturer: '',
      date_code: '', footage: '', role: '',
    });
  });

  it('keeps date_code and role even though the form stopped showing them', () => {
    // Dropping them would quietly lose history off an old cable the moment
    // somebody accepted the offer.
    expect(cableToForm(cable({ date_code: '03-23', role: 'Tail' }))).toEqual({
      direction: '', count: '', manufacturer: '',
      date_code: '03-23', footage: '', role: 'Tail',
    });
  });

  it('trims what the techs typed', () => {
    expect(cableToForm(cable({ manufacturer: '  Corning ' })).manufacturer).toEqual('Corning');
  });

  it('a number footage survives the trip', () => {
    expect(cableToForm(cable({ footage: 15044 })).footage).toEqual('15044');
  });
});

describe('is there anything in the cable list already', () => {
  it('an empty list is empty', () => {
    expect(hasAnyCableContent([])).toEqual(false);
  });

  it('a blank row the form added does not count', () => {
    // Otherwise one tap on "+ Add" would hide the offer for good.
    expect(hasAnyCableContent([{
      direction: '', count: '', manufacturer: '', date_code: '', footage: '', role: '',
    }])).toEqual(false);
  });

  it('whitespace does not count', () => {
    expect(hasAnyCableContent([{
      direction: '  ', count: '', manufacturer: '', date_code: '', footage: '', role: '',
    }])).toEqual(false);
  });

  it('one real value counts', () => {
    expect(hasAnyCableContent([{
      direction: '', count: '144F', manufacturer: '', date_code: '', footage: '', role: '',
    }])).toEqual(true);
  });

  it('a value in a box the form no longer shows still counts', () => {
    expect(hasAnyCableContent([{
      direction: '', count: '', manufacturer: '', date_code: '03-23', footage: '', role: '',
    }])).toEqual(true);
  });
});

describe('which visit the cables come from', () => {
  it('nothing recorded anywhere means no offer', () => {
    expect(pickLatestWithCables([src({ id: 'a' })])).toEqual(null);
  });

  it('takes the newest visit', () => {
    expect(pickLatestWithCables([
      src({ id: 'old', visitDate: '2026-08-17', cables: [cable()] }),
      src({ id: 'new', visitDate: '2026-08-24', cables: [cable()] }),
    ])?.id).toEqual('new');
  });

  it('skips a hole that was opened but had no cables logged', () => {
    // A man opening a lid to look at what is in it must not wipe out what the
    // last man who spliced it wrote down.
    expect(pickLatestWithCables([
      src({ id: 'spliced', visitDate: '2026-08-17', cables: [cable()] }),
      src({ id: 'peeked',  visitDate: '2026-08-24', cables: [] }),
    ])?.id).toEqual('spliced');
  });

  it('two crews on one night are split by when the report was filed', () => {
    expect(pickLatestWithCables([
      src({ id: 'first',  visitDate: '2026-08-17', createdAt: '2026-08-17T01:00', cables: [cable()] }),
      src({ id: 'second', visitDate: '2026-08-17', createdAt: '2026-08-17T04:00', cables: [cable()] }),
    ])?.id).toEqual('second');
  });

  it('never offers a location its own cables back', () => {
    // This is the office Edit Location screen — without the exclusion it would
    // offer him what he is already looking at.
    expect(pickLatestWithCables([
      src({ id: 'me',    visitDate: '2026-08-24', cables: [cable()] }),
      src({ id: 'older', visitDate: '2026-08-17', cables: [cable()] }),
    ], 'me')?.id).toEqual('older');
  });

  it('excluding the only entry leaves nothing to offer', () => {
    expect(pickLatestWithCables([
      src({ id: 'me', visitDate: '2026-08-24', cables: [cable()] }),
    ], 'me')).toEqual(null);
  });

  it('an undated entry loses to a dated one', () => {
    expect(pickLatestWithCables([
      src({ id: 'undated', visitDate: null, cables: [cable()] }),
      src({ id: 'dated', visitDate: '2026-08-01', cables: [cable()] }),
    ])?.id).toEqual('dated');
  });
});

describe('telling the tech how old this is', () => {
  const sug = (o: any) => ({
    cables: [], closureCode: null, sourceLocationId: 'x', ...o,
  });

  it('names the date and the job', () => {
    expect(suggestionAge(sug({ visitDate: '2026-08-21', bmNumber: '26-357' })))
      .toEqual('8/21 on 26-357');
  });

  it('a date with no job still reads', () => {
    expect(suggestionAge(sug({ visitDate: '2026-08-21', bmNumber: null })))
      .toEqual('8/21');
  });

  it('says something honest when it knows neither', () => {
    expect(suggestionAge(sug({ visitDate: null, bmNumber: null })))
      .toEqual('a previous visit');
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
