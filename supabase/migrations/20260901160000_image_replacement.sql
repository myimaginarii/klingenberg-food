-- Klingenberg Food — phase 10B: the image replacement transition.
--
-- Technical plan section 5 ("Dish photos, and all image upload / replace / delete:
-- Staff yes, Owner yes"), section 7e item 4 (an image reference is warned about and
-- then moved — never left dangling), section 15 (phase 10: "10B: the 1w library
-- screen — list, alt text, usage labels, replace/delete confirmations, the upload
-- UI"). Design 1w draws the "Erstat" control beside "Slet".
--
-- WHAT "ERSTAT" MEANS, exactly (decided before coding, phase-10B brief section 17):
-- the new image is uploaded and processed COMPLETELY first, through the ordinary
-- 10A pipeline — request, signed PUT, finalize, create_image() — so by the time this
-- function runs, the replacement is an ordinary finished library row. This function
-- is then the trusted transition in the middle: in ONE transaction it repoints every
-- image_id reference from the old image to the new one and removes the old row. The
-- old image's files are removed by the server module only after this commits —
-- storage cleanup can orphan bytes, never break a reference. The current image is
-- never destroyed first in the hope that a replacement will arrive.
--
-- Why the repointing lives here and not in the Server Action: four UPDATEs and a
-- DELETE that must commit together are a transaction, and the application has no
-- transaction boundary — a failure between statements issued from Node would leave
-- half the references moved. The same reasoning gave phase 8C-3A its coordinator.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No new table, no view, no index, no policy change, no grant change on any
--     table — the images policies and the alt_text-only UPDATE grant stand exactly
--     as 20260901140000 left them.
--   * No SECURITY DEFINER. The function is SECURITY INVOKER: the caller's own JWT
--     is what RLS re-checks on the images row AND on every entity row it repoints.
--   * No change to create_image() or delete_image().
--   * No storage operation — Postgres cannot remove a storage object. The old
--     storage_path is returned so the trusted server module can remove the files
--     after the commit, exactly as delete_image() already does.

create or replace function public.replace_image(
  p_old_id              uuid,
  p_expected_updated_at timestamptz,
  p_new_id              uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_old     public.images%rowtype;
  v_new     public.images%rowtype;
  v_before  jsonb;
  v_refs    integer := 0;
  v_moved   integer;
  v_deleted integer;
begin
  -- FOR UPDATE: the version check below stays true until the transaction ends, so
  -- the repointing and the delete cannot race a concurrent alt edit or delete into
  -- a half-applied state — the concurrent writer waits, then sees conflict/not_found.
  select * into v_old from public.images where id = p_old_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_old.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_new_id is null or p_new_id = p_old_id then
    -- Replacing an image with itself is not a transition; refuse before any write.
    return jsonb_build_object('status', 'invalid_replacement');
  end if;

  -- The replacement must be a finished library row — created by create_image(),
  -- which is the only way a row exists at all. Reading it here also takes the FK
  -- locks that keep a concurrent delete_image(new) from pulling it away while the
  -- references move onto it.
  select * into v_new from public.images where id = p_new_id;
  if not found then
    return jsonb_build_object('status', 'missing_replacement');
  end if;

  v_before := public.image_content(p_old_id);

  -- Repoint the four image_id relationships (section 4 — the only tables that
  -- reference an image). Each UPDATE runs under the caller's own RLS; the touch
  -- triggers stamp the moved rows, so an open editor sees an honest conflict.
  update public.dishes set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  update public.weekly_special set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  update public.monthly_burger set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  update public.news set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  -- The old row goes through the same guarded door delete_image() uses. Every
  -- reference already points at the new image, so the FKs' ON DELETE SET NULL has
  -- nothing left to null.
  perform pg_catalog.set_config('app.image_write', 'delete', true);

  delete from public.images
   where id = p_old_id
     and updated_at = p_expected_updated_at;

  perform pg_catalog.set_config('app.image_write', '', true);

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    -- Unreachable behind the FOR UPDATE lock, and stated anyway: references have
    -- already moved, so a partial state must not commit.
    raise exception 'replace_image: the image changed while being replaced'
      using errcode = '40001';
  end if;

  -- One audit row for the whole transition: before is the displaced image, after
  -- is the successor — the recovery story names both storage paths.
  perform public.log_audit('replace', 'image', p_old_id, v_before, public.image_content(p_new_id));

  return jsonb_build_object(
    'status', 'replaced',
    'references', v_refs,
    'new_id', p_new_id,
    'storage_path', v_old.storage_path);
end;
$fn$;

comment on function public.replace_image(uuid, timestamptz, uuid) is
  'The one way an image is replaced (phase 10B, design 1w "Erstat"): repoints every image_id reference to an already-finalized new image and removes the old row in one transaction. Version-checked; audited as ''replace''; returns the old storage_path for trusted file cleanup. SECURITY INVOKER — RLS decides for the caller''s own JWT.';

revoke all on function public.replace_image(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.replace_image(uuid, timestamptz, uuid) to authenticated;
