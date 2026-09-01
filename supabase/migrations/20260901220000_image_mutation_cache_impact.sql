-- Klingenberg Food — phase 10C-2: the trusted image transitions report what they
-- moved, so the public cache can be expired exactly.
--
-- Technical plan section 6 (publishing expires the tags the published entity
-- appears in — "the next request shows the published version"), section 20 (the
-- cache contract), section 15 (phase 10C-2: public image rendering and the
-- per-entity cache coupling).
--
-- WHY THIS MIGRATION EXISTS. From 10C-2 the public pages render every LIVE image
-- reference: a dish's photo is in the `menu`-tagged HTML, the singletons' in
-- `weekly`/`monthly`, a published article's in `news`. A confirmed delete_image()
-- and a replace_image() change that HTML for every live reference they detach or
-- repoint, so the Server Action must expire the affected tags — and it must learn
-- the affected set from a source that cannot be wrong:
--
--   * not from the browser (a usage list a form could forge or omit);
--   * not from a pre-read in another transaction (a reference a concurrent publish
--     makes live between the read and the transition would be moved by the
--     transition and missed by the read, leaving cached HTML pointing at files the
--     cleanup is about to remove);
--   * not from a read after the transition (by then the references are gone).
--
-- So each transition reports `affected` — per-kind counts of the rows its OWN
-- statements moved, read from those statements (`RETURNING`, inside the same
-- transaction, behind the FOR UPDATE lock on the image row). Under READ COMMITTED
-- an UPDATE re-evaluates against the newest committed row version, so a reference
-- a concurrent publish made live is counted by the statement that moves it. The
-- counts are split into what a guest could see (`live`: a published dish that is
-- not soft-deleted, the two singletons' live columns, a published article) and
-- what no guest could (`draft`: draft keys, a soft-deleted dish's live column, an
-- unpublished article's column) — the application expires tags for `live` only.
--
-- WHAT CHANGES, EXACTLY. The two function bodies from 20260901200000, with:
--   * the three guarded live UPDATEs in each function wrapped as data-modifying
--     CTEs whose RETURNING is counted, marker raised before and cleared after each,
--     one statement each, exactly as before (the statement trigger clears the
--     marker at the end of the CTE statement as it does for a bare UPDATE);
--   * delete_image() detaching `news.image_id` explicitly (the FK's SET NULL would
--     have done it as the table owner, uncounted) so the published-article count is
--     the statement's own — the FK then has nothing left to null;
--   * one more key in each 'deleted'/'replaced' reply: `affected`. Every existing
--     key (`status`, `references`, `storage_path`, `new_id`) keeps its meaning and
--     value; pgTAP 020–023 pass unchanged.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No new table, view, index, grant, policy or trigger; no SECURITY DEFINER —
--     both functions stay SECURITY INVOKER with search_path pinned, and every
--     UPDATE runs under the caller's own RLS as before.
--   * No change to the guard, its marker or its vocabulary; no change to the
--     refusals (`in_use`, `conflict`, `not_found`, `invalid_replacement`,
--     `missing_replacement`), which carry no `affected` key because they moved
--     nothing.
--   * No alt-text transition. The description stays the one direct column write
--     (20260901140000's grant); the application reads `image_references` after
--     its own successful write to find the live usages (recorded in
--     lib/images/cache-impact.ts).

-- ---------------------------------------------------------------------------
-- 1. delete_image() — reports the live and draft rows it detached
-- ---------------------------------------------------------------------------

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
  v_row            public.images%rowtype;
  v_live_refs      integer;
  v_draft_refs     integer;
  v_refs           integer;
  v_before         jsonb;
  v_draft_dish     integer := 0;
  v_draft_weekly   integer := 0;
  v_draft_monthly  integer := 0;
  v_draft_news     integer := 0;
  v_live_dish      integer := 0;
  v_live_weekly    integer := 0;
  v_live_monthly   integer := 0;
  v_live_news      integer := 0;
  v_hidden_dish    integer := 0;
  v_deleted        integer;
begin
  -- FOR UPDATE: the version check stays true until the transaction ends, so the
  -- detach and the row's own deletion cannot be split by a concurrent write — the
  -- concurrent writer waits, then sees conflict or not_found.
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

  -- Clear the pending references first. Exactly one typed key is removed; every
  -- other pending field is untouched, and a draft with no fields left becomes NULL
  -- (the phase-4 empty-draft rule, restated in SQL). `draft` is not a guarded
  -- column, so no marker is raised for these.
  update public.dishes
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_draft_dish = row_count;

  update public.weekly_special
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_draft_weekly = row_count;

  update public.monthly_burger
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where draft ->> 'image_id' = p_id::text;
  get diagnostics v_draft_monthly = row_count;

  -- Then the live references, one guarded statement each (20260901200000), each
  -- counted from its own RETURNING: what a guest could see goes to `live`, a
  -- soft-deleted dish's column to the hidden count. The touch triggers stamp the
  -- moved rows, so an open editor sees an honest conflict, exactly as before.
  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.dishes set image_id = null where image_id = p_id
    returning deleted_at
  )
  select count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null)
    into v_live_dish, v_hidden_dish
    from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.weekly_special set image_id = null where image_id = p_id
    returning id
  )
  select count(*) into v_live_weekly from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.monthly_burger set image_id = null where image_id = p_id
    returning id
  )
  select count(*) into v_live_monthly from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  -- News is unguarded (phase 9's direct-edit model); detached here explicitly and
  -- counted by the article's status, so the FK below finds nothing left to null.
  with moved as (
    update public.news set image_id = null where image_id = p_id
    returning status
  )
  select count(*) filter (where status = 'published'),
         count(*) filter (where status is distinct from 'published')
    into v_live_news, v_draft_news
    from moved;

  -- The row itself, through the images guard's own door.
  perform pg_catalog.set_config('app.image_write', 'delete', true);

  delete from public.images
   where id = p_id
     and updated_at = p_expected_updated_at;
  get diagnostics v_deleted = row_count;

  perform pg_catalog.set_config('app.image_write', '', true);

  if v_deleted = 0 then
    -- Unreachable behind the FOR UPDATE lock, and stated anyway: references have
    -- already been detached, so a partial state must not commit.
    raise exception 'delete_image: the image changed while being deleted'
      using errcode = '40001';
  end if;

  perform public.log_audit('delete', 'image', p_id, v_before, null);

  -- storage_path lets the trusted server module remove the files afterwards; a
  -- failed removal leaves orphaned bytes, never a dangling reference. `affected`
  -- lets it expire exactly the public tags the detached live rows were rendered
  -- under (phase 10C-2).
  return jsonb_build_object(
    'status', 'deleted',
    'references', v_refs,
    'storage_path', v_row.storage_path,
    'affected', jsonb_build_object(
      'live', jsonb_build_object(
        'dish', v_live_dish, 'weekly', v_live_weekly,
        'monthly', v_live_monthly, 'news', v_live_news),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news)));
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A, draft-aware since 10C-1). Version-checked behind FOR UPDATE; refuses with ''in_use'' unless confirmed, counting live and draft references alike; a confirmed delete clears the image_id key from every draft, detaches the three guarded live columns under the ''detach'' transition and the news column, removes the row and audits as ''delete'' — one transaction, no dangling id. Reports ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them (phase 10C-2).';

