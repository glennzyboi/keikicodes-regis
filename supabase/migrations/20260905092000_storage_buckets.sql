-- Files.
--
-- Three buckets, and the difference between them is the whole point.
--
-- Program images and school logos are public. They are already on their public
-- website. We hold copies because the URLs their Airtable hands out are signed
-- and expire, so a catalogue that links to them is a catalogue that goes blank
-- a few hours after it is built.
--
-- Child photographs are not public and never will be. Their registration form
-- requires a head shot of a child, which is about the most sensitive thing this
-- system will ever hold. It is private, staff read it through a signed URL that
-- expires, and a family can read only their own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('program-images', 'program-images', true,  5242880,
     array['image/jpeg','image/png','image/webp','image/avif']),
  ('school-logos',   'school-logos',   true,  2097152,
     array['image/jpeg','image/png','image/webp','image/avif','image/svg+xml']),
  ('child-photos',   'child-photos',   false, 5242880,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- The public two: anyone may read, only staff may write.
-- ---------------------------------------------------------------------------
drop policy if exists catalogue_images_are_readable on storage.objects;
create policy catalogue_images_are_readable on storage.objects for select
  using (bucket_id in ('program-images', 'school-logos'));

drop policy if exists staff_write_catalogue_images on storage.objects;
create policy staff_write_catalogue_images on storage.objects for all
  using (bucket_id in ('program-images', 'school-logos') and is_staff())
  with check (bucket_id in ('program-images', 'school-logos') and is_staff());

-- ---------------------------------------------------------------------------
-- Child photographs.
--
-- The object key is `<parent id>/<child id>.<ext>`, so the first path segment
-- is the authorisation. A family can only ever touch the folder that is their
-- own parents row, which means the check is a string comparison rather than a
-- join, and there is no way to widen it by getting a query wrong.
-- ---------------------------------------------------------------------------
drop policy if exists family_reads_own_child_photos on storage.objects;
create policy family_reads_own_child_photos on storage.objects for select
  using (
    bucket_id = 'child-photos'
    and (
      is_staff()
      or (storage.foldername(name))[1] =
         (select p.id::text from parents p where p.auth_user_id = auth.uid())
    )
  );

drop policy if exists family_writes_own_child_photos on storage.objects;
create policy family_writes_own_child_photos on storage.objects for insert
  with check (
    bucket_id = 'child-photos'
    and (storage.foldername(name))[1] =
        (select p.id::text from parents p where p.auth_user_id = auth.uid())
  );

drop policy if exists family_replaces_own_child_photos on storage.objects;
create policy family_replaces_own_child_photos on storage.objects for update
  using (
    bucket_id = 'child-photos'
    and (storage.foldername(name))[1] =
        (select p.id::text from parents p where p.auth_user_id = auth.uid())
  );

-- Nobody deletes a child photograph from the browser. A family that wants one
-- gone asks, and the office does it, so that there is a person and a record
-- behind the deletion rather than a stray request.
drop policy if exists staff_delete_child_photos on storage.objects;
create policy staff_delete_child_photos on storage.objects for delete
  using (bucket_id = 'child-photos' and is_staff());
