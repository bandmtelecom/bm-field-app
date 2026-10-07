/**
 * Builds the OPGW report for job 25-497 from A.J.'s email, with no database and
 * no map key (pins on a plain panel). Writes the PDF to the path given.
 *
 * Run: npx tsx apps/api/test/renderOpgwSample.ts out.pdf
 */
import PDFDocument from 'pdfkit';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildOpgwReport, type OpgwReportPoint } from '../src/lib/opgwReport';
import { fitView, crowdedGroups, groupLetter, directionsUrl, type MapPin } from '../src/lib/opgwMap';

const raw: [string, string, 'splice' | 'test', number | null, number | null, string, string | null, string][] = [
  ['1', '36/3B', 'splice', 32.4098921, -96.5963704, '2026-01-15', null, 'Right out of the sub, 0.23 km. Spliced on an earlier trip; fix 1/15.'],
  ['2', '35/1', 'splice', 32.3999839, -96.5803874, '2026-01-15', null, '2.2 km. Spliced on an earlier trip; fix 1/15.'],
  ['3', 'Chrisp Switch', 'splice', 32.3992940, -96.5792710, '2026-01-12', null, '2.4 km.'],
  ['4', '34/9', 'splice', 32.3989164, -96.5787064, '2026-01-13', null, '2.6 km. Fix 1/15.'],
  ['5', '33/6', 'splice', 32.3873527, -96.5600995, '2026-01-13', '32.38912,-96.55870', '4.9 km. Fix 1/15.'],
  ['6', '33/2A', 'splice', 32.3749460, -96.5398428, '2026-01-13', null, 'Fix 1/15.'],
  ['7', 'Ennis Pump Tap', 'splice', 32.3749378, -96.5398411, '2026-01-14', null, 'Same tower as 33/2A. Fix 1/16.'],
  ['8', '21/8', 'splice', 32.2873636, -96.3991891, '2026-01-12', null, 'Fix 1/16.'],
  ['T1', 'Shankle sub', 'test', null, null, '2026-01-14', null, 'Tested 1/14 from the tail at the transition tower, again 1/15 and 1/16.'],
  ['T2', '18/9 (tail)', 'test', 32.2616667, -96.3583333, '2026-01-14', null, 'Tested 1/14 and 1/16.'],
];
const points: OpgwReportPoint[] = raw.map(([label, name, kind, lat, lng, d, row, notes]) => {
  const [rl, rg] = row ? row.split(',').map(Number) : [null, null];
  return {
    label, name, kind, testedFrom: kind === 'test' ? (name.includes('sub') ? 'hub' : 'structure') : null,
    spliceType: kind === 'splice' ? '2-way' : '', cableCount: kind === 'splice' ? '48' : '',
    lat, lng, rowLat: rl, rowLng: rg, rowUrl: rl != null ? directionsUrl(rl, rg!) : null,
    notes, techs: ['A.J. Carrasco', 'Hunter'], workDate: d,
  };
});
const pins: MapPin[] = points.filter((p) => p.lat != null).map((p) => ({ label: p.label, name: p.name, lat: p.lat!, lng: p.lng!, kind: p.kind }));
const view = fitView(pins, 640, 330, { pad: 30, maxZoom: 15 });
const groups = crowdedGroups(view, pins).map((g, i) => ({ letter: groupLetter(i), pins: g }));
const closeups = groups.map((g) => ({ view: fitView(g.pins, 500, 300, { pad: 40, maxZoom: 18 }), pins: g.pins, image: null,
  title: `Close-up ${g.letter} — ${g.pins.map((p) => p.name).join(', ')}` }));

const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, bufferPages: true });
const chunks: Buffer[] = [];
doc.on('data', (c: Buffer) => chunks.push(c));
doc.on('end', () => writeFileSync(process.argv[2] ?? 'opgw-sample.pdf', Buffer.concat(chunks)));
doc.addPage();
buildOpgwReport(doc, {
  bmNumber: '25-497', customerName: 'Primoris', identifier: '803858', title: 'Ennis Pump–Shankle 138 kV',
  points, main: { view, pins, image: null, groups, title: 'Map 1 — the whole line' }, closeups, noMapKey: true,
}, { logo: readFileSync(new URL('../assets/logo.png', import.meta.url)), generatedOn: '2026-10-07' });
doc.end();
