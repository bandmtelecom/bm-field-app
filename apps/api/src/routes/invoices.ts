import { Router } from 'express';
import { computeInvoice } from '@bm/billing';
import { admin, getCaller } from '../supabase.js';
import { loadJobInput } from '../mapJob.js';

export const invoices = Router();

/**
 * POST /jobs/:id/invoice — mark-complete hook. Generates a draft invoice from
 * every captured unit on the job and stores it. Any active user may trigger it
 * (a tech taps "Mark job complete"), but the RESPONSE carries NO dollars — the
 * office reads the priced draft separately (RLS lets office/admin see it).
 */
invoices.post('/jobs/:id/invoice', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });

  const jobId = req.params.id;
  try {
    const jobInput = await loadJobInput(jobId);
    const draft = computeInvoice(jobInput);

    // close the job + upsert a fresh draft (void any prior draft for this job)
    await admin.from('jobs')
      .update({ status: 'complete', completed_at: new Date().toISOString(), completed_by: caller.id })
      .eq('id', jobId);
    await admin.from('invoice_drafts')
      .update({ status: 'void' }).eq('job_id', jobId).eq('status', 'draft');

    const { data: draftRow, error: dErr } = await admin
      .from('invoice_drafts')
      .insert({
        job_id: jobId, status: 'draft', billing_mode: draft.billingMode,
        subtotal: draft.subtotal, total: draft.total, generated_by: caller.id,
      })
      .select('id').single();
    if (dErr || !draftRow) throw dErr ?? new Error('draft insert failed');

    if (draft.lines.length) {
      const rows = draft.lines.map((l, i) => ({
        draft_id: draftRow.id, unit_code: l.unitCode, description: l.description,
        quantity: l.quantity, rate: l.rate, extended: l.extended, source: l.source, ordinal: i,
      }));
      const { error: lErr } = await admin.from('invoice_lines').insert(rows);
      if (lErr) throw lErr;
    }

    // office/admin get the number back; techs get only a confirmation.
    const isOffice = caller.role === 'office' || caller.role === 'admin';
    return res.json({
      ok: true, status: 'drafted', draftId: draftRow.id,
      lineCount: draft.lines.length,
      ...(isOffice ? { subtotal: draft.subtotal, total: draft.total } : {}),
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'invoice generation failed' });
  }
});

/**
 * GET /jobs/:id/invoice — office/admin only: fetch the current priced draft.
 */
invoices.get('/jobs/:id/invoice', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin')
    return res.status(403).json({ error: 'forbidden' });

  const { data: draft } = await admin
    .from('invoice_drafts')
    .select('id, status, billing_mode, subtotal, total, generated_at')
    .eq('job_id', req.params.id).eq('status', 'draft')
    .order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (!draft) return res.status(404).json({ error: 'no draft' });

  const { data: lines } = await admin
    .from('invoice_lines')
    .select('unit_code, description, quantity, rate, extended, source')
    .eq('draft_id', draft.id).order('ordinal', { ascending: true });

  return res.json({ draft, lines: lines ?? [] });
});

/**
 * POST /jobs/:id/reopen — put a closed job back on the crew's roster.
 *
 * Closing a job was a one-way door in the app: the buttons vanish and the only
 * way back was Austin running SQL by hand. That is a bad place to be with a
 * crew learning the app, and it already cost us on 26-350. Office/admin only —
 * a tech should not be able to reopen a job the office has closed out.
 *
 * The draft invoice is VOIDED rather than deleted: it is the record of what was
 * billed at that moment, and marking the job complete again builds a fresh one
 * from whatever is on the job by then.
 */
invoices.post('/jobs/:id/reopen', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin') {
    return res.status(403).json({ error: 'the office reopens jobs' });
  }

  const jobId = req.params.id;
  try {
    const { data: job } = await admin
      .from('jobs').select('id, status, bm_number').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (job.status === 'invoiced') {
      return res.status(400).json({
        error: 'That job has already been invoiced — talk to the office before reopening it.',
      });
    }

    await admin.from('jobs')
      .update({ status: 'reopened', completed_at: null, completed_by: null })
      .eq('id', jobId);

    const { data: voided } = await admin.from('invoice_drafts')
      .update({ status: 'void' })
      .eq('job_id', jobId).eq('status', 'draft')
      .select('id');

    return res.json({
      ok: true,
      status: 'reopened',
      draftsVoided: (voided ?? []).length,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'could not reopen the job' });
  }
});

/**
 * POST /jobs/:id/invoiced — the job has been billed and sent to the customer.
 *
 * Moves it off the crew's working list and into the Archive. Office/admin only:
 * a tech should never be deciding that a job is billed.
 *
 * The draft is marked 'sent' rather than left as 'draft' so the record says what
 * actually happened to it. Nothing is deleted — the whole point of the Archive
 * is being able to go back and look.
 */
invoices.post('/jobs/:id/invoiced', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin') {
    return res.status(403).json({ error: 'the office marks jobs invoiced' });
  }

  const jobId = req.params.id;
  try {
    const { data: job } = await admin
      .from('jobs').select('id, status, bm_number').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'job not found' });

    if (job.status === 'invoiced') {
      return res.status(400).json({ error: 'That job is already in the Archive.' });
    }
    // Billing a job nobody has closed out means billing work the crew may not
    // have finished writing up. Make them close it first.
    if (job.status !== 'complete') {
      return res.status(400).json({
        error: 'Mark the job complete first — an open job has no finished invoice to send.',
      });
    }

    await admin.from('jobs')
      .update({
        status: 'invoiced',
        invoiced_at: new Date().toISOString(),
        invoiced_by: caller.id,
      })
      .eq('id', jobId);

    const { data: sent } = await admin.from('invoice_drafts')
      .update({ status: 'sent' })
      .eq('job_id', jobId).eq('status', 'draft')
      .select('id');

    return res.json({ ok: true, status: 'invoiced', draftsMarkedSent: (sent ?? []).length });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'could not mark the job invoiced' });
  }
});

/**
 * POST /jobs/:id/unarchive — pull a job back out of the Archive.
 *
 * Same reasoning as job reopen: a one-way door that can only be undone by
 * running SQL is a bad door. Billing the wrong job is an easy mistake and the
 * fix should not require Austin.
 */
invoices.post('/jobs/:id/unarchive', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'office' && caller.role !== 'admin') {
    return res.status(403).json({ error: 'the office manages the archive' });
  }

  const jobId = req.params.id;
  try {
    const { data: job } = await admin
      .from('jobs').select('id, status').eq('id', jobId).single();
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (job.status !== 'invoiced') {
      return res.status(400).json({ error: 'That job is not in the Archive.' });
    }

    await admin.from('jobs')
      .update({ status: 'complete', invoiced_at: null, invoiced_by: null })
      .eq('id', jobId);

    // Put the draft back the way it was so the job looks exactly as it did
    // before it was archived.
    await admin.from('invoice_drafts')
      .update({ status: 'draft' })
      .eq('job_id', jobId).eq('status', 'sent');

    return res.json({ ok: true, status: 'complete' });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? 'could not unarchive the job' });
  }
});
