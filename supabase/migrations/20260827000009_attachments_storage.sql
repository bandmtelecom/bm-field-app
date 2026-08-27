-- ---------------------------------------------------------------------------
-- Photos and OTDR traces from the field.
--
-- The `attachments` table has existed since day one and has never held a row.
-- This adds the missing half: a storage bucket to put the actual files in, and
-- the rules about who may read and write them.
--
-- PRIVATE BUCKET, NOT PUBLIC. These are photographs of a customer's
-- infrastructure — open manholes, cable counts, damage. A public bucket means
-- anyone who guesses a URL can browse them. The app hands out short-lived
-- signed links instead, so a photo is only reachable by someone logged in.
--
-- Austin's shape (8/27): photos attach to a LOCATION, not to the visit. That way
-- they follow the closure — the next crew on that hole sees what it looked like
-- last time, which is the whole reason the closure registry exists.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400,          -- 25 MB. Compressed phone photos land near 300 KB; an OTDR
                     -- trace is tiny. This is headroom for a test package PDF,
                     -- not an invitation to upload raw 12 MP originals.
  null               -- .sor traces have no registered MIME type and arrive as
                     -- application/octet-stream, so a whitelist here would block
                     -- them. The app restricts what it offers to pick instead.
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ---- who can do what -------------------------------------------------------
-- Same principle as the rest of the schema: any active user of the app, and
-- nobody else. A tech needs to upload from a hole and read back what he and
-- others put there. Deleting is office/admin only — a photo is evidence of what
-- was found, and a tech should not be able to quietly remove it after the fact.

drop policy if exists attachments_read   on storage.objects;
drop policy if exists attachments_insert on storage.objects;
drop policy if exists attachments_update on storage.objects;
drop policy if exists attachments_delete on storage.objects;

create policy attachments_read on storage.objects
  for select using (bucket_id = 'attachments' and is_active_user());

create policy attachments_insert on storage.objects
  for insert with check (bucket_id = 'attachments' and is_active_user());

-- Upload-then-replace (a retry after a dropped signal) has to be allowed, or a
-- tech in bad coverage can get permanently stuck on one photo.
create policy attachments_update on storage.objects
  for update using (bucket_id = 'attachments' and is_active_user())
          with check (bucket_id = 'attachments' and is_active_user());

create policy attachments_delete on storage.objects
  for delete using (bucket_id = 'attachments' and is_office());

-- ---- finding them again ----------------------------------------------------
-- Every screen that shows attachments asks "what is attached to this location",
-- so that lookup should not scan the table once the crew has a year of photos.
create index if not exists attachments_location_idx
  on attachments (location_id, created_at desc)
  where location_id is not null;

create index if not exists attachments_job_idx
  on attachments (job_id, created_at desc);

comment on column attachments.storage_path is
  'Path inside the private ''attachments'' bucket. Read it with a signed URL; never expose the bucket publicly.';
