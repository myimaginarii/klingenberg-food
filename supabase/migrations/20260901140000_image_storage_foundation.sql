-- Klingenberg Food — phase 10A: the image storage foundation.
--
-- Technical plan section 1 (adjustments 2 and 3), section 4 (the images table),
-- section 5 (Staff and Owner hold "dish photos, and all image upload / replace /
-- delete"), section 8 ("Malicious upload" and "Service-role key reaches the
-- browser"), section 15 (phase 10).
--
-- What this migration is for, in one sentence: the browser must never be the author
-- of an image's authoritative record. The upload pipeline is
--
--   Server Action mints a signed upload URL after requireStaff()
--     -> the browser PUTs the (client-downscaled) original to that one path
--     -> the trusted server module downloads it, validates the actual bytes with
--        sharp, re-encodes the derivative ladder and writes the derivatives
--     -> only then is the images row created, through create_image() below,
--        with every authoritative value derived by the server.
--
-- Phase 1 gave `public.images` ordinary staff CRUD policies, which was correct for a
-- table nothing wrote. Phase 10 changes what a row *means*: a row now asserts "these
-- processed files exist in storage with these measured properties". A direct
-- PostgREST INSERT can assert that without any file existing, and a direct DELETE
-- can silently null four tables' references with no audit row. So this migration
-- makes the two trusted functions the only doors, using the exact mechanism
-- 20260831200000 established for override deletion: the RLS policies and grants the
-- SECURITY INVOKER functions need remain, and a BEFORE trigger refuses any INSERT or
-- DELETE that did not come from the function that owns it. UPDATE needs no trigger:
-- the table-level grant is narrowed to the one column a person may edit directly
-- (`alt_text`), the same column-privilege mechanism 20260831160000 used for
-- `announcement.draft`.
--
-- The two storage buckets are created here as well, because they are schema in
-- every sense that matters: their names, visibility and limits are load-bearing
-- facts the application and its tests depend on.
--
--   media-originals  private   validated originals, one per image, path
--                              <upload-uuid>/original.<jpg|png|webp>. Reachable by
--                              nobody but the service role and the single-path
--                              signed upload token the server mints.
--   media            public    derivatives only, path <upload-uuid>/<width>.<avif|webp>.
--                              Written by the service role alone; readable by
--                              everyone, which is what lets the public site serve
--                              <img srcset> with no proxy and no next/image.
--
-- storage.objects gets NO new policy: `anon` and `authenticated` have none today and
-- have none afterwards, so every direct storage write from a browser session is
-- refused by RLS. A signed upload URL is pre-authorized by the storage service for
-- its exact bucket and path and needs no policy; the service role bypasses RLS by
-- design and is reachable only from lib/images/storage.ts (section 8).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No new table, no view, no index. The usage view ("Bruges på: Forsiden") is
--     phase 10B, next to the library screen that shows it.
--   * No change to any images RLS policy — the five phase-1 policies stand.
--   * No SECURITY DEFINER function. Both doors are SECURITY INVOKER, so RLS decides
--     for every caller against their own JWT, exactly as section 5 requires.
--   * `image_id` on dishes, weekly_special, monthly_burger and news is named only
--     inside delete_image()'s reference count. No editor owns the column until 10C.
--   * No cache-tag machinery. Creating or deleting an unreferenced image changes no
--     public page; the entity-cache coupling arrives with the references in 10C.
--   * No storage deletion from SQL — Postgres cannot remove a storage object.
--     delete_image() returns the storage_path so the trusted server module can
--     remove the files after the transaction commits (orphaned files are garbage,
--     never a dangling database reference).

-- ---------------------------------------------------------------------------
-- 1. Safety constraints on public.images
-- ---------------------------------------------------------------------------
-- These are deliberately permissive: the strict grammar (exactly
-- "<uuid>/original.<ext>") lives in create_image(), which is the only door new rows
-- can come through. The CHECKs state the properties that must hold for *any* row,
-- including rows written by migrations and test fixtures — no path traversal, no
-- backslash tricks, no control characters, bounded sizes. Two layers, neither
-- trusted to be the only one (section 5).

alter table public.images
  add constraint images_storage_path_safe check (
    storage_path ~ '^[a-z0-9][a-z0-9._/-]*$'
    and storage_path not like '%..%'
    and length(storage_path) <= 300
  );

alter table public.images
  add constraint images_mime_known check (
    mime is null or mime in ('image/jpeg', 'image/png', 'image/webp')
  );

alter table public.images
  add constraint images_dimensions_cap check (
    (width  is null or width  <= 10000)
    and (height is null or height <= 10000)
    and (width is null or height is null
         or (width::bigint * height::bigint) <= 30000000)
  );

alter table public.images
  add constraint images_bytes_cap check (bytes is null or bytes <= 10485760);

alter table public.images
  add constraint images_original_filename_safe check (
    original_filename is null
    or (length(original_filename) <= 160
        and original_filename !~ '[\x00-\x1f\x7f]')
  );

comment on constraint images_storage_path_safe on public.images is
  'Path-safety floor for every row ever written. The strict <uuid>/original.<ext> grammar is create_image()''s, the one door for new rows (phase 10A).';

-- ---------------------------------------------------------------------------
-- 2. The derivative-record validator
-- ---------------------------------------------------------------------------
-- `derivatives` records what the server measured, in one fixed shape:
--
--   { "formats": ["avif", "webp"],
--     "widths":  [ { "width": 480, "height": 320 }, ... ] }
--
-- Derivative *paths* are deliberately not stored: they are derived from the row's
-- own storage_path by one pure function (lib/images/derivatives.ts), so there is no
-- stored path a forged row could point somewhere else. The widths must be exactly
-- the plan's ladder (480/960/1440/2160, section 1 adjustment 3) filtered to the
-- source width — never upscaled — or the source width alone when the source is
-- smaller than the smallest rung. Heights carry a ±1 rounding tolerance so SQL and
-- sharp do not have to agree on a rounding mode.

create or replace function public.is_valid_image_derivatives(
  p_derivatives jsonb,
  p_width integer,
  p_height integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $fn$
declare
  v_expected integer[];
  v_entries jsonb;
  v_entry jsonb;
  v_index integer := 0;
  v_w integer;
  v_h integer;
  v_exact numeric;
begin
  if p_derivatives is null or jsonb_typeof(p_derivatives) <> 'object' then
    return false;
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(p_derivatives) as t(k))
     is distinct from array['formats', 'widths'] then
    return false;
  end if;
  if p_derivatives -> 'formats' <> '["avif", "webp"]'::jsonb then
    return false;
  end if;

  -- The one derivative plan this system has: the ladder, filtered, never upscaled.
  select coalesce(array_agg(w order by w), array[p_width])
    into v_expected
    from unnest(array[480, 960, 1440, 2160]) as t(w)
   where w <= p_width;

  v_entries := p_derivatives -> 'widths';
  if v_entries is null or jsonb_typeof(v_entries) <> 'array'
     or jsonb_array_length(v_entries) <> array_length(v_expected, 1) then
    return false;
  end if;

  for v_entry in select * from jsonb_array_elements(v_entries) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_entry) <> 'object' then
      return false;
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(v_entry) as t(k))
       is distinct from array['height', 'width'] then
      return false;
    end if;
    if jsonb_typeof(v_entry -> 'width') <> 'number'
       or jsonb_typeof(v_entry -> 'height') <> 'number' then
      return false;
    end if;

    v_w := (v_entry ->> 'width')::integer;
    v_h := (v_entry ->> 'height')::integer;

    if v_w is distinct from v_expected[v_index] then
      return false;
    end if;

    v_exact := (v_w::numeric * p_height::numeric) / p_width::numeric;
    if v_h < greatest(1, floor(v_exact) - 1) or v_h > ceil(v_exact) + 1 then
      return false;
    end if;
  end loop;

  return true;
