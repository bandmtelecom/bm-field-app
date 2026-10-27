-- 0016 — what KIND of location this is, and a second enclosure in the same hole.
--
-- Jason (Lumen), 10/27, on a splice report whose locations printed as
-- 13, 11, 12, 8.5, 9, 8, 3, 7, 4, 5, 5.5, 10, 6, 2, 1, 3, 0, 0.5, 4, 12, 10:
-- put them in order, put return trips under the location, call a simple repair
-- "Repair 1, 2, 3", call rolling around damage "Roll-around location 1, 2, 3",
-- and a second enclosure in a hole you are already in is NOT location 5.5 —
-- 5.5 reads like a new location on the MOP.
--
-- Austin's decisions, 10/27:
--   * Kind buttons on the form: MOP location / Repair / Roll-around.
--   * Repair and Roll-around number themselves in the order they were done.
--   * A revisit sits under the location it went back to (repairs included).
--   * A second enclosure prints under the same location as "Enclosure 2" and
--     STILL BILLS its own re-enter and splices — one setup for the hole.
--
-- The trap this migration exists to avoid: repair numbers are plain integers
-- ("1", "2"), and bm_next_pm_location_no counted every plain integer on the
-- job. Without the kind filter Repair 2 would push the next MOP location to 3.
--
-- Safe to run twice.

-- ---- columns -----------------------------------------------------------------
alter table locations
  add column if not exists location_kind text not null default 'mop';

do $$ begin
  alter table locations add constraint locations_location_kind_check
    check (location_kind in ('mop', 'repair', 'rollaround'));
exception when duplicate_object then null; end $$;

alter table locations
  add column if not exists enclosure_of uuid references locations(id) on delete set null;

comment on column locations.location_kind is
  'mop = a location on the customer''s plan (Location 5, 5.5); repair = a new location for a simple repair (Repair 1, 2…); rollaround = rolling around damage (Roll-around location 1, 2…). Each kind numbers on its own.';
comment on column locations.enclosure_of is
  'A second enclosure in the same hole as that location (a tie cable between enclosures). Prints under the same location number; bills its own re-enter and splices, shares the setup.';

create index if not exists locations_enclosure_of_idx on locations(enclosure_of);

-- ---- MOP numbering ignores the other kinds ----------------------------------
-- Same function as 0013, one line added: only MOP rows push the MOP count.
create or replace function bm_next_pm_location_no(p_visit uuid)
returns text
language plpgsql
stable
as $$
declare
  v_job uuid;
  v_max int;
begin
  select v.job_id into v_job from visits v where v.id = p_visit;
  if v_job is null then
    return '1';
  end if;
  select coalesce(max((btrim(l.pm_location_no))::int), 0) into v_max
  from locations l
    join visits v2 on v2.id = l.visit_id
  where v2.job_id = v_job
    and coalesce(l.location_kind, 'mop') = 'mop'
    and l.pm_location_no ~ '^\s*\d+\s*$';
  return (v_max + 1)::text;
end;
$$;

-- The next number for a repair or a roll-around on this job.
create or replace function bm_next_kind_no(p_visit uuid, p_kind text)
returns text
language plpgsql
stable
as $$
declare
  v_job uuid;
  v_max int;
begin
  select v.job_id into v_job from visits v where v.id = p_visit;
  if v_job is null then
    return '1';
  end if;
  select coalesce(max((btrim(l.pm_location_no))::int), 0) into v_max
  from locations l
    join visits v2 on v2.id = l.visit_id
  where v2.job_id = v_job
    and l.location_kind = p_kind
    and l.pm_location_no ~ '^\s*\d+\s*$';
  return (v_max + 1)::text;
end;
$$;

-- ---- the kind trigger --------------------------------------------------------
-- Fires BEFORE trg_job_location_no (triggers run in name order: trg_a… < trg_j…).
--   * A revisit or a second enclosure takes the kind of the location it points at.
--   * A revisit or a second enclosure with an empty box takes that location's
--     number (an enclosure also its internal job_location_no), so neither
--     consumes a number of any kind.
--   * A repair or roll-around with an empty box gets the next number of its kind.
--     (An empty MOP box is left for trg_job_location_no, as before.)
create or replace function bm_location_kind()
returns trigger
language plpgsql
as $$
declare
  v_job     uuid;
  v_kind    text;
  v_pm      text;
  v_jno     int;
  v_target  uuid;
begin
  if new.enclosure_of is not null and new.enclosure_of = new.id then
    new.enclosure_of := null;
  end if;

  v_target := coalesce(new.revisit_of, new.enclosure_of);
  if v_target is not null then
    select l.location_kind, nullif(btrim(l.pm_location_no), ''), l.job_location_no
      into v_kind, v_pm, v_jno
      from locations l where l.id = v_target;
    if v_kind is not null then
      new.location_kind := v_kind;
    end if;
    -- a revisit or a second enclosure: same number, consumes nothing
    if coalesce(btrim(new.pm_location_no), '') = '' and v_pm is not null then
      new.pm_location_no := v_pm;
    end if;
    if new.revisit_of is null then
      if new.job_location_no is null and v_jno is not null then
        new.job_location_no := v_jno;
      end if;
    end if;
  end if;

  if coalesce(new.location_kind, 'mop') = 'mop' then
    new.location_kind := 'mop';
    return new;
  end if;

  -- The office switched the kind and left the number alone: renumber in the
  -- new kind, so a MOP "7" does not become "Repair 7".
  if tg_op = 'UPDATE'
     and new.location_kind is distinct from old.location_kind
     and new.pm_location_no is not distinct from old.pm_location_no
     and v_target is null then
    new.pm_location_no := null;
  end if;

  if coalesce(btrim(new.pm_location_no), '') = '' then
    select v.job_id into v_job from visits v where v.id = new.visit_id;
    if v_job is not null then
      perform pg_advisory_xact_lock(hashtext('bm_job_location_no'), hashtext(v_job::text));
    end if;
    new.pm_location_no := bm_next_kind_no(new.visit_id, new.location_kind);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_a_location_kind on locations;
create trigger trg_a_location_kind
  before insert or update on locations
  for each row execute function bm_location_kind();

-- ---- check -------------------------------------------------------------------
-- Every existing location is a MOP location, nothing is an enclosure yet.
select location_kind, count(*) as locations, count(enclosure_of) as second_enclosures
from locations
group by location_kind
order by location_kind;
