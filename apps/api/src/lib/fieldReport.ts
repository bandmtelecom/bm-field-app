/**
 * The customer-facing field report.
 *
 * This is the documentation half of the product: the rate card is what B&M
 * bills, this is the record of work that goes to the customer. It carries NO
 * prices — not a rate, not a total, nothing.
 *
 * PAGINATION RULE — the thing that broke the first version: never write text at
 * an explicit y without first checking it fits. pdfkit will happily spill a
 * block onto a fresh page while this code keeps tracking the old page's
 * coordinates, and everything after it gets drawn below the paper edge and
 * silently disappears. That is how visits 3 and 4 of job 26-349 vanished and
 * page 2 came out blank. So: measure with heightOfString, break if it doesn't
 * fit, THEN draw.
 */

/**
 * Footage is typed free-hand by the crew ("22,590'", "see prints") and is
 * information only. Print it as typed; a bare number gets " ft" appended, which
 * is how rows before 8/28/26 were stored when the column was an integer.
 */
function footageLabel(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  return /^[\d,]+$/.test(s) ? `${s} ft` : s;
}

export interface ReportCable {
  direction: string | null; count: string | null; manufacturer: string | null;
  date_code: string | null; footage: string | null; role: string | null;
}
export interface ReportShot {
  fiber_group: string | null; direction: string | null;
  distance_km: number | null; event: string | null;
}
export interface ReportPort {
  panel: string | null; port: string | null; position: string | null; pass_fail: string | null;
}
export interface ReportDowntime { hours: number | null; reason: string | null; }

export interface ReportLocation {
  closureCode: string | null;
  pmLocationNo: string | null;
  structureType: string | null;
  structureOwner: string | null;
  buildingAddress: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  enclosureModel: string | null;
  enclosureNew: boolean;
  caseAction: string | null;
  spliceType: string | null;
  spliceCount: number;
  traysAdded: number;
  testFiberCount: number;
  testType: string | null;
  asFound: string | null;
  asBuilt: string | null;
  narrative: string | null;
  cables: ReportCable[];
  shots: ReportShot[];
  ports: ReportPort[];
  downtime: ReportDowntime[];
  units: string[];
}

export interface ReportVisit {
  date: string | null;
  techs: string[];
  reportType: string | null;
  statusFlag: string | null;
  narrative: string | null;
  locations: ReportLocation[];
}

export interface ReportJob {
  bmNumber: string;
  customerName: string | null;
  identifier: string | null;
  identifierType: string | null;
  title: string | null;
  billingMode: string | null;
  status: string | null;
  visits: ReportVisit[];
}

const NAVY = '#0b3d5c';
const MUTED = '#6b7a88';
const LINE = '#dfe4e8';
const TEXT = '#1a2733';
const BAND = '#eef2f5';

const STRUCTURE: Record<string, string> = {
  mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
};
const CASE_ACTION: Record<string, string> = {
  reenter: 'Re-entered existing case',
  new_case: 'New case installed',
  midsheath: 'Mid-sheath opening',
};
const STATUS: Record<string, string> = {
  complete: 'Complete',
  partial_return: 'Partial — return needed',
  ready_to_test: 'Ready to test',
  could_not_access: 'Could not access',
  troubleshooting: 'Troubleshooting / ongoing',
};
const ID_TYPE: Record<string, string> = {
  n_number: 'N-number', tt: 'Trouble ticket', lor: 'LOR',
  address: 'Address', other: 'Reference',
};
/** downtime reasons arrive as codes; the customer should never see a code */
const DOWNTIME_REASON: Record<string, string> = {
  troubleshooting: 'Troubleshooting / DT',
  waiting_construction: 'Waiting on construction',
  waiting_customer: 'Waiting on customer / engineer',
  access: 'Access / gate delay',
  locate: 'Locate / permit',
  traffic: 'Traffic control',
  equipment: 'Equipment',
  weather: 'Weather',
  other: 'Other',
};

const M = { left: 50, right: 50, top: 50, bottom: 58 };
const GUTTER = 10;   // keeps a right-aligned column off its neighbour

function niceDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/**
 * Crew names come in free-typed per visit — "jesus" and "Jesus", "tyler" and
 * "Tyler" are the same man. Fold case for uniqueness, keep the tidiest spelling.
 */
