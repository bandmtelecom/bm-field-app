/**
 * The customer-facing field report.
 *
 * This is the documentation half of the product: the rate card is what B&M
 * bills, this is the record of work that goes to the customer. It carries NO
 * prices — not a rate, not a total, nothing. Everything here is what the crew
 * physically did and found.
 *
 * Layout only. The caller fetches the data and hands over a pdfkit document.
 */

export interface ReportCable {
  direction: string | null; count: string | null; manufacturer: string | null;
  date_code: string | null; footage: number | null; role: string | null;
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
  n_number: 'N-number', tt: 'Trouble ticket', lor: 'LOR', address: 'Address', other: 'Reference',
};

const M = { left: 50, right: 50, top: 54, bottom: 56 };

/** Date as the customer reads it, from an ISO yyyy-mm-dd. */
function niceDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function buildFieldReport(
  doc: any,
  job: ReportJob,
  opts: { logo?: Buffer | null; generatedOn: string } = { generatedOn: '' },
) {
  const W = doc.page.width - M.left - M.right;
  let pageNo = 0;

  const room = (needed: number) => {
    if (doc.y + needed > doc.page.height - M.bottom) newPage();
  };

  function header() {
    pageNo++;
    let y = M.top;
    if (opts.logo) {
      try {
        doc.image(opts.logo, M.left, y - 8, { fit: [56, 44] });
      } catch { /* a bad logo file must never break the report */ }
    } else {
      doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY)
        .text('B&M Telecom, Inc.', M.left, y);
    }
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('FIELD REPORT', M.left, y, { width: W, align: 'right' })
      .text(`B&M ${job.bmNumber}`, M.left, y + 12, { width: W, align: 'right' });
    y += 38;
    doc.moveTo(M.left, y).lineTo(doc.page.width - M.right, y)
      .lineWidth(1).strokeColor(NAVY).stroke();
    doc.y = y + 14;
    doc.fillColor(TEXT);
  }

  function footer() {
    const y = doc.page.height - M.bottom + 18;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`B&M Telecom, Inc.  ·  Job ${job.bmNumber}  ·  Generated ${opts.generatedOn}`,
        M.left, y, { width: W, align: 'left', lineBreak: false })
      .text(`Page ${pageNo}`, M.left, y, { width: W, align: 'right', lineBreak: false });
    doc.fillColor(TEXT);
  }

  function newPage() {
    footer();
    doc.addPage();
    header();
  }

  /** label: value, on one line, skipping empties */
  function field(label: string, value: unknown) {
    if (value === null || value === undefined || value === '' || value === 0) return;
    room(16);
    const startY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
      .text(label.toUpperCase(), M.left + 10, startY, { width: 110, continued: false });
    doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
      .text(String(value), M.left + 124, startY, { width: W - 134 });
    doc.y = Math.max(doc.y, startY) + 3;
  }

  function subhead(text: string) {
    room(22);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
      .text(text.toUpperCase(), M.left + 10, doc.y, { characterSpacing: 0.4 });
    doc.fillColor(TEXT).moveDown(0.15);
  }

  /** simple table: fixed column widths, wraps a page when it has to */
  function table(cols: { head: string; w: number; align?: string }[], rows: string[][]) {
    const x0 = M.left + 10;
    const drawHead = () => {
      room(18);
      let x = x0;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      for (const c of cols) {
        doc.text(c.head, x, y, { width: c.w, align: (c.align as any) ?? 'left' });
        x += c.w;
      }
      doc.y = y + 11;
      doc.moveTo(x0, doc.y - 2).lineTo(x0 + cols.reduce((s, c) => s + c.w, 0), doc.y - 2)
        .lineWidth(0.5).strokeColor(LINE).stroke();
      doc.fillColor(TEXT);
    };
    drawHead();
    for (const r of rows) {
      const need = 13;
      if (doc.y + need > doc.page.height - M.bottom) { newPage(); drawHead(); }
      let x = x0;
      const y = doc.y;
      let tallest = y;
      doc.font('Helvetica').fontSize(9).fillColor(TEXT);
      r.forEach((cell, i) => {
        const c = cols[i];
        doc.text(cell || '—', x, y, { width: c.w - 6, align: (c.align as any) ?? 'left' });
        tallest = Math.max(tallest, doc.y);
        x += c.w;
      });
      doc.y = tallest + 2;
    }
    doc.moveDown(0.2);
  }

  // ---- page 1 -------------------------------------------------------------
  header();

  doc.font('Helvetica-Bold').fontSize(19).fillColor(TEXT)
    .text(job.customerName ?? 'Field report', M.left, doc.y);
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text(
      [job.identifier ? `${ID_TYPE[job.identifierType ?? 'other'] ?? 'Reference'} ${job.identifier}` : null,
       job.title].filter(Boolean).join('  ·  ') || ' ',
      M.left, doc.y + 2, { width: W });
  doc.moveDown(0.8);

  const dates = job.visits.map((v) => v.date).filter(Boolean).sort() as string[];
  doc.font('Helvetica').fontSize(9.5).fillColor(TEXT);
  field('B&M job', job.bmNumber);
  field('Customer', job.customerName);
  field('Work performed', dates.length
    ? (dates[0] === dates[dates.length - 1]
        ? niceDate(dates[0])
        : `${niceDate(dates[0])} – ${niceDate(dates[dates.length - 1])}`)
    : null);
  field('Visits', job.visits.length);
  field('Locations', job.visits.reduce((s, v) => s + v.locations.length, 0));

  const allTechs = [...new Set(job.visits.flatMap((v) => v.techs))];
  field('Technicians', allTechs.join(', '));

  doc.moveDown(0.6);

  // ---- the running record -------------------------------------------------
  job.visits.forEach((v, vi) => {
    room(70);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(M.left, y, W, 22).fillColor('#eef2f5').fill();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY)
      .text(`Visit ${vi + 1} — ${niceDate(v.date)}`, M.left + 8, y + 6);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(v.techs.length ? v.techs.join(', ') : '', M.left, y + 7,
        { width: W - 8, align: 'right' });
    doc.y = y + 28;
    doc.fillColor(TEXT);

    if (v.statusFlag) field('Status', STATUS[v.statusFlag] ?? v.statusFlag);
    if (v.narrative) field('Summary', v.narrative);

    v.locations.forEach((l, li) => {
      room(60);
      doc.moveDown(0.35);
      const ly = doc.y;
      doc.moveTo(M.left, ly).lineTo(doc.page.width - M.right, ly)
        .lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = ly + 7;

      const heading = l.closureCode
        ?? (l.pmLocationNo ? `Location ${l.pmLocationNo}` : `Location ${li + 1}`);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT)
        .text(heading, M.left + 10, doc.y);
      const sub = [
        STRUCTURE[l.structureType ?? ''] ?? l.structureType,
        l.structureOwner,
        l.closureCode && l.pmLocationNo ? `Location ${l.pmLocationNo}` : null,
      ].filter(Boolean).join('  ·  ');
      if (sub) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
          .text(sub, M.left + 10, doc.y + 1, { width: W - 20 });
      }
      doc.moveDown(0.35);
      doc.fillColor(TEXT);

      field('Address', l.buildingAddress);
      if (l.gpsLat != null && l.gpsLng != null) {
        field('GPS', `${l.gpsLat}, ${l.gpsLng}`);
      }
      field('Enclosure', [l.enclosureModel, l.enclosureNew ? '(new)' : null]
        .filter(Boolean).join(' ') || null);
      field('Case', l.caseAction ? CASE_ACTION[l.caseAction] ?? l.caseAction : null);
      if (l.spliceCount > 0) {
        field('Splices', `${l.spliceCount} ${l.spliceType === 'ribbon' ? 'ribbon' : 'single fusion'}`);
      }
      field('Trays added', l.traysAdded);
      if (l.testFiberCount > 0) {
        field('Fibers tested', `${l.testFiberCount}${l.testType ? ` (${l.testType.toUpperCase()})` : ''}`);
      }
      field('As found', l.asFound);
      field('As built', l.asBuilt);
      field('Notes', l.narrative);

      if (l.cables.length) {
        const ft = l.cables.reduce((s, c) => s + (Number(c.footage) || 0), 0);
        subhead(`Cables${ft ? ` — ${ft.toLocaleString()} ft total` : ''}`);
        table(
          [{ head: 'Direction', w: 90 }, { head: 'Cable', w: 90 },
           { head: 'Manufacturer', w: 95 }, { head: 'Date code', w: 70 },
           { head: 'Footage', w: 60, align: 'right' }, { head: 'Role', w: 90 }],
          l.cables.map((c) => [
            c.direction ?? '', c.count ?? '', c.manufacturer ?? '',
            c.date_code ?? '', c.footage != null ? String(c.footage) : '', c.role ?? '',
          ]),
        );
      }

      if (l.ports.length) {
        subhead('Panel ports');
        table(
          [{ head: 'Panel', w: 140 }, { head: 'Port', w: 90 },
           { head: 'Position', w: 90 }, { head: 'Result', w: 90 }],
          l.ports.map((p) => [
            p.panel ?? '', p.port ?? '', p.position ?? '',
            p.pass_fail ? p.pass_fail.toUpperCase() : '',
          ]),
        );
      }

      if (l.shots.length) {
        subhead('OTDR shots');
        table(
          [{ head: 'Fiber', w: 110 }, { head: 'Direction', w: 100 },
           { head: 'Distance', w: 90, align: 'right' }, { head: 'Event', w: 190 }],
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
          [{ head: 'Hours', w: 70, align: 'right' }, { head: 'Reason', w: 380 }],
          l.downtime.map((x) => [String(x.hours ?? ''), x.reason ?? 'unspecified']),
        );
      }

      if (l.units.length) {
        subhead('Additional work');
        l.units.forEach((u) => {
          room(13);
          doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
            .text(`•  ${u}`, M.left + 10, doc.y, { width: W - 20 });
        });
        doc.moveDown(0.2);
      }
    });

    if (!v.locations.length) {
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED)
        .text('No locations recorded on this visit.', M.left + 10, doc.y);
      doc.fillColor(TEXT);
    }
  });

  if (!job.visits.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED)
      .text('No work has been recorded on this job yet.', M.left, doc.y);
  }

  footer();
}