-- ---------------------------------------------------------------------------
-- 2. replace_image() — reports the live and draft rows it repointed
-- ---------------------------------------------------------------------------

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
  v_old            public.images%rowtype;
  v_new            public.images%rowtype;
  v_before         jsonb;
  v_refs           integer := 0;
  v_draft_dish     integer := 0;
  v_draft_weekly   integer := 0;
  v_draft_monthly  integer := 0;
  v_draft_news     integer := 0;
  v_live_dish      integer := 0;
  v_live_weekly    integer := 0;
  v_live_monthly   integer := 0;
  v_live_news      integer := 0;
  v_hidden_dish    integer := 0;
  v_deleted        integer;
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
  -- open editor sees an honest conflict. The three guarded columns move under the
  -- 'replace' transition, one statement each, however many rows it reaches
  -- (20260901200000); each is counted from its own RETURNING before the marker is
  -- cleared, split into what a guest could see and what not.
  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.dishes set image_id = p_new_id where image_id = p_old_id
    returning deleted_at
  )
  select count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null)
    into v_live_dish, v_hidden_dish
    from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_dish + v_hidden_dish;

  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.weekly_special set image_id = p_new_id where image_id = p_old_id
    returning id
  )
  select count(*) into v_live_weekly from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_weekly;

  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.monthly_burger set image_id = p_new_id where image_id = p_old_id
    returning id
  )
  select count(*) into v_live_monthly from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_monthly;

  with moved as (
    update public.news set image_id = p_new_id where image_id = p_old_id
    returning status
  )
  select count(*) filter (where status = 'published'),
         count(*) filter (where status is distinct from 'published')
    into v_live_news, v_draft_news
    from moved;
  v_refs := v_refs + v_live_news + v_draft_news;

  -- And the three pending references (phase 10C-1). jsonb_set names exactly one
  -- typed key; every other pending field in the draft is preserved unchanged.
  update public.dishes
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_draft_dish = row_count;
  v_refs := v_refs + v_draft_dish;

  update public.weekly_special
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_draft_weekly = row_count;
  v_refs := v_refs + v_draft_weekly;

  update public.monthly_burger
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_draft_monthly = row_count;
  v_refs := v_refs + v_draft_monthly;

  -- The old row goes through the same guarded door delete_image() uses. Every
  -- reference already points at the new image, so the FKs' ON DELETE SET NULL has
  -- nothing left to null.
  perform pg_catalog.set_config('app.image_write', 'delete', true);

  delete from public.images
   where id = p_old_id
     and updated_at = p_expected_updated_at;
  get diagnostics v_deleted = row_count;

  perform pg_catalog.set_config('app.image_write', '', true);

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
    'storage_path', v_old.storage_path,
    'affected', jsonb_build_object(
      'live', jsonb_build_object(
        'dish', v_live_dish, 'weekly', v_live_weekly,
        'monthly', v_live_monthly, 'news', v_live_news),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news)));
end;
$fn$;

comment on function public.replace_image(uuid, timestamptz, uuid) is
  'The one way an image is replaced (phase 10B, draft-aware since 10C-1): repoints every image_id reference — live columns and pending draft keys alike — to an already-finalized new image and removes the old row in one transaction. Version-checked; audited as ''replace''; returns the old storage_path for trusted file cleanup and ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them (phase 10C-2). SECURITY INVOKER — RLS decides for the caller''s own JWT.';
