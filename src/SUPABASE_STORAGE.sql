-- ============================================================================
--  GFC — Supabase Storage setup (for uploading logos & banners from the admin)
--
--  DO THIS FIRST in the dashboard:
--    Storage → New bucket → name it exactly:  media  → turn Public bucket ON →
--    Create.
--
--  THEN run this in the SQL Editor.  It lets anyone VIEW images in the media
--  bucket, and lets a logged-in admin UPLOAD (and delete) them.
-- ============================================================================

-- Anyone can view images in the media bucket.
drop policy if exists "media public read" on storage.objects;
create policy "media public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'media');

-- A logged-in admin can upload images.
drop policy if exists "media auth upload" on storage.objects;
create policy "media auth upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media');

-- A logged-in admin can replace/delete images (optional, for future cleanup).
drop policy if exists "media auth update" on storage.objects;
create policy "media auth update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'media');

drop policy if exists "media auth delete" on storage.objects;
create policy "media auth delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media');

-- ============================================================================
--  After this, the admin panel's Sponsors / Upcoming / Results / Posters forms
--  will show an "Upload image" button. Uploaded images publish to everyone
--  instantly — no redeploy needed.
-- ============================================================================
