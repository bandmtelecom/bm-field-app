import { Router } from 'express';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RATE_CARD, type RateUnit } from '@bm/billing';
import { admin, getCaller } from '../supabase.js';
import {
  patchQuantities, forceFullRecalc, stripCalcChainRel, stripCalcChainContentType,
} from '../lib/xlsxPatch.js';

export const rateCard = Router();

/**
 * The customer's rate card, exported with our quantities filled in.
 * The XML surgery lives in ../lib/xlsxPatch.ts — see the note there on why we
 * never rebuild the workbook.
 */

const TEMPLATE = fileURLToPath(new URL('../../assets/rate-card-template.xlsx', import.meta.url));

const SHEET_NAME = 'Rate Card';
const UNIT_NO_BY_CODE = new Map<string, number>(
  Object.values(RATE_CARD).map((u: RateUnit) => [u.code, u.unitNo]),
);
const CODE_BY_UNIT_NO = new Map<number, string>(
  Object.values(RATE_CARD).map((u: RateUnit) => [u.unitNo, u.code]),
);

const round4 = (n: number) => {
  const r = Math.round(n * 10000) / 10000;
  return Math.abs(r - Math.round(r)) < 0.0005 ? Math.round(r) : r;
};
function safeFilename(s: string) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

/** Which worksheet part is the "Rate Card" tab? Follow workbook.xml → rels. */
async function findSheetPath(zip: JSZip): Promise<string> {
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (wb && rels) {
    const sheet = new RegExp(`<sheet[^>]*name="${SHEET_NAME}"[^>]*>`, 'i').exec(wb);
    const rid = sheet && /r:id="([^"]+)"/.exec(sheet[0])?.[1];
    if (rid) {
      const rel = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`).exec(rels);
      const target = rel && /Target="([^"]+)"/.exec(rel[0])?.[1];
      if (target) return `xl/${target.replace(/^\/?xl\//, '')}`;
    }
  }
  return 'xl/worksheets/sheet1.xml';
}





/**
 * GET /jobs/:id/invoice.xlsx — the priced draft on the customer's own rate card.
 * Office/admin only (it's all dollars).
 */
rateCard.get('/jobs/:id/invoice.xlsx', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin')
    return res.status(403).json({ error: 'forbidden' });

  try {
    const { data: job } = await admin
      .from('jobs')
      .select('bm_number, identifier, title, billing_mode, maint_window, scheduled_ahead, customer:customers(name)')
      .eq('id', req.params.id).single();
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { data: draft } = await admin
      .from('invoice_drafts')
      .select('id, generated_at')
      .eq('job_id', req.params.id).eq('status', 'draft')
      .order('generated_at', { ascending: false }).limit(1).maybeSingle();
    if (!draft) return res.status(404).json({ error: 'no draft — mark the job complete first' });

    const { data: lines } = await admin
      .from('invoice_lines')
      .select('unit_code, quantity, rate, extended')
      .eq('draft_id', draft.id);

    // Roll every line up to one quantity per rate-card unit.
    //
    // Careful: rows the card prices as "ACTUAL" sit at $1.00 per unit — the
    // DOLLAR AMOUNT goes in the Quantity column (unit 76 downtime, 251 traffic
    // control, 252 trip charge). Our engine bills those at a real hourly rate,
    // so writing the hours would bill $6.00 instead of $750.00. Whenever the
    // billed rate doesn't match the card's unit rate, put the dollars in the
    // quantity cell so the sheet's own formula lands on the right money.
    const qtyByUnitNo = new Map<number, number>();
    const unmapped: string[] = [];
    for (const l of lines ?? []) {
      const code = (l as any).unit_code as string | null;
      if (!code) continue;
      const unitNo = UNIT_NO_BY_CODE.get(code);
      const card = RATE_CARD[code];
      if (unitNo == null || !card) { unmapped.push(code); continue; }

      const billedRate = Number((l as any).rate ?? 0);
      const quantity = Number((l as any).quantity ?? 0);
      const extended = Number((l as any).extended ?? 0);
      const rateMatches = Math.abs(billedRate - card.rate) < 0.005;
      const forSheet = rateMatches || !card.rate ? quantity : round4(extended / card.rate);

      qtyByUnitNo.set(unitNo, round4((qtyByUnitNo.get(unitNo) ?? 0) + forSheet));
    }

    // ---- patch the workbook ----
    const zip = await JSZip.loadAsync(await readFile(TEMPLATE));
    const sheetPath = await findSheetPath(zip);
    let sheetXml = await zip.file(sheetPath)!.async('string');

    const { xml, missingUnitNos } = patchQuantities(
      sheetXml,
      qtyByUnitNo,
      (unitNo) => RATE_CARD[CODE_BY_UNIT_NO.get(unitNo) ?? '']?.rate ?? 0,
    );
    sheetXml = xml;
    for (const n of missingUnitNos) unmapped.push(CODE_BY_UNIT_NO.get(n) ?? `unit ${n}`);

    // NO stamp, no cosmetic edits: the file must look exactly like the one the
    // customer supplied. The job identity rides in the filename.
    if (unmapped.length) {
      res.setHeader('X-BM-Unmapped-Units', [...new Set(unmapped)].join(','));
    }

    zip.file(sheetPath, sheetXml);

    // Force a genuine full recalculation so Excel never flags our injected
    // values as STALE (its stale-value formatting draws what looks exactly like
    // a strikethrough through every formula cell). Needs all three of these
    // together — fullCalcOnLoad on its own makes it worse. Verified against the
    // customer's Excel 8/19.
    const CALC_CHAIN = 'xl/calcChain.xml';
    zip.remove(CALC_CHAIN);
    const relsPath = 'xl/_rels/workbook.xml.rels';
    const rels = await zip.file(relsPath)?.async('string');
    if (rels) zip.file(relsPath, stripCalcChainRel(rels));
    const ctPath = '[Content_Types].xml';
    const ct = await zip.file(ctPath)?.async('string');
    if (ct) zip.file(ctPath, stripCalcChainContentType(ct));
    const wbPath = 'xl/workbook.xml';
    const wb = await zip.file(wbPath)?.async('string');
    if (wb) zip.file(wbPath, forceFullRecalc(wb));

    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const filename = `${safeFilename(job.bm_number)}-rate-card.xlsx`;
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(out.length));
    return res.end(out);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'rate card export failed' });
  }
});
