import { Router } from 'express';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { RATE_CARD, type RateUnit } from '@bm/billing';
import { admin, getCaller } from '../supabase.js';

export const rateCard = Router();

// The customer's own rate card, committed as-is. We only ever WRITE the Quantity
// column — every rate, formula, row order and bit of formatting is theirs.
// This path resolves the same from src/ (tsx dev) and dist/ (built): both are two
// levels under apps/api.
const TEMPLATE = fileURLToPath(new URL('../../assets/rate-card-template.xlsx', import.meta.url));

// Sheet layout (row 4 is the header: Unit# | Section | Assembly Unit | UOM | …
// | Total Per Unit | Quantity | Extended). Rows 1-2 are blank and rows 3+ are
// the customer's; we stamp only rows 1-2 and write only column K.
const SHEET = 'Rate Card';
const FIRST_DATA_ROW = 5;
const COL_UNIT_NO = 1;
const COL_QTY = 11;       // K — the only input column we touch
const COL_TOTAL_UNIT = 10; // J — the card's own "Total Per Unit" formula
const COL_EXTENDED = 12;  // L — =J*K

/** rate_card.code → the customer's Unit# on the sheet, and back again. */
const UNIT_NO_BY_CODE = new Map<string, number>(
  Object.values(RATE_CARD).map((u: RateUnit) => [u.code, u.unitNo]),
);
const CODE_BY_UNIT_NO = new Map<number, string>(
  Object.values(RATE_CARD).map((u: RateUnit) => [u.unitNo, u.code]),
);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Update a formula cell's cached answer WITHOUT removing the formula.
 * Excel stores both: the formula it recalculates from, and the last value it
 * computed (which is what actually renders before a recalc). Blow the cached
 * value away and the cell looks empty — that's the bug this avoids.
 */
function setFormulaResult(cell: ExcelJS.Cell, result: number) {
  const v: any = cell.value;
  if (v && typeof v === 'object' && 'formula' in v) {
    cell.value = { formula: v.formula, result } as any;
  } else if (v && typeof v === 'object' && 'sharedFormula' in v) {
    cell.value = { sharedFormula: v.sharedFormula, result } as any;
  } else {
    cell.value = result;
  }
}

/** Keep the quantity cell tidy — 48 stays 48, not 47.999999. */
function round4(n: number) {
  const r = Math.round(n * 10000) / 10000;
  return Math.abs(r - Math.round(r)) < 0.0005 ? Math.round(r) : r;
}

function safeFilename(s: string) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

/**
 * GET /jobs/:id/invoice.xlsx — the priced draft laid onto the customer's full
 * rate card. Office/admin only (it's all dollars).
 *
 * Quantities are filled in ONLY for the units the field app actually captures.
 * Every other row comes back blank and fully editable — the office types a
 * quantity on any row and the sheet's own Extended/TOTAL formulas do the rest.
 */
rateCard.get('/jobs/:id/invoice.xlsx', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin')
    return res.status(403).json({ error: 'forbidden' });

  try {
    const { data: job } = await admin
      .from('jobs')
      .select('bm_number, identifier, title, billing_mode, maint_window, customer:customers(name)')
      .eq('id', req.params.id).single();
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { data: draft } = await admin
      .from('invoice_drafts')
      .select('id, generated_at, total')
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
    // DOLLAR AMOUNT is what goes in the Quantity column (downtime, traffic
    // control, trip charge). Our engine bills those at a real hourly rate, so
    // writing the hours there would bill $2.00 instead of $250.00. Whenever the
    // billed rate doesn't match the card's unit rate, put the dollars in the
    // quantity cell so the sheet's own Extended formula lands on the right money.
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
      const forSheet = rateMatches || !card.rate
        ? quantity
        : round4(extended / card.rate);   // ACTUAL row → the dollars

      qtyByUnitNo.set(unitNo, round4((qtyByUnitNo.get(unitNo) ?? 0) + forSheet));
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(TEMPLATE);
    const ws = wb.getWorksheet(SHEET);
    if (!ws) throw new Error(`template is missing the "${SHEET}" sheet`);

    // Fill the Quantity column, and refresh the cached answer on the Extended
    // formula next to it. Every formula in the workbook STAYS a formula — we
    // just store its current value alongside, otherwise Excel shows the cell
    // blank until the user forces a recalculation. Edit a quantity by hand and
    // the formula recalculates normally.
    let filled = 0;
    let runningTotal = 0;
    for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const unitNo = row.getCell(COL_UNIT_NO).value;
      if (typeof unitNo !== 'number') continue;

      const qty = qtyByUnitNo.get(unitNo);
      if (qty == null || qty === 0) continue;

      row.getCell(COL_QTY).value = qty;

      // the card's Total Per Unit is a formula; our own rate card holds the
      // same number, so use it rather than trying to evaluate the sheet
      const code = CODE_BY_UNIT_NO.get(unitNo);
      const unitRate = code ? RATE_CARD[code]?.rate ?? 0 : 0;
      const extended = round2(unitRate * qty);
      runningTotal += extended;

      // J (Total Per Unit) and I (Tax) don't depend on quantity — their cached
      // values come through from the template untouched.
      setFormulaResult(row.getCell(COL_EXTENDED), extended);
      filled++;
    }

    // the sheet's TOTAL row (=SUM of the Extended column) needs the same treatment
    for (let r = ws.rowCount; r >= FIRST_DATA_ROW; r--) {
      const label = ws.getRow(r).getCell(COL_TOTAL_UNIT).value;
      if (typeof label === 'string' && label.trim().toUpperCase() === 'TOTAL') {
        setFormulaResult(ws.getRow(r).getCell(COL_EXTENDED), round2(runningTotal));
        break;
      }
    }

    // stamp the job on the two blank rows above the header (nothing is overwritten)
    const customerName = (job as any).customer?.name ?? '';
    ws.getCell('A1').value =
      `B&M Job ${job.bm_number}${customerName ? ` — ${customerName}` : ''}` +
      `${job.identifier ? ` — ${job.identifier}` : ''}${job.title ? ` — ${job.title}` : ''}`;
    let note =
      `${job.billing_mode === 'emergency' ? 'Emergency / LOR (hourly)' : 'Capital (per unit)'}` +
      `${job.maint_window ? ' · scheduled maintenance window' : ''}` +
      ` · quantities from the field app, ${filled} unit(s) filled` +
      ` · generated ${new Date().toISOString().slice(0, 10)}` +
      ` · blank rows are yours to fill in`;
    // never silently drop money — if a billed code isn't on this rate card, say so
    if (unmapped.length) {
      note += `  ⚠ NOT ON THIS RATE CARD, ADD BY HAND: ${[...new Set(unmapped)].join(', ')}`;
    }
    ws.getCell('A2').value = note;

    const filename = `${safeFilename(job.bm_number)}-rate-card.xlsx`;
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'rate card export failed' });
  }
});
