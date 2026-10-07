/**
 * OPGW report maps (0015) — projection, zoom, and which pins get a close-up.
 * Worked against job 25-497 (803858 Ennis Pump–Shankle 138 kV), A.J.'s real GPS.
 *
 * Run: npx tsx apps/api/test/opgwMap.test.ts
 */
import { fitView, project, crowdedGroups, spreadPins, groupLetter, staticMapUrl, directionsUrl, type MapPin } from '../src/lib/opgwMap';

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
    toBeTrue() { if (actual !== true) throw new Error(`got ${JSON.stringify(actual)}, wanted true`); },
  };
}

const J25497: MapPin[] = [
  ['1', '36/3B', 32.4098921, -96.5963704],
  ['2', '35/1', 32.3999839, -96.5803874],
  ['3', 'Chrisp Switch', 32.3992940, -96.5792710],
  ['4', '34/9', 32.3989164, -96.5787064],
  ['5', '33/6', 32.3873527, -96.5600995],
  ['6', '33/2A', 32.3749460, -96.5398428],
  ['7', 'Ennis Pump Tap', 32.3749378, -96.5398411],
  ['8', '21/8', 32.2873636, -96.3991891],
  ['T2', '18/9 (tail)', 32.2616667, -96.3583333],
].map(([label, name, lat, lng]) => ({ label: label as string, name: name as string, lat: lat as number, lng: lng as number,
  kind: String(label).startsWith('T') ? 'test' as const : 'splice' as const }));

describe('the main map', () => {
  const v = fitView(J25497, 640, 330, { pad: 30, maxZoom: 15 });
  it('every pin lands inside the frame, off the edge', () => {
    const inside = J25497.every((p) => {
      const q = project(v, p.lat, p.lng);
      return q.x >= 29 && q.x <= 611 && q.y >= 29 && q.y <= 301;
    });
    expect(inside).toBeTrue();
  });
  it('picks a whole zoom that shows the whole 15-mile line (11)', () => {
    expect(v.zoom).toEqual(11);
  });
  it('the center pixel is the center of the view', () => {
    const q = project(v, v.centerLat, v.centerLng);
    expect([Math.round(q.x), Math.round(q.y)]).toEqual([320, 165]);
  });
});

describe('which pins get a close-up', () => {
  const v = fitView(J25497, 640, 330, { pad: 30, maxZoom: 15 });
  const groups = crowdedGroups(v, J25497);
  it('exactly the two crowded spots on 25-497', () => {
    expect(groups.map((g) => g.map((p) => p.name))).toEqual([
      ['35/1', 'Chrisp Switch', '34/9'],
      ['33/2A', 'Ennis Pump Tap'],
    ]);
  });
  it('lettered A and B', () => {
    expect(groups.map((_, i) => groupLetter(i))).toEqual(['A', 'B']);
  });
  it('a dense line does not chain into one giant close-up', () => {
    // 40 structures 150 m apart in a straight line
    const dense: MapPin[] = Array.from({ length: 40 }, (_, i) => ({
      label: String(i + 1), name: String(i + 1), lat: 32.4 - i * 0.00135, lng: -96.6, kind: 'splice' as const,
    }));
    const dv = fitView(dense, 640, 330, { pad: 30, maxZoom: 15 });
    const g = crowdedGroups(dv, dense);
    expect(g.every((x) => x.length < 10)).toBeTrue();
  });
  it('no crowding, no close-ups', () => {
    const far = [J25497[0], J25497[4], J25497[7]];
    expect(crowdedGroups(fitView(far, 640, 330, { pad: 30, maxZoom: 15 }), far).length).toEqual(0);
  });
});

describe('close-ups', () => {
  it('close-up A zooms in far enough to separate 35/1, Chrisp and 34/9', () => {
    const g = J25497.slice(1, 4);
    const v = fitView(g, 500, 300, { pad: 40, maxZoom: 18 });
    const xy = g.map((p) => project(v, p.lat, p.lng));
    const minGap = Math.min(
      Math.hypot(xy[0].x - xy[1].x, xy[0].y - xy[1].y),
      Math.hypot(xy[1].x - xy[2].x, xy[1].y - xy[2].y));
    expect(minGap > 30).toBeTrue();
  });
  it('33/2A and Ennis Pump Tap are inches apart — spread so both read', () => {
    const g = J25497.slice(5, 7);
    const v = fitView(g, 500, 300, { pad: 40, maxZoom: 18 });
    const xy = g.map((p) => project(v, p.lat, p.lng));
    const s = spreadPins(xy, 24);
    expect(Math.hypot(s[0].x - s[1].x, s[0].y - s[1].y) >= 24).toBeTrue();
  });
  it('pins already apart are left where they are', () => {
    const s = spreadPins([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(s).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
});

describe('links', () => {
  it('static map url carries center, zoom, size and the key', () => {
    const u = staticMapUrl({ centerLat: 32.4, centerLng: -96.5, zoom: 11, width: 640, height: 330 }, 'KEY');
    expect(u).toEqual('https://maps.googleapis.com/maps/api/staticmap?center=32.400000%2C-96.500000&zoom=11&size=640x330&scale=2&maptype=roadmap&key=KEY');
  });
  it('directions link to the ROW entrance', () => {
    expect(directionsUrl(32.39, -96.57)).toEqual('https://www.google.com/maps/dir/?api=1&destination=32.390000,-96.570000');
  });
  it('letters past Z', () => { expect([groupLetter(25), groupLetter(26)]).toEqual(['Z', 'AA']); });
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
