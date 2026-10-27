/**
 * Second enclosure in the same hole (0016): one setup, both re-enters, both
 * sets of splices. Runs the real engine. Run: npx tsx packages/billing/test/enclosureHoles.test.ts
 */
import { computeInvoice as buildInvoice } from '../src/engine';
import { shareEnclosureHoles } from '../../../apps/api/src/lib/enclosureHoles';
import type { JobInput, LocationInput } from '../src/types';

let passes = 0, failures = 0;
function it(name: string, fn: () => void) {
  try { fn(); passes++; console.log(`  ok   ${name}`); }
  catch (e: any) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a: any, b: any) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); }

function loc(id: string, o: Partial<LocationInput> = {}): LocationInput {
  return { id, closureCode: id, structureType: 'hh', caseAction: 'reenter', spliceType: 'single',
    spliceCount: 6, traysAdded: 0, testFiberCount: 0, testType: 'otdr', downtimeHours: 0,
    techs: ['A', 'B'], extraUnits: [], ...o } as LocationInput;
}
function job(locs: LocationInput[]): JobInput {
  return { bmNumber: 'T', billingMode: 'capital', maintWindow: false, scheduledAhead: false,
    visits: [{ id: 'v', date: '2026-10-27', techs: ['A', 'B'], locations: locs }] } as JobInput;
}
const qty = (j: JobInput, code: string) => buildInvoice(j).lines
  .filter((l: any) => l.unitCode === code).reduce((s: number, l: any) => s + l.quantity, 0);

it('no GPS on either: without the link it bills TWO setups', () => {
  eq(qty(job([loc('e1'), loc('e2')]), 'SETUP_HH'), 2);
});
it('linked: ONE setup, TWO re-enters, splices on both', () => {
  const locs = [loc('e1'), loc('e2')];
  shareEnclosureHoles(locs, new Map([['e2', 'e1']]));
  const j = job(locs);
  eq([qty(j, 'SETUP_HH'), qty(j, 'REENTER')], [1, 2]);
  const spliceLines = buildInvoice(j).lines.filter((l: any) => /^FUSION/.test(l.unitCode));
  eq(spliceLines.map((l: any) => l.quantity), [6, 6]);
});
it('mistyped GPS on the second one still shares', () => {
  const locs = [loc('e1', { gpsLat: 32.94168, gpsLng: -97.15117 }), loc('e2', { gpsLat: 32.95, gpsLng: -97.2 })];
  shareEnclosureHoles(locs, new Map([['e2', 'e1']]));
  eq(qty(job(locs), 'SETUP_HH'), 1);
});
it('third enclosure chained to the second still shares', () => {
  const locs = [loc('e1'), loc('e2'), loc('e3')];
  shareEnclosureHoles(locs, new Map([['e2', 'e1'], ['e3', 'e2']]));
  eq([qty(job(locs), 'SETUP_HH'), qty(job(locs), 'REENTER')], [1, 3]);
});
it('partner on another visit: untouched (own setup that night)', () => {
  const locs = [loc('e2')];
  shareEnclosureHoles(locs, new Map([['e2', 'e1']]));
  eq(locs[0].holeKey, undefined);
});
it('an unrelated hole is not dragged in', () => {
  const locs = [loc('e1'), loc('e2'), loc('x')];
  shareEnclosureHoles(locs, new Map([['e2', 'e1']]));
  eq(qty(job(locs), 'SETUP_HH'), 2);
});
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
