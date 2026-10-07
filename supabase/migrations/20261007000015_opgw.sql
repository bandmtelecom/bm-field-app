-- ============================================================================
-- B&M Field App — 0015 OPGW jobs
-- Run this in the Supabase SQL editor BEFORE pushing the code. Safe to run twice.
--
-- WHY (Austin, 10/6–10/7):
-- "We got lumens figured out and it's working great. OPGW is much more simple.
--  I don't need you to punch out an invoice for me because all these jobs are
--  pre-bid ahead of time."
--
-- An OPGW job is a list of structures on a transmission line. Each one is a
-- SPLICE (structure #, GPS, optional ROW-entrance GPS, 2-way/3-way/transition/
-- termination/other, cable count 48/96/144/other, notes) or a TEST POINT
-- (tested from a structure or a hub, name, GPS, notes). The report is a map of
-- the line plus a block per structure. Nothing bills.
--
-- None of this touches the Lumen side. OPGW structures live in their own table
-- so the billing engine, the closure registry and the location numbering never
-- see them — an OPGW job cannot put a dollar on an invoice because there is no
-- path from opgw_points to invoice_lines.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) what kind of job
-- Every job before today is fiber (Lumen and the rest). OPGW is picked when
-- the office creates the job.
-- ---------------------------------------------------------------------------
alter table jobs add column if not exists job_kind text not null default 'fiber';
do $$ begin
  alter table jobs add constraint jobs_job_kind_check check (job_kind in ('fiber','opgw'));
exception when duplicate_object then null; end $$;
comment on column jobs.job_kind is
  'fiber = the Lumen-style running record that bills; opgw = structure list + map report, never invoiced (0015).';

-- "Other" customer: the office types the name when it creates the job.
-- Austin: "keep a spot for other and let us fill it in when we create the job".
alter table jobs add column if not exists customer_other text;
comment on column jobs.customer_other is
  'The customer name typed when the job''s customer is "Other" (0015). Shown in place of "Other" everywhere.';

-- ---------------------------------------------------------------------------
-- 2) the OPGW customer list, in Austin's order (10/7)
-- Primoris, Michels, Irby, Oncor, Burns & McDonnell, SEC, Dashiell, Northstar,
-- Other. A customer that is already in the table (Primoris, maybe Oncor and
-- Burns & McDonnell from the original seed) is reused, never duplicated.
-- ---------------------------------------------------------------------------
alter table customers add column if not exists opgw_order int;
comment on column customers.opgw_order is
  'Position in the OPGW customer dropdown (0015). Null = not offered on OPGW jobs.';

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      (1, 'Primoris',          'Primoris'),
      (2, 'Michels',           'Michels'),
      (3, 'Irby',              'Irby'),
      (4, 'Oncor',             'Oncor'),
      (5, 'Burns & McDonnell', 'BurnsMcD'),
      (6, 'SEC',               'SEC'),
      (7, 'Dashiell',          'Dashiell'),
      (8, 'Northstar',         'Northstar'),
      (9, 'Other',             'Other')
    ) as t(ord, name, code)
  loop
    select c.id into v_id from customers c
     where c.code = r.code or lower(btrim(c.name)) = lower(r.name)
     order by (c.code = r.code) desc
     limit 1;
    if v_id is null then
      insert into customers (name, code) values (r.name, r.code) returning id into v_id;
    end if;
    update customers c set opgw_order = r.ord where c.id = v_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) the structures
-- ---------------------------------------------------------------------------
create table if not exists opgw_points (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  kind              text not null default 'splice' check (kind in ('splice','test')),
  -- splice: the structure number ("36/3B", "Chrisp Switch").
  -- test:   the structure number or the hub name ("18/9", "Shankle sub").
  name              text not null,
  tested_from       text check (tested_from in ('structure','hub')),
  -- Austin: "95% of the time the opgw locations will be 2-way." 2-way is what
  -- the form starts on; the column stays nullable so a test point carries none.
  splice_type       text check (splice_type in ('2way','3way','transition','termination','other')),
  splice_type_other text,
  cable_count       text check (cable_count in ('48','96','144','other')),
  cable_count_other text,
  gps_lat           numeric(9,6),
  gps_lng           numeric(9,6),
  -- optional: where the crew gets onto the right-of-way when the structure is
  -- a long way from the road. Austin: "a gps grab for the structure and an
  -- optional gps grab for the entrance to get to the structure."
  row_lat           numeric(9,6),
  row_lng           numeric(9,6),
  -- ONE notes box. Distance from the sub and return trips for fixes go here.
  -- Austin: "just put a box that they can put notes in. one box for notes."
  notes             text,
  techs             text[] not null default '{}',
  work_date         date not null default current_date,
  ordinal           int not null default 0,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table opgw_points is
  'OPGW structures (0015): a splice or a test point on a transmission line. Never billed.';

create index if not exists idx_opgw_points_job on opgw_points(job_id, ordinal);

alter table opgw_points enable row level security;

drop policy if exists opgw_points_select on opgw_points;
create policy opgw_points_select on opgw_points for select using (is_active_user());

drop policy if exists opgw_points_insert on opgw_points;
create policy opgw_points_insert on opgw_points for insert with check (is_active_user());

drop policy if exists opgw_points_update on opgw_points;
create policy opgw_points_update on opgw_points for update
  using (is_active_user()) with check (is_active_user());

-- The office, or the man who entered it (a tech fixing his own wrong entry).
drop policy if exists opgw_points_delete on opgw_points;
create policy opgw_points_delete on opgw_points for delete
  using (is_office() or (is_active_user() and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- VERIFY — the results panel should show 9 rows, numbered 1 to 9, Primoris
-- first and Other last.
-- ---------------------------------------------------------------------------
select opgw_order, name, code from customers where opgw_order is not null order by opgw_order;
