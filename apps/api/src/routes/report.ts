import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { admin } from '../supabase.js';
import { getExportCaller } from '../lib/automation.js';
import { buildFieldReport, type ReportJob } from '../lib/fieldReport.js';
import { EXTRA_UNIT_LABELS } from '../lib/unitLabels.js';

export const report = Router();

const LOGO = fileURLToPath(new URL('../../assets/logo.png', import.meta.url));

function safeFilename(s: string) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

/**
 * GET /jobs/:id/report.pdf — the customer's record of work.
 *
 * Any active user. Carries NO prices; it's the documentation package that goes
 * out alongside the invoice, and the crew's own record of what they did.
 */
report.get('/jobs/:id/report.pdf', async (req, res) => {
  // Techs too, since 8/27. This document carries NO prices - it is the record
  // of work that goes to the customer - and a splicer needs to be able to pull
  // up what was done at a hole he is standing in. Dollars stay office/admin on
  // the rate card route and behind RLS on invoice_drafts.
  const caller = await getExportCaller(req, ['office', 'admin', 'tech']);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { data: job } = await admin
      .from('jobs')
      .select('id, bm_number, identifier, identifier_type, title, billing_mode, status, customer:customers(name)')
      .eq('id', req.params.id).single();
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { data: visits } = await admin
      .from('visits')
      .select(`
        id, visit_date, report_type, techs, narrative, status_flag,
        locations(
          id, pm_location_no, job_location_no, revisit_of,
          techs, structure_type, structure_owner, building_address,
          gps_lat, gps_lng, enclosure_new, enclosure_model, case_action,
          splice_type, splice_count, trays_added, test_fiber_count, test_type,
          as_found, as_built, narrative, ordinal,
          closures(closure_code),
          cables(direction, count, manufacturer, date_code, footage, role, ordinal),
          shots(fiber_group, direction, distance_km, event, ordinal),
          panel_ports(panel, port, position, pass_fail, ordinal),
          downtime(hours, reason, ordinal),
          location_units(unit_code, qty, note, ordinal)
        )
      `)
      .eq('job_id', req.params.id)
      .order('visit_date', { ascending: true });

    const byOrd = (x: any[]) => [...(x ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));

    const model: ReportJob = {
      bmNumber: job.bm_number,
      customerName: (job as any).customer?.name ?? null,
      identifier: job.identifier,
      identifierType: job.identifier_type,
      title: job.title,
      billingMode: job.billing_mode,
      status: job.status,
      visits: ((visits as any[]) ?? []).map((v) => ({
        date: v.visit_date ?? null,
        techs: (v.techs ?? []) as string[],
        reportType: v.report_type ?? null,
        statusFlag: v.status_flag ?? null,
        narrative: v.narrative ?? null,
        locations: byOrd(v.locations).map((l: any) => ({
          closureCode: l.closures?.closure_code ?? null,
          pmLocationNo: l.pm_location_no ?? null,
          // B&M's job-wide number and whether this block is a return trip. Both
          // come straight from the row — the report never computes a number,
          // which is how two blocks ended up headed "Location 1" before 8/31.
          jobLocationNo: l.job_location_no ?? null,
          isRevisit: l.revisit_of != null,
          techs: (Array.isArray(l.techs) && l.techs.length ? l.techs : (v.techs ?? [])) as string[],
          structureType: l.structure_type ?? null,
          structureOwner: l.structure_owner ?? null,
          buildingAddress: l.building_address ?? null,
          gpsLat: l.gps_lat != null ? Number(l.gps_lat) : null,
          gpsLng: l.gps_lng != null ? Number(l.gps_lng) : null,
          enclosureModel: l.enclosure_model ?? null,
          enclosureNew: !!l.enclosure_new,
          caseAction: l.case_action ?? null,
          spliceType: l.splice_type ?? null,
          spliceCount: Number(l.splice_count ?? 0),
          traysAdded: Number(l.trays_added ?? 0),
          testFiberCount: Number(l.test_fiber_count ?? 0),
          testType: l.test_type ?? null,
          asFound: l.as_found ?? null,
          asBuilt: l.as_built ?? null,
          narrative: l.narrative ?? null,
          cables: byOrd(l.cables),
          shots: byOrd(l.shots),
          ports: byOrd(l.panel_ports),
          downtime: byOrd(l.downtime),
          // plain-English labels; the customer never sees our unit codes
          units: byOrd(l.location_units).map((u: any) => {
            const label = EXTRA_UNIT_LABELS[u.unit_code] ?? u.unit_code;
            const qty = Number(u.qty ?? 1);
            return `${label}${qty !== 1 ? ` × ${qty}` : ''}${u.note ? ` — ${u.note}` : ''}`;
          }),
        })),
      })),
    };

    const logo = await readFile(LOGO).catch(() => null);
    const generatedOn = new Date().toISOString().slice(0, 10);

    // margin MUST be 0. pdfkit treats the margin as a hard boundary and
    // silently starts a new page the moment anything is written below it — the
    // footer sits below any non-zero margin, so every footer spawned a blank
    // page and the page number on it spawned another. fieldReport.ts does all
    // its own margins and pagination; pdfkit must not second-guess it.
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    doc.addPage();
    buildFieldReport(doc, model, { logo, generatedOn });
    doc.end();

    const out = await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${safeFilename(job.bm_number)}-field-report.pdf"`);
    res.setHeader('Content-Length', String(out.length));
    return res.end(out);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'report generation failed' });
  }
});
