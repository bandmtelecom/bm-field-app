-- ---------------------------------------------------------------------------
-- Archive: record WHEN a job was invoiced, and by whom.
--
-- `jobs.status` already allowed 'invoiced' from day one, the jobs list already
-- filtered it out, and reopen already refused to touch one — but nothing in the
-- app ever SET it. So every job B&M has ever completed stays on the crew's
-- board forever, indistinguishable from live work.
--
-- Austin's shape (8/27): mark a job invoiced, it drops off the working list and
-- lands in an Archive tab. Everyone can see the Archive — techs included, so a
-- splicer can pull up what he did at a hole last month — but the dollars stay
-- office/admin, enforced by RLS on invoice_drafts, not by hiding a button.
--
-- WHY A TIMESTAMP AND NOT JUST THE STATUS: the point of the archive is that at
-- month end or year end Austin pulls "everything invoiced in September" off to
-- the office network. Without a date there is nothing to filter on and the
-- archive becomes a pile.
--
-- Safe to run on a live database: adds two nullable columns, changes no rows.
-- ---------------------------------------------------------------------------

alter table jobs
  add column if not exists invoiced_at timestamptz,
  add column if not exists invoiced_by uuid references profiles(id);

-- Archive listings are always "invoiced, newest first". Without this the list
-- gets slower every month for the rest of the company's life.
create index if not exists jobs_invoiced_at_idx
  on jobs (invoiced_at desc)
  where status = 'invoiced';

comment on column jobs.invoiced_at is
  'When the office marked this job invoiced and sent it to the customer. Drives the Archive tab and month/year-end export. Null until then.';
comment on column jobs.invoiced_by is
  'Which admin/office user marked it invoiced.';
