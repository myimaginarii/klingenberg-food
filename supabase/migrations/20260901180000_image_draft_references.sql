-- Klingenberg Food — phase 10C-1: the draft-aware image reference model.
--
-- Technical plan section 4 ("no image_usages join table — usage is derived from the
-- known reference columns"), section 6 (drafts hold only the changed fields; live
-- columns move only on publish), section 7e item 4 (an image reference is warned
-- about and then cleared — never left dangling), section 15 (phase 10C).
--
-- WHY THIS MIGRATION EXISTS. 10C-1 makes `image_id` a real content field in the
-- dish, weekly-special and monthly-burger editors, and their model is the ordinary
-- draft model: a selection is written into `draft` and reaches the live column only
-- through the entity's publish function (which has merged `draft ? 'image_id'`
-- since phase 4). That gives the system a second place an image id can live —
-- inside pending draft JSON, where no foreign key reaches — and 10A's
-- delete_image() comment reserved exactly this revisit: "Drafts cannot reference
-- an image before 10C wires image_id into an editor ... 10C revisits this count
-- when that stops being true." It has stopped being true, so:
--
--   * `image_references` states, once, what "referenced" means: the four live
--     image_id columns plus the three draft keys. Every consumer — the in_use
--     count, the confirmed detach, the library's usage labels — reads the same
--     definition, so a delete refusal and a caption can never disagree.
--   * `delete_image()` counts draft references, and a confirmed delete clears the
--     `image_id` key out of every draft that names the image, in the same
--     transaction the FKs null the live columns. Only that one typed key moves;
--     every other pending field survives byte for byte, and a draft left with no
--     fields becomes NULL again (an empty object would keep the row pending
--     forever — the phase-4 rule `nextDraftValues` states in TypeScript).
--   * `replace_image()` moves draft references old→new exactly as it moves the
--     live ones, so no stale id survives a replacement anywhere.
--
-- News is deliberately NOT in the draft half: it has no draft column (§4) — its
-- image reference is always the row's own `image_id` column, which the FKs and the
-- live UPDATEs already handle. It appears in the view with `pending = true` while
-- the article itself is an unpublished draft, because that is the honest label for
-- a usage no guest can see.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No new table, no index, no policy change, no trigger change, no grant change
--     on any existing object. The view is SECURITY INVOKER (security_invoker=true),
--     so RLS on the underlying tables decides every row for the caller's own JWT.
--   * No SECURITY DEFINER. Both replaced functions stay SECURITY INVOKER with
--     search_path pinned; the draft UPDATEs run under the caller's own RLS and
--     spend the caller's own UPDATE privilege, and the entity touch triggers stamp
--     the moved rows so an open editor meets an honest version conflict.
--   * No change to create_image(), to any publish function, or to the guard
--     trigger and its marker convention.
--   * No parsing of arbitrary JSON: the draft transitions name exactly one typed
--     key ('image_id') and touch nothing beside it.

-- ---------------------------------------------------------------------------
-- 1. image_references — the one definition of "referenced"
-- ---------------------------------------------------------------------------
-- A row per reference, live and pending alike. The draft half casts only values
-- that are shaped like a uuid: the Zod layer refuses anything else on the way in,
-- but a fixture or migration could write garbage, and a view that throws on read
-- would take the whole library screen down with it.

create or replace view public.image_references
with (security_invoker = true)
as
  select d.image_id as image_id, 'dish'::text as kind, d.id as entity_id,
         d.name as name, false as pending
    from public.dishes d
   where d.image_id is not null
  union all
  select w.image_id, 'weekly', w.id, 'Ugens ret', false
    from public.weekly_special w
   where w.image_id is not null
  union all
  select m.image_id, 'monthly', m.id, 'Månedens burger', false
    from public.monthly_burger m
   where m.image_id is not null
  union all
  -- A news reference is always the live column (news has no draft column, §4);
  -- `pending` here says whether the article itself is an unpublished draft.
  select n.image_id, 'news', n.id, n.title, n.status = 'draft'
    from public.news n
   where n.image_id is not null
  union all
  select (d.draft ->> 'image_id')::uuid, 'dish', d.id, d.name, true
    from public.dishes d
   where d.draft ->> 'image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (w.draft ->> 'image_id')::uuid, 'weekly', w.id, 'Ugens ret', true
    from public.weekly_special w
   where w.draft ->> 'image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (m.draft ->> 'image_id')::uuid, 'monthly', m.id, 'Månedens burger', true
    from public.monthly_burger m
   where m.draft ->> 'image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

comment on view public.image_references is
  'Every place an image is referenced — the four live image_id columns plus the three draft image_id keys (phase 10C-1). SECURITY INVOKER: RLS decides every row for the caller. The one definition delete_image(), replace_image() and the library''s usage labels all share.';

-- The project's default privileges grant new objects to anon and authenticated
-- wholesale; a UNION view is not writable anyway, but the grant should say what
-- is meant: staff read it, nobody writes it, anon never sees it.
revoke all on public.image_references from public, anon, authenticated;
grant select on public.image_references to authenticated;