function tidyNames(names: string[]): string[] {
  const best = new Map<string, string>();
  for (const raw of names) {
    const n = raw.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    const existing = best.get(key);
    // prefer the version that starts with a capital
    if (!existing || (/^[a-z]/.test(existing) && /^[A-Z]/.test(n))) best.set(key, n);
  }
  return [...best.values()].map((n) => n.charAt(0).toUpperCase() + n.slice(1));
}

export function buildFieldReport(
  doc: any,
  job: ReportJob,
  opts: { logo?: Buffer | null; generatedOn: string } = { generatedOn: '' },
) {
  const W = doc.page.width - M.left - M.right;
  const IND = M.left + 10;               // indent for everything under a heading
  const IW = W - 10;                     // indented width
  const maxY = () => doc.page.height - M.bottom;
  let pageNo = 0;

  // The customer's own reference — the number THEY know the job by. Austin:
  // "we need all of the Lumen identifiers on the report, the job number for
  // Lumen needs to be very visible." It rides the header on every page.
  const custRef = (job.identifier ?? '').trim();
  const refLabel = ID_TYPE[job.identifierType ?? 'other'] ?? 'Reference';

  function header() {
    pageNo++;
    const y = M.top;
    if (opts.logo) {
      try { doc.image(opts.logo, M.left, y, { fit: [58, 40] }); }
      catch { /* a bad logo file must never break the report */ }
    } else {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
        .text('B&M Telecom, Inc.', M.left, y + 8, { lineBreak: false });
    }

    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('FIELD REPORT', M.left, y, { width: W, align: 'right', lineBreak: false });
    if (custRef) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
        .text(custRef, M.left + 120, y + 11, { width: W - 120, align: 'right', lineBreak: false });
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text(`B&M job ${job.bmNumber}`, M.left, y + (custRef ? 28 : 14),
        { width: W, align: 'right', lineBreak: false });

    const rule = y + 46;
    doc.moveTo(M.left, rule).lineTo(doc.page.width - M.right, rule)
      .lineWidth(1).strokeColor(NAVY).stroke();
    doc.y = rule + 14;
    doc.fillColor(TEXT);
  }

  function footer() {
    const y = doc.page.height - M.bottom + 20;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`B&M Telecom, Inc.  ·  ${custRef ? custRef + '  ·  ' : ''}B&M ${job.bmNumber}  ·  Generated ${opts.generatedOn}`,
        M.left, y, { width: W - 60, align: 'left', lineBreak: false })
      .text(`Page ${pageNo}`, M.left, y, { width: W, align: 'right', lineBreak: false });
    doc.fillColor(TEXT);
  }

  function newPage() {
    footer();
    doc.addPage();
    header();
  }

  /** Break the page if `h` won't fit below the current position. */
  function ensure(h: number) {
    if (doc.y + h > maxY()) newPage();
  }

  /** Measure a string at a given font/size/width without drawing it. */
  function measure(text: string, font: string, size: number, width: number) {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text, { width });
  }

  function field(label: string, value: unknown) {
    if (value === null || value === undefined || value === '' || value === 0) return;
    const text = String(value);
    const labelW = 108;
    const valueX = IND + labelW + 12;
    const valueW = doc.page.width - M.right - valueX;
    const h = Math.max(
      measure(label.toUpperCase(), 'Helvetica-Bold', 8.5, labelW),
      measure(text, 'Helvetica', 9.5, valueW),
    );
    ensure(h + 4);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
      .text(label.toUpperCase(), IND, y + 1, { width: labelW });
    doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
      .text(text, valueX, y, { width: valueW });
    doc.y = y + h + 4;
    doc.fillColor(TEXT);
  }

  function subhead(text: string) {
    ensure(20);
    doc.y += 5;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
      .text(text.toUpperCase(), IND, doc.y, { width: IW, characterSpacing: 0.4 });
    doc.y += 3;
    doc.fillColor(TEXT);
  }

  /**
   * Column widths are weights, scaled to the indented width, and every cell is
   * drawn inside its width MINUS a gutter — otherwise a right-aligned number
   * runs straight into the next heading ("FootageRole", "HoursReason").
   */
  function table(
    cols: { head: string; w: number; align?: 'left' | 'right' }[],
    rows: string[][],
  ) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const scale = IW / total;
    const widths = cols.map((c) => c.w * scale);
    const xs: number[] = [];
    let acc = IND;
    for (const w of widths) { xs.push(acc); acc += w; }

    const drawHead = () => {
      ensure(16);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      cols.forEach((c, i) => {
        doc.text(c.head, xs[i], y, {
          width: widths[i] - GUTTER, align: c.align ?? 'left', lineBreak: false,
        });
      });
      doc.y = y + 12;
      doc.moveTo(IND, doc.y - 3).lineTo(IND + IW, doc.y - 3)
        .lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(TEXT);
    };

    drawHead();
    for (const r of rows) {
      const h = Math.max(...r.map((cell, i) =>
        measure(cell || '—', 'Helvetica', 9, widths[i] - GUTTER)));
      if (doc.y + h + 3 > maxY()) { newPage(); drawHead(); }
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(TEXT);
      r.forEach((cell, i) => {
        doc.text(cell || '—', xs[i], y, {
          width: widths[i] - GUTTER, align: cols[i].align ?? 'left',
        });
      });
      doc.y = y + h + 3;
    }
    doc.y += 2;
  }

  // ======================= page 1 ==========================================
  header();

  doc.font('Helvetica-Bold').fontSize(20).fillColor(TEXT)
    .text(job.customerName ?? 'Field report', M.left, doc.y, { width: W });

  // The identifier and the title are frequently the same text typed twice —
  // show it once.
  const title = (job.title ?? '').trim();
  const subtitle = title && title.toLowerCase() !== custRef.toLowerCase() ? title : '';
  if (subtitle) {
    doc.font('Helvetica').fontSize(11).fillColor(MUTED)
      .text(subtitle, M.left, doc.y + 2, { width: W });
  }
  doc.y += 12;

  // ---- the customer's reference, in a band they cannot miss ----
  if (custRef) {
    const h = 42;
    ensure(h + 10);
    const y = doc.y;
    doc.rect(M.left, y, W, h).fillColor(BAND).fill();
    doc.rect(M.left, y, 4, h).fillColor(NAVY).fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      .text(refLabel.toUpperCase(), M.left + 14, y + 7, { width: W - 28, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
      .text(custRef, M.left + 14, y + 19, { width: W - 28 });
    doc.y = y + h + 12;
    doc.fillColor(TEXT);
  }

  const dates = job.visits.map((v) => v.date).filter(Boolean).sort() as string[];
  field('B&M job', job.bmNumber);
  field('Customer', job.customerName);
  if (custRef) field(refLabel, custRef);
  if (subtitle) field('Location', subtitle);
  field('Work performed', dates.length
    ? (dates[0] === dates[dates.length - 1]
        ? niceDate(dates[0])
        : `${niceDate(dates[0])} – ${niceDate(dates[dates.length - 1])}`)
    : null);
  field('Visits', job.visits.length);
  field('Locations', job.visits.reduce((s, v) => s + v.locations.length, 0));
  field('Technicians', tidyNames(job.visits.flatMap((v) => v.techs)).join(', '));

  doc.y += 6;

  // ======================= the running record ==============================
  job.visits.forEach((v, vi) => {
    ensure(54);
    doc.y += 6;
    const y = doc.y;
    doc.rect(M.left, y, W, 24).fillColor(BAND).fill();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
      .text(`Visit ${vi + 1} — ${niceDate(v.date)}`, M.left + 9, y + 7, {
        width: W * 0.55, lineBreak: false,
      });
    const crew = tidyNames(v.techs).join(', ');
    if (crew) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(crew, M.left + W * 0.55, y + 8, {
          width: W * 0.45 - 9, align: 'right', lineBreak: false,
        });
    }
    doc.y = y + 30;
    doc.fillColor(TEXT);

    if (v.statusFlag) field('Status', STATUS[v.statusFlag] ?? v.statusFlag);
    if (v.narrative) field('Summary', v.narrative);

    v.locations.forEach((l, li) => {
      ensure(46);
      doc.y += 4;
      doc.moveTo(M.left, doc.y).lineTo(doc.page.width - M.right, doc.y)
        .lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y += 8;

      const heading = l.closureCode
        ?? (l.pmLocationNo ? `Location ${l.pmLocationNo}` : `Location ${li + 1}`);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(TEXT)
        .text(heading, IND, doc.y, { width: IW });
      const sub = [
        STRUCTURE[l.structureType ?? ''] ?? l.structureType,
        l.structureOwner,
        l.closureCode && l.pmLocationNo ? `Location ${l.pmLocationNo}` : null,
      ].filter(Boolean).join('  ·  ');
      if (sub) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
          .text(sub, IND, doc.y + 1, { width: IW });
      }
      doc.y += 6;
      doc.fillColor(TEXT);

      field('Address', l.buildingAddress);
      if (l.gpsLat != null && l.gpsLng != null) field('GPS', `${l.gpsLat}, ${l.gpsLng}`);
      field('Enclosure', [l.enclosureModel, l.enclosureNew ? '(new)' : null]
        .filter(Boolean).join(' ') || null);
      field('Case', l.caseAction ? CASE_ACTION[l.caseAction] ?? l.caseAction : null);
      if (l.spliceCount > 0) {
        field('Splices', `${l.spliceCount} ${l.spliceType === 'ribbon' ? 'ribbon' : 'single fusion'}`);
      }
      field('Trays added', l.traysAdded);
      if (l.testFiberCount > 0) {
        field('Fibers tested',
          `${l.testFiberCount}${l.testType ? ` (${l.testType.toUpperCase()})` : ''}`);
      }
      field('As found', l.asFound);
      field('As built', l.asBuilt);
      field('Notes', l.narrative);

      if (l.cables.length) {
        subhead('Cables');
        // Compose whatever is present - a report must read correctly for a row
        // captured last year and one captured today. `date_code` moved into the
        // cable line on 8/25; `footage` came back as its own free-text box on
        // 8/28 and is printed exactly as the tech typed it (a bare number gets
        // " ft" appended, which is how the old integer rows were stored). There
        // is no footage total any more - the values are not numbers. `role` is
        // no longer captured; it is still shown when an older row has one rather
        // than silently dropping detail the customer saw on a previous report.
        const cableText = (c: typeof l.cables[number]) => [
          c.count ?? '',
          c.date_code ?? '',
          footageLabel(c.footage),
          c.role ?? '',
        ].map((x) => String(x).trim()).filter(Boolean).join('  ');

        table(
          [{ head: 'Manufacturer', w: 110 }, { head: 'Direction', w: 80 },
           { head: 'Cable', w: 300 }],
          l.cables.map((c) => [c.manufacturer ?? '', c.direction ?? '', cableText(c)]),
        );
      }

      if (l.ports.length) {
        subhead('Panel ports');
        table(
          [{ head: 'Panel', w: 150 }, { head: 'Port', w: 90 },
           { head: 'Position', w: 90 }, { head: 'Result', w: 90, align: 'right' }],
          l.ports.map((p) => [
            p.panel ?? '', p.port ?? '', p.position ?? '',
            p.pass_fail ? p.pass_fail.toUpperCase() : '',
          ]),
        );
      }

      if (l.shots.length) {
        subhead('OTDR shots');
        table(
          [{ head: 'Fiber', w: 130 }, { head: 'Direction', w: 90 },
           { head: 'Distance', w: 80, align: 'right' }, { head: 'Event', w: 160 }],
          l.shots.map((s) => [
            s.fiber_group ?? '', s.direction ?? '',
            s.distance_km != null ? `${s.distance_km} km` : '', s.event ?? '',
          ]),
        );
      }

      if (l.downtime.length) {
        const hrs = l.downtime.reduce((s, x) => s + (Number(x.hours) || 0), 0);
        subhead(`Downtime — ${hrs} hr`);
        table(
          [{ head: 'Hours', w: 60, align: 'right' }, { head: 'Reason', w: 380 }],
          l.downtime.map((x) => [
            String(x.hours ?? ''),
            x.reason ? DOWNTIME_REASON[x.reason] ?? x.reason : 'Unspecified',
          ]),
        );
      }

      if (l.units.length) {
        subhead('Additional work');
        l.units.forEach((u) => {
          const h = measure(`•  ${u}`, 'Helvetica', 9.5, IW);
          ensure(h + 2);
          doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
            .text(`•  ${u}`, IND, doc.y, { width: IW });
          doc.y += 2;
        });
      }
    });

    if (!v.locations.length) {
      ensure(16);
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED)
        .text('No locations recorded on this visit.', IND, doc.y, { width: IW });
      doc.fillColor(TEXT);
    }
  });

  if (!job.visits.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED)
      .text('No work has been recorded on this job yet.', M.left, doc.y, { width: W });
  }

  footer();
}
