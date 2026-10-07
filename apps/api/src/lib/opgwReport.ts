/**
 * The OPGW customer report (0015).
 *
 * Austin's design, settled on the mockup 10/6–10/7:
 *   - header: customer, line, job numbers, dates, crew, how many structures
 *   - ONE road map of the whole line, every structure numbered
 *   - smaller close-up maps wherever pins bunch up (auto-detected)
 *   - ⛔ no map per structure ("i dont want a small map of each location")
 *   - a block per splice: GPS, type, cable count, ROW entrance, notes
 *   - a separate Test points section (T1, T2 … grey on the map)
 *   - no photos, no prices
 *
 * Same pagination rule as fieldReport.ts: measure, break if it doesn't fit,
 * THEN draw. pdfkit must be created with margin 0.
 */
import { project, spreadPins, type MapPin, type MapView } from './opgwMap.js';

export interface OpgwReportPoint {
  label: string;               // "1" / "T1"
  kind: 'splice' | 'test';
  name: string;
  testedFrom: 'structure' | 'hub' | null;
  spliceType: string;          // already a label: "2-way", or the typed Other
  cableCount: string;          // "48", or the typed Other
  lat: number | null;
  lng: number | null;
  rowLat: number | null;
  rowLng: number | null;
  rowUrl: string | null;
  notes: string | null;
  techs: string[];
  workDate: string | null;
}

export interface OpgwReportMap {
  view: MapView;
  pins: MapPin[];
  /** PNG from the map service; null draws a plain panel with the pins to scale. */
  image: Buffer | null;
  /** Main map only: the crowded spots, boxed and lettered instead of pinned. */
  groups?: { letter: string; pins: MapPin[] }[];
  title: string;
}

export interface OpgwReportModel {
  bmNumber: string;
  customerName: string;
  identifier: string | null;
  title: string | null;
  points: OpgwReportPoint[];
  main: OpgwReportMap | null;
  closeups: OpgwReportMap[];
  /** True when no map key is set — a one-line note goes under the main map. */
  noMapKey: boolean;
}

const NAVY = '#0b3d5c';
const ORANGE = '#c2410c';
const GREY = '#55657a';
const MUTED = '#6b7a88';
const LINE = '#c3ccd8';
const TEXT = '#1a2733';
const PANEL = '#eef2f6';

const M = { left: 50, right: 50, top: 46, bottom: 58 };

function niceDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${String(y).slice(2)}`;
}

function dateRange(points: OpgwReportPoint[]): string {
  const ds = points.map((p) => p.workDate).filter(Boolean).sort() as string[];
  if (!ds.length) return '—';
  const a = ds[0], b = ds[ds.length - 1];
  return a === b ? niceDate(a) : `${niceDate(a)} – ${niceDate(b)}`;
}

function crew(points: OpgwReportPoint[]): string {
  const seen = new Map<string, string>();
  for (const p of points) for (const raw of p.techs ?? []) {
    const n = String(raw).trim();
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()].join(', ') || '—';
}

function gps(lat: number | null, lng: number | null): string {
  return lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '—';
}

export function buildOpgwReport(
  doc: any,
  m: OpgwReportModel,
  opts: { logo?: Buffer | null; generatedOn: string },
) {
  const W = doc.page.width - M.left - M.right;
  const maxY = () => doc.page.height - M.bottom;
  let pageNo = 0;

  const splices = m.points.filter((p) => p.kind === 'splice');
  const tests = m.points.filter((p) => p.kind === 'test');

  function header() {
    pageNo++;
    const y = M.top;
    if (opts.logo) {
      try { doc.image(opts.logo, M.left, y, { fit: [58, 40] }); } catch { /* never break the report on a logo */ }
    } else {
      doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text('B&M Telecom, Inc.', M.left, y + 8, { lineBreak: false });
    }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(ORANGE)
      .text('OPGW SPLICE REPORT', M.left, y + 4, { width: W, align: 'right', lineBreak: false, characterSpacing: 0.6 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
      .text([m.identifier, `B&M job ${m.bmNumber}`].filter(Boolean).join('  ·  '),
        M.left, y + 22, { width: W, align: 'right', lineBreak: false });
    const rule = y + 46;
    doc.moveTo(M.left, rule).lineTo(M.left + W, rule).lineWidth(1.5).strokeColor(NAVY).stroke();
    doc.y = rule + 14;
    doc.fillColor(TEXT);
  }

  function footer() {
    const y = doc.page.height - M.bottom + 22;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`B&M Telecom, Inc.  ·  ${m.customerName}  ·  B&M ${m.bmNumber}  ·  Generated ${opts.generatedOn}`,
        M.left, y, { width: W - 60, lineBreak: false })
      .text(`Page ${pageNo}`, M.left, y, { width: W, align: 'right', lineBreak: false });
    doc.fillColor(TEXT);
  }

  function newPage() { footer(); doc.addPage(); header(); }
  function ensure(h: number) { if (doc.y + h > maxY()) newPage(); }
  function measure(text: string, font: string, size: number, width: number) {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text, { width });
  }

  /** A section heading never sits alone at the foot of a page — it takes the first block with it. */
  function heading(text: string) {
    ensure(28 + 110);
    doc.y += 6;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(text, M.left, doc.y, { width: W });
    doc.y += 4;
    doc.fillColor(TEXT);
  }

  /** A numbered pin. Splices navy, test points grey. */
  function pin(x: number, y: number, label: string, kind: 'splice' | 'test', r = 8) {
    doc.font('Helvetica-Bold').fontSize(label.length > 2 ? 6.5 : 7.5);
    const tw = doc.widthOfString(label);
    const w = Math.max(2 * r, tw + 7);
    doc.roundedRect(x - w / 2, y - r, w, 2 * r, r).fillAndStroke(kind === 'test' ? GREY : NAVY, '#ffffff');
    doc.fillColor('#ffffff').text(label, x - w / 2, y - 3.6, { width: w, align: 'center', lineBreak: false });
    doc.fillColor(TEXT);
  }

  /** One map — image (or plain panel) plus pins — inside a box. Returns nothing; draws at (x, y). */
  function drawMap(map: OpgwReportMap, x: number, y: number, w: number, h: number) {
    const k = w / map.view.width;
    doc.save();
    doc.roundedRect(x, y, w, h, 6).clip();
    if (map.image) {
      try { doc.image(map.image, x, y, { width: w, height: h }); }
      catch { doc.rect(x, y, w, h).fill(PANEL); }
    } else {
      doc.rect(x, y, w, h).fill(PANEL);
    }

    // the line, in work order, dashed — it is the route of the pins, not a survey of the cable
    const xy = map.pins.map((p) => {
      const q = project(map.view, p.lat, p.lng);
      return { x: x + q.x * k, y: y + q.y * k };
    });
    const splicePts = xy.filter((_, i) => map.pins[i].kind === 'splice');
    if (splicePts.length > 1) {
      doc.moveTo(splicePts[0].x, splicePts[0].y);
      for (const p of splicePts.slice(1)) doc.lineTo(p.x, p.y);
      doc.lineWidth(1.6).dash(5, { space: 4 }).strokeColor(NAVY).strokeOpacity(0.8).stroke().undash().strokeOpacity(1);
    }

    // crowded spots on the main map: a dashed box and a letter, no pins
    const grouped = new Set<MapPin>();
    for (const g of map.groups ?? []) {
      const pts = g.pins.map((p) => { grouped.add(p); const q = project(map.view, p.lat, p.lng); return { x: x + q.x * k, y: y + q.y * k }; });
      const bx0 = Math.min(...pts.map((p) => p.x)) - 11, bx1 = Math.max(...pts.map((p) => p.x)) + 11;
      const by0 = Math.min(...pts.map((p) => p.y)) - 11, by1 = Math.max(...pts.map((p) => p.y)) + 11;
      doc.roundedRect(bx0, by0, bx1 - bx0, by1 - by0, 4).fillOpacity(0.85).fill('#ffffff').fillOpacity(1);
      doc.roundedRect(bx0, by0, bx1 - bx0, by1 - by0, 4).lineWidth(1.6).dash(3, { space: 2 }).strokeColor(ORANGE).stroke().undash();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(ORANGE)
        .text(g.letter, bx0, (by0 + by1) / 2 - 5, { width: bx1 - bx0, align: 'center', lineBreak: false });
    }

    // pins — spread any that still sit on top of each other, with a tick back to the true spot
    const free = map.pins.map((p, i) => ({ p, at: xy[i] })).filter((o) => !grouped.has(o.p));
    const spread = spreadPins(free.map((o) => o.at), 19);
    free.forEach((o, i) => {
      const s = spread[i];
      if (Math.hypot(s.x - o.at.x, s.y - o.at.y) > 1) {
        doc.moveTo(o.at.x, o.at.y).lineTo(s.x, s.y).lineWidth(1).strokeColor(TEXT).stroke();
        doc.circle(o.at.x, o.at.y, 2).fill(TEXT);
      }
    });
    free.forEach((o, i) => pin(spread[i].x, spread[i].y, o.p.label, o.p.kind));
    doc.restore();
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor(LINE).stroke();
  }

  // ======================= page 1 ==========================================
  header();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(TEXT).text(m.customerName || 'OPGW report', M.left, doc.y, { width: W });
  if (m.title) doc.font('Helvetica').fontSize(11).fillColor(TEXT).text(m.title, M.left, doc.y + 2, { width: W });
  doc.y += 8;

  // info grid: four columns
  const cells: [string, string][] = [
    ['Customer job #', m.identifier || '—'],
    ['B&M job #', m.bmNumber],
    ['Dates', dateRange(m.points)],
    ['Structures', `${splices.length} splice${splices.length === 1 ? '' : 's'} · ${tests.length} test point${tests.length === 1 ? '' : 's'}`],
  ];
  const cw = W / 4;
  const gy = doc.y;
  cells.forEach(([l, v], i) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(l.toUpperCase(), M.left + i * cw, gy, { width: cw - 8, characterSpacing: 0.4 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(v, M.left + i * cw, gy + 11, { width: cw - 8 });
  });
  doc.y = gy + 30;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('CREW', M.left, doc.y, { characterSpacing: 0.4 });
  doc.font('Helvetica').fontSize(10).fillColor(TEXT).text(crew(m.points), M.left, doc.y + 1, { width: W });
  doc.y += 8;

  // ---- Map 1 ----
  if (m.main) {
    const mh = W * (m.main.view.height / m.main.view.width);
    ensure(mh + 34);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(m.main.title, M.left, doc.y, { width: W });
    doc.y += 3;
    const top = doc.y;
    drawMap(m.main, M.left, top, W, mh);
    doc.y = top + mh + 4;
    const notes: string[] = [];
    if (m.main.groups?.length) notes.push(`Orange boxes ${m.main.groups.map((g) => g.letter).join(', ')} are structures close together — shown up close below.`);
    if (m.noMapKey) notes.push('Street map not set up yet — pins are drawn to scale on a blank background.');
    if (notes.length) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(notes.join('  '), M.left, doc.y, { width: W });
    }
    doc.y += 8;
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No GPS recorded on this job yet, so there is no map.', M.left, doc.y, { width: W });
    doc.y += 8;
  }

  // ---- close-ups, two to a row ----
  if (m.closeups.length) {
    const gap = 14;
    const bw = (W - gap) / 2;
    for (let i = 0; i < m.closeups.length; i += 2) {
      const row = m.closeups.slice(i, i + 2);
      const bh = bw * (row[0].view.height / row[0].view.width);
      const capH = Math.max(...row.map((c) => measure(c.title, 'Helvetica-Bold', 9.5, bw)));
      ensure(capH + bh + 12);
      const top = doc.y;
      row.forEach((c, j) => {
        const x = M.left + j * (bw + gap);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT).text(c.title, x, top, { width: bw });
        drawMap(c, x, top + capH + 3, bw, bh);
      });
      doc.y = top + capH + 3 + bh + 12;
    }
  }

  // ---- structures ----
  function block(p: OpgwReportPoint) {
    const title = p.kind === 'test' && p.testedFrom === 'hub' ? p.name : `Structure ${p.name}`;
    const meta = [niceDate(p.workDate), (p.techs ?? []).join(', ')].filter(Boolean).join('  ·  ');
    const notesH = p.notes ? measure(p.notes, 'Helvetica', 9.5, W - 28) + 4 : 0;
    const h = 22 + 30 + (meta ? 13 : 0) + notesH + 10;
    ensure(h + 8);
    const top = doc.y;
    doc.roundedRect(M.left, top, W, h, 6).lineWidth(0.8).strokeColor(LINE).fillAndStroke(p.kind === 'test' ? '#f7f8fa' : '#ffffff', LINE);
    pin(M.left + 22, top + 17, p.label, p.kind, 10);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT).text(title, M.left + 40, top + 10, { width: W - 52, lineBreak: false });

    const cols: [string, string, string?][] = p.kind === 'splice'
      ? [['GPS', gps(p.lat, p.lng)], ['Type', p.spliceType || '—'], ['Cable count', p.cableCount || '—'],
         ['ROW entrance', p.rowUrl ? 'Get directions' : '—', p.rowUrl ?? undefined]]
      : [['GPS', gps(p.lat, p.lng)], ['Tested from', p.testedFrom === 'hub' ? 'Hub' : 'Structure'], ['', ''], ['', '']];
    const widths = [0.38, 0.2, 0.18, 0.24].map((f) => f * (W - 28));
    let x = M.left + 14;
    const cy = top + 34;
    cols.forEach(([l, v, link], i) => {
      if (l) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(l.toUpperCase(), x, cy, { width: widths[i] - 6, characterSpacing: 0.4, lineBreak: false });
        doc.font(i === 0 ? 'Courier' : 'Helvetica-Bold').fontSize(i === 0 ? 9.5 : 10)
          .fillColor(link ? NAVY : TEXT)
          .text(v, x, cy + 11, { width: widths[i] - 6, lineBreak: false, ...(link ? { link, underline: true } : {}) });
      }
      x += widths[i];
    });
    let ny = cy + 30;
    if (p.kind === 'splice' && p.rowLat != null && p.rowLng != null) {
      // the entrance coordinates in small print too — a link does not survive being printed
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(gps(p.rowLat, p.rowLng), M.left + 14 + widths[0] + widths[1] + widths[2], cy + 23, { width: widths[3] - 6, lineBreak: false });
    }
    if (meta) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(meta, M.left + 14, ny, { width: W - 28, lineBreak: false });
      ny += 13;
    }
    if (p.notes) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#33415a').text(p.notes, M.left + 14, ny, { width: W - 28 });
    }
    doc.y = top + h + 8;
    doc.fillColor(TEXT);
  }

  if (splices.length) {
    heading('Structures');
    splices.forEach(block);
  }
  if (tests.length) {
    heading('Test points');
    tests.forEach(block);
  }
  if (!m.points.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('No structures have been logged on this job yet.', M.left, doc.y, { width: W });
  }

  footer();
}