end;
$fn$;

comment on function public.is_valid_image_derivatives(jsonb, integer, integer) is
  'True when a derivatives document has exactly the shape and ladder the phase-10 pipeline produces. Restates lib/images/derivatives.ts in SQL — two layers, neither trusted alone (section 5).';

revoke all on function public.is_valid_image_derivatives(jsonb, integer, integer) from public, anon;
grant execute on function public.is_valid_image_derivatives(jsonb, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The audited shape
-- ---------------------------------------------------------------------------
-- The image's content for audit rows, in the family of dish_availability() and
-- announcement_snapshot(): the columns that describe the asset, and never the row
-- identity or the concurrency token. For a deletion this document *is* the recovery
-- story (section 8) — it names the storage path every derivative path derives from.

create or replace function public.image_content(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select jsonb_build_object(
    'storage_path',      i.storage_path,
    'alt_text',          i.alt_text,
    'width',             i.width,
    'height',            i.height,
    'bytes',             i.bytes,
    'mime',              i.mime,
    'derivatives',       i.derivatives,
    'original_filename', i.original_filename,
    'uploaded_by',       i.uploaded_by,
    'created_at',        i.created_at
  )
  from public.images i
  where i.id = p_id
$fn$;

comment on function public.image_content(uuid) is
  'The audited shape of one image row (phase 10A). Everything that describes the asset; nothing that identifies the row or its version.';

revoke all on function public.image_content(uuid) from public, anon;
grant execute on function public.image_content(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The guard: INSERT and DELETE are spent only by the trusted functions
-- ---------------------------------------------------------------------------
-- Same convention as tg_guard_override_delete() (20260831200000) and the
-- announcement write guard (20260831160000): a transaction-local, single-use marker
-- that only the trusted functions set. The privileges themselves cannot be revoked —
-- a SECURITY INVOKER function spends its caller's privileges — so the *transition*
-- is constrained instead of the privilege. The trigger steps aside for roles that
-- are not anon or authenticated: migrations, seed and pgTAP fixtures are not
-- browser sessions.

create or replace function public.tg_guard_image_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op text;
  v_expected text;
begin
  if current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_op := pg_catalog.current_setting('app.image_write', true);

  -- Single-use: consumed on first sight, so the marker cannot be held open for a
  -- second statement in the same transaction.
  if v_op is not null and v_op <> '' then
    perform pg_catalog.set_config('app.image_write', '', true);
  end if;

  v_expected := case tg_op when 'INSERT' then 'create' else 'delete' end;

  if coalesce(v_op, '') <> v_expected then
    raise exception
      'images: a row is created only by create_image() and removed only by delete_image() — the trusted functions that verify the processed files, the references and the audit trail (phase 10A)'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$fn$;

comment on function public.tg_guard_image_write() is
  'BEFORE INSERT/DELETE guard on public.images. Recognises the trusted functions by the transaction-local app.image_write marker; refuses every direct PostgREST write (phase 10A).';

drop trigger if exists images_guard_insert on public.images;
create trigger images_guard_insert
  before insert on public.images
  for each row execute function public.tg_guard_image_write();

drop trigger if exists images_guard_delete on public.images;
create trigger images_guard_delete
  before delete on public.images
  for each row execute function public.tg_guard_image_write();

revoke all on function public.tg_guard_image_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. UPDATE narrows to the one directly-editable column
-- ---------------------------------------------------------------------------
-- alt_text is a person's sentence about the picture — genuinely user input, and the
-- phase-10B library edits it as an ordinary write. Every other column is the
-- server's measurement of a processed file; no trusted function updates any of them
-- in 10A (replacement is 10B's decision), so unlike the announcement they need no
-- transition trigger — they are simply out of the grant. updated_at/updated_by keep
-- moving: a BEFORE trigger's assignment to NEW is not privilege-checked
-- (20260831160000 records the mechanism).

revoke update on public.images from authenticated;
grant update (alt_text) on public.images to authenticated;

-- ---------------------------------------------------------------------------
-- 6. create_image() — the one door in
-- ---------------------------------------------------------------------------
-- Called by the trusted server module after — and only after — the original has
-- been validated, the derivatives written and every value below measured by sharp.
-- SECURITY INVOKER: the caller is a real staff session, RLS re-checks it, and
-- log_audit() records the same auth.uid().
--
-- Replay-safe by the storage path: one finalized upload is one row, however many
-- times a double-click or a retried request submits the same finalize. The replay
-- returns the existing row and writes no second audit row.

create or replace function public.create_image(
  p_storage_path      text,
  p_mime              text,
  p_width             integer,
  p_height            integer,
  p_bytes             bigint,
  p_original_filename text,
  p_derivatives       jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_existing public.images%rowtype;
  v_row      public.images%rowtype;
begin
  -- Replay first: the same finalized upload must not become a second row.
  select * into v_existing from public.images where storage_path = p_storage_path;
  if found then
    return jsonb_build_object(
      'status', 'exists', 'id', v_existing.id, 'updated_at', v_existing.updated_at);
  end if;

  -- The strict grammar. The upload flow mints <uuid>/original.<ext>; nothing else
  -- is a path this function will put in a row. The original filename is metadata,
  -- never identity (section 8: "stores under a random path").
  if p_storage_path is null
     or p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/original\.(jpg|png|webp)$' then
    raise exception
      'create_image: the storage path must be the trusted upload flow''s <uuid>/original.<jpg|png|webp>'
      using errcode = '22023';
  end if;

  if p_mime is null or not (
       (p_mime = 'image/jpeg' and p_storage_path like '%.jpg')
    or (p_mime = 'image/png'  and p_storage_path like '%.png')
    or (p_mime = 'image/webp' and p_storage_path like '%.webp')
  ) then
    raise exception
      'create_image: the MIME type must be the sniffed image/jpeg, image/png or image/webp and match the stored extension'
      using errcode = '22023';
  end if;

  if p_width is null or p_height is null
     or p_width < 1 or p_height < 1
     or p_width > 10000 or p_height > 10000
     or (p_width::bigint * p_height::bigint) > 30000000 then
    raise exception
      'create_image: the decoded dimensions must be between 1 and 10000 per side and at most 30 megapixels'
      using errcode = '22023';
  end if;

  if p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then
    raise exception
      'create_image: the original byte size must be between 1 and 10485760'
      using errcode = '22023';
  end if;

  if p_original_filename is not null
     and (length(p_original_filename) > 160
          or p_original_filename ~ '[\x00-\x1f\x7f]') then
    raise exception
      'create_image: the original filename is display metadata — at most 160 characters, no control characters'
      using errcode = '22023';
  end if;

  if not public.is_valid_image_derivatives(p_derivatives, p_width, p_height) then
    raise exception
      'create_image: the derivatives document must be exactly the pipeline''s ladder for these dimensions'
      using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.image_write', 'create', true);

  insert into public.images
    (storage_path, mime, width, height, bytes, original_filename, derivatives, uploaded_by)
  values
    (p_storage_path, p_mime, p_width, p_height, p_bytes, p_original_filename,
     p_derivatives, (select auth.uid()))
  returning * into v_row;

  perform pg_catalog.set_config('app.image_write', '', true);

  perform public.log_audit('upload', 'image', v_row.id, null, public.image_content(v_row.id));

  return jsonb_build_object(
    'status', 'created', 'id', v_row.id, 'updated_at', v_row.updated_at);

exception
  when unique_violation then
    -- Two finalizes raced past the replay probe; the committed one wins and this
    -- one reports it, exactly as a later replay would.
    select * into v_existing from public.images where storage_path = p_storage_path;
    return jsonb_build_object(
      'status', 'exists', 'id', v_existing.id, 'updated_at', v_existing.updated_at);
end;
$fn$;

comment on function public.create_image(text, text, integer, integer, bigint, text, jsonb) is
  'The one way an images row comes to exist (phase 10A). Server-derived metadata only, validated again here; replay-safe on storage_path; audited as ''upload''. SECURITY INVOKER — RLS decides for the caller''s own JWT.';

revoke all on function public.create_image(text, text, integer, integer, bigint, text, jsonb) from public, anon;
grant execute on function public.create_image(text, text, integer, integer, bigint, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. delete_image() — the one door out
-- ---------------------------------------------------------------------------
-- The foundation for 10B's replace/delete workflow, in the family of
-- remove_opening_hours_override(): version-checked, reference-aware, audited, and
-- the only statement the DELETE guard lets through.
--
-- An image that is in use keeps section 7e item 4's rule — warn, and then null the
-- reference, never a dangling id. The four `image_id` foreign keys are all
-- ON DELETE SET NULL, and referential actions are not subject to RLS, so the
-- confirmed delete nulls every reference in the same transaction. The unconfirmed
-- call refuses with the count instead, which is what the 10B confirmation screen
-- will say out loud. (Drafts cannot reference an image before 10C wires image_id
-- into an editor, so live columns are the whole truth today; 10C revisits this
-- count when that stops being true.)

create or replace function public.delete_image(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_confirmed           boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row     public.images%rowtype;
  v_refs    integer;
  v_before  jsonb;
  v_deleted integer;
begin
  select * into v_row from public.images where id = p_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict');
  end if;

  select (select count(*) from public.dishes         where image_id = p_id)
       + (select count(*) from public.weekly_special where image_id = p_id)
       + (select count(*) from public.monthly_burger where image_id = p_id)
       + (select count(*) from public.news           where image_id = p_id)
    into v_refs;

  if v_refs > 0 and not p_confirmed then
    return jsonb_build_object('status', 'in_use', 'references', v_refs);
  end if;

  v_before := public.image_content(p_id);

  perform pg_catalog.set_config('app.image_write', 'delete', true);

  delete from public.images
   where id = p_id
     and updated_at = p_expected_updated_at;

  perform pg_catalog.set_config('app.image_write', '', true);

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    -- The row moved between the read and the delete. Nothing happened; say so.
    return jsonb_build_object('status', 'conflict');
  end if;

  perform public.log_audit('delete', 'image', p_id, v_before, null);

  -- storage_path lets the trusted server module remove the files afterwards; a
  -- failed removal leaves orphaned bytes, never a dangling reference.
  return jsonb_build_object(
    'status', 'deleted', 'references', v_refs, 'storage_path', v_row.storage_path);
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A). Version-checked; refuses with ''in_use'' unless confirmed; nulls every image_id reference through the FKs; audited as ''delete'' with the content as the recovery story.';

revoke all on function public.delete_image(uuid, timestamptz, boolean) from public, anon;
grant execute on function public.delete_image(uuid, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The two buckets
-- ---------------------------------------------------------------------------
-- Bucket-level limits are the storage service's own enforcement, in front of
-- everything the application checks: the originals bucket refuses anything past
-- 10 MiB or outside the three accepted upload types at the door (the declared
-- Content-Type — the server still sniffs the actual bytes, section 8), and the
-- derivatives bucket accepts only what the pipeline emits. `media` is public —
-- that is the read model: anonymous visitors read derivatives and nothing else.
-- ON CONFLICT keeps the migration idempotent against a bucket created by hand.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-originals', 'media-originals', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('media', 'media', true, 4194304,
   array['image/avif', 'image/webp'])
on conflict (id) do nothing;