-- ---------------------------------------------------------------------------
-- 2. delete_image() — reference-aware across drafts as well
-- ---------------------------------------------------------------------------
-- Same contract as 10A, three deliberate changes:
--
--   * the reference count comes from image_references, so an image named only by a
--     pending draft still refuses with in_use until a person confirms;
--   * the row is read FOR UPDATE (as replace_image() already does), so the version
--     check stays true until commit — the draft detach below must never run for a
--     transition that then reports conflict and writes nothing else;
--   * a confirmed delete clears the image_id key out of every draft that names the
--     image, before the DELETE whose FKs null the live columns, and the audit's
--     before-document records what was cleared.

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
  v_row           public.images%rowtype;
  v_live_refs     integer;
  v_draft_refs    integer;
  v_refs          integer;
  v_before        jsonb;
  v_cleared       integer;
  v_draft_cleared integer := 0;
  v_deleted       integer;
begin
  -- FOR UPDATE: the version check stays true until the transaction ends, so the
  -- draft detach and the row's own deletion cannot be split by a concurrent write
  -- — the concurrent writer waits, then sees conflict or not_found.
  select * into v_row from public.images where id = p_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict');
  end if;

  select count(*) filter (where not r.pending),
         count(*) filter (where r.pending)
    into v_live_refs, v_draft_refs
    from public.image_references r
   where r.image_id = p_id;

  v_refs := v_live_refs + v_draft_refs;

  if v_refs > 0 and not p_confirmed then
    return jsonb_build_object('status', 'in_use', 'references', v_refs);
  end if;

  -- The before-document is the recovery story (§8); the reference summary records
  -- what a confirmed delete is about to clear, so the audit explains what happened
  -- without exposing anything an owner could not already read.
  v_before := public.image_content(p_id)
    || jsonb_build_object(
         'references', jsonb_build_object('live', v_live_refs, 'draft', v_draft_refs));

  -- Clear the pending references first: the FKs reach the live columns during the
  -- DELETE below, but no foreign key reaches into draft JSON. Exactly one typed
  -- key is removed; every other pending field is untouched, and a draft with no
  -- fields left becomes NULL (the phase-4 empty-draft rule, restated in SQL).
  update public.dishes
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_cleared = row_count;
  v_draft_cleared := v_draft_cleared + v_cleared;

  update public.weekly_special
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_cleared = row_count;
  v_draft_cleared := v_draft_cleared + v_cleared;

  update public.monthly_burger
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_cleared = row_count;
  v_draft_cleared := v_draft_cleared + v_cleared;

  perform pg_catalog.set_config('app.image_write', 'delete', true);

  delete from public.images
   where id = p_id
     and updated_at = p_expected_updated_at;

  perform pg_catalog.set_config('app.image_write', '', true);

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    -- Unreachable behind the FOR UPDATE lock, and stated anyway: drafts have
    -- already been detached, so a partial state must not commit.
    raise exception 'delete_image: the image changed while being deleted'
      using errcode = '40001';
  end if;

  perform public.log_audit('delete', 'image', p_id, v_before, null);

  -- storage_path lets the trusted server module remove the files afterwards; a
  -- failed removal leaves orphaned bytes, never a dangling reference.
  return jsonb_build_object(
    'status', 'deleted', 'references', v_refs, 'storage_path', v_row.storage_path);
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A, draft-aware since 10C-1). Version-checked behind FOR UPDATE; refuses with ''in_use'' unless confirmed, counting live and draft references alike; a confirmed delete clears the image_id key from every draft and lets the FKs null the live columns in the same transaction; audited as ''delete'' with the content and the cleared reference counts.';

-- ---------------------------------------------------------------------------
-- 3. replace_image() — the repointing reaches drafts as well
-- ---------------------------------------------------------------------------
-- 10B's contract stands whole: the new image is a finished library row before this
-- runs, one transaction repoints every reference and removes the old row, storage
-- cleanup happens only after commit. The addition is three draft UPDATEs — a
-- replacement is a global asset substitution, so a pending selection of the old
-- image must become a pending selection of the new one, and a draft naming a
-- *different* image than the one being replaced is not touched at all.

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

  -- Repoint the four live image_id relationships (section 4). Each UPDATE runs
  -- under the caller's own RLS; the touch triggers stamp the moved rows, so an
  -- open editor sees an honest conflict.
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

  -- And the three pending references (phase 10C-1). jsonb_set names exactly one
  -- typed key; every other pending field in the draft is preserved unchanged.
  update public.dishes
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  update public.weekly_special
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_moved = row_count;
  v_refs := v_refs + v_moved;

  update public.monthly_burger
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
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
  'The one way an image is replaced (phase 10B, draft-aware since 10C-1): repoints every image_id reference — live columns and pending draft keys alike — to an already-finalized new image and removes the old row in one transaction. Version-checked; audited as ''replace''; returns the old storage_path for trusted file cleanup. SECURITY INVOKER — RLS decides for the caller''s own JWT.';
