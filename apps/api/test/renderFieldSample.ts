/**
 * Renders a sample Lumen field report in the 0016 order, from Jason's 10/27
 * scrambled list plus a repair, a roll-around, a second enclosure and a
 * testing-only stop. Run: npx tsx apps/api/test/renderFieldSample.ts out.pdf
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { buildFieldReport, type ReportJob, type ReportLocation } from '../src/lib/fieldReport';

let n = 0;
function loc(pm: string, o: Partial<ReportLocation> = {}): ReportLocation {
  n++;
  return {
    id: `L${n}`, kind: 'mop', revisitOf: null, enclosureOf: null, ordinal: n,
    closureCode: `Lumen-0${100 + n}`, pmLocationNo: pm, jobLocationNo: null, isRevisit: false,
    techs: ['Josh L', 'Kelby'], structureType: 'hh', structureOwner: null, buildingAddress: null,
    gpsLat: 32.9416, gpsLng: -97.1511, enclosureModel: '450D', enclosureNew: false,
    caseAction: 'reenter', spliceType: 'single', spliceCount: 12, traysAdded: 0,
    testFiberCount: 0, testType: null, asFound: null, asBuilt: null,
    narrative: null, cables: [], shots: [], ports: [], downtime: [], units: [], ...o,
  };
}
const day1 = ['13', '11', '12', '8.5', '9', '8', '3', '7', '4', '5', '6', '2', '1', '0', '0.5', '10'].map((p) => loc(p));
const byPm = (p: string) => day1.find((l) => l.pmLocationNo === p)!;
const five = byPm('5');
const day2: ReportLocation[] = [
  loc('', { enclosureOf: five.id, closureCode: 'Lumen-0201', enclosureModel: 'Windsor',
    narrative: 'Tie cable between the 450D and the Windsor; spliced 12 in each.' }),
  loc('3', { revisitOf: byPm('3').id, isRevisit: true, narrative: 'Came back to finish fibers 13-24.' }),
  loc('5.5', { narrative: 'New location added between 5 and 6 — plan change from engineering.' }),
  loc('1', { kind: 'repair', narrative: 'Simple repair, 2 fibers, 300 ft west of 7.' }),
  loc('1', { kind: 'rollaround', narrative: 'Rolled around backhoe damage.', structureType: 'aerial' }),
];
const day3: ReportLocation[] = [
  loc('4', { revisitOf: byPm('4').id, isRevisit: true }),
  loc('12', { revisitOf: byPm('12').id, isRevisit: true }),
  loc('10', { revisitOf: byPm('10').id, isRevisit: true }),
  loc('2', { kind: 'repair' }),
  loc('Shankle hub', { spliceCount: 0, testFiberCount: 24, testType: 'otdr', structureType: 'building',
    buildingAddress: '2112 California Ave', closureCode: null, caseAction: null, enclosureModel: null }),
];
const job: ReportJob = {
  bmNumber: '26-406', customerName: 'Lumen Technologies', identifier: '35422105-1',
  identifierType: 'tt', title: 'Urgent outage TT 35422105-1', billingMode: 'lor', status: 'complete',
  visits: [
    { date: '2026-09-29', techs: [], reportType: null, statusFlag: 'partial_return', narrative: 'Relocated section; added splice next to the cut.', locations: day1 },
    { date: '2026-09-30', techs: [], reportType: null, statusFlag: 'partial_return', narrative: 'Second enclosure at 5, finished 3, new 5.5, one repair, one roll-around.', locations: day2 },
    { date: '2026-10-01', techs: [], reportType: null, statusFlag: 'complete', narrative: 'Final returns and testing from the hub.', locations: day3 },
  ],
};
const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, bufferPages: true });
doc.pipe(createWriteStream(process.argv[2] ?? 'sample.pdf'));
doc.addPage();
buildFieldReport(doc, job, { generatedOn: '2026-10-27' });
doc.end();
