/**
 * Field report ORDER (0016) — Jason's scrambled list, return trips, repairs,
 * roll-arounds, second enclosures, and the no-splicing group at the bottom.
 *
 * Run: npx tsx apps/api/test/reportOrder.test.ts
 */
import { orderReport, kindLabel, compareNumbers, type OrderInput, type LocationKind } from '../src/lib/reportOrder';

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

let seq = 0;
function row(pm: string, visitIndex: number, o: Partial<OrderInput> = {}): OrderInput {
  seq++;
  return {
    id: o.id ?? `r${seq}`, kind: (o.kind ?? 'mop') as LocationKind, pmLocationNo: pm,
    jobLocationNo: null, revisitOf: null, enclosureOf: null,
    visitIndex, ordinal: seq, spliceCount: 6, ...o,
  };
}
const labels = (rows: OrderInput[]) =>
  orderReport(rows).flatMap((s) => s.places.map((p) => p.label));

describe('labels', () => {
  it('MOP numbers, decimals and names', () => {
    expect([kindLabel('mop', '5'), kindLabel('mop', '5.5'), kindLabel('mop', '1950 Stemmons'), kindLabel('mop', '')])
      .toEqual(['Location 5', 'Location 5.5', '1950 Stemmons', 'Location']);
  });
  it('repair and roll-around', () => {
    expect([kindLabel('repair', '2'), kindLabel('rollaround', '1')])
      .toEqual(['Repair 2', 'Roll-around location 1']);
  });
});

describe('number order', () => {
  it('numbers by value, letters after, names last', () => {
    const xs = ['10', '2', 'West', '1b', '0.5', '1', '1a', '0', 'Location 3'];
    expect([...xs].sort(compareNumbers)).toEqual(['0', '0.5', '1', '1a', '1b', '2', 'Location 3', '10', 'West']);
  });
});

describe("Jason's report, 10/27", () => {
  // 13 11 12 8.5 9 8 3 7 4 5 5.5 10 6 2 1 3 0 0.5 4 12 10 — as it printed,
  // the later 3, 4, 12, 10 being return trips on later days.
  const order = ['13', '11', '12', '8.5', '9', '8', '3', '7', '4', '5', '5.5', '10', '6', '2', '1', '3', '0', '0.5', '4', '12', '10'];
  const rows = order.map((n, i) => row(n, i < 15 ? 0 : 1));
  const s = orderReport(rows);
  it('prints each location once, in order', () => {
    expect(s[0].places.map((p) => p.number))
      .toEqual(['0', '0.5', '1', '2', '3', '4', '5', '5.5', '6', '7', '8', '8.5', '9', '10', '11', '12', '13']);
  });
  it('3, 4, 10, 12 carry two trips each', () => {
    expect(s[0].places.filter((p) => p.trips.length === 2).map((p) => p.number)).toEqual(['3', '4', '10', '12']);
  });
  it('trips are in date order', () => {
    const three = s[0].places.find((p) => p.number === '3')!;
    expect(three.trips.map((t) => t.visitIndex)).toEqual([0, 1]);
  });
});

describe('return trips linked by revisit_of', () => {
  it('a revisit sits under its location even when typed differently', () => {
    const a = row('3', 0, { id: 'a' });
    const b = row('Location 3', 2, { id: 'b', revisitOf: 'a' });
    const c = row('2', 1);
    const s = orderReport([b, c, a]);
    expect(s[0].places.map((p) => [p.label, p.trips.length])).toEqual([['Location 2', 1], ['Location 3', 2]]);
  });
});

describe('sections', () => {
  const rows = [
    row('1', 2, { kind: 'rollaround' }),
    row('2', 1, { kind: 'repair' }),
    row('1', 0, { kind: 'repair', id: 'rep1' }),
    row('1', 3, { kind: 'repair', revisitOf: 'rep1' }),
    row('6', 0),
    row('5', 0),
    row('5.5', 1),
    row('Shankle hub', 1, { spliceCount: 0 }),            // testing only
    row('7', 0, { spliceCount: 0 }),                       // opened to look
    row('3', 2, { kind: 'repair', spliceCount: 0 }),       // repair, no splicing
  ];
  it('MOP, then repairs, then roll-arounds, then no splicing', () => {
    expect(orderReport(rows).map((s) => s.id)).toEqual(['mop', 'repair', 'rollaround', 'nosplice']);
  });
  it('full running order', () => {
    expect(labels(rows)).toEqual([
      'Location 5', 'Location 5.5', 'Location 6',
      'Repair 1', 'Repair 2',
      'Roll-around location 1',
      'Location 7', 'Shankle hub', 'Repair 3',
    ]);
  });
  it('a revisit to a repair nests under it', () => {
    const rep = orderReport(rows).find((s) => s.id === 'repair')!.places[0];
    expect([rep.label, rep.trips.length]).toEqual(['Repair 1', 2]);
  });
  it('a location stays up top if ANY trip spliced', () => {
    const a = row('4', 0, { spliceCount: 0, id: 'x' });
    const b = row('4', 1, { spliceCount: 12, revisitOf: 'x' });
    expect(orderReport([a, b]).map((s) => s.id)).toEqual(['mop']);
  });
});

describe('second enclosure in the same hole', () => {
  const first = row('5', 0, { id: 'e1' });
  const second = row('', 0, { id: 'e2', enclosureOf: 'e1' });
  const s = orderReport([second, first]);
  it('one location, one trip, two enclosures — first one first', () => {
    const p = s[0].places[0];
    expect([s[0].places.length, p.label, p.trips.length, p.trips[0].rows.map((r) => r.id)])
      .toEqual([1, 'Location 5', 1, ['e1', 'e2']]);
  });
  it('2nd enclosure of a 2nd enclosure still resolves', () => {
    const third = row('', 0, { id: 'e3', enclosureOf: 'e2' });
    expect(orderReport([first, second, third])[0].places[0].trips[0].rows.length).toEqual(3);
  });
});

describe('older data', () => {
  it('riser work at one building for weeks is one place, many trips', () => {
    const rows = [0, 1, 2, 3].map((v) => row('1950 Stemmons', v));
    const p = orderReport(rows)[0].places;
    expect([p.length, p[0].label, p[0].trips.length]).toEqual([1, '1950 Stemmons', 4]);
  });
  it('a row with no number at all keeps its own place', () => {
    const rows = [row('', 0, { jobLocationNo: null }), row('', 0, { jobLocationNo: null })];
    expect(orderReport(rows)[0].places.length).toEqual(2);
  });
  it('a revisit loop cannot hang it', () => {
    const a = row('1', 0, { id: 'L1', revisitOf: 'L2' });
    const b = row('1', 1, { id: 'L2', revisitOf: 'L1' });
    expect(orderReport([a, b])[0].places.length).toEqual(1);
  });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
