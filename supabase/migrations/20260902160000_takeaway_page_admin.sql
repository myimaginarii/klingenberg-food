-- Klingenberg Food — phase 11B: Mad ud af huset owns a photograph and publishes its
-- visibility, and the image reference model, the published-reference guard and the
-- two image transitions learn about both.
--
-- Technical plan section 4 ("Document shapes": takeaway carries `heading`, `intro`,
-- `image_id`, `sections`, `cta_label`; `pages.is_visible` is the Mad ud af huset
-- switch), section 5 (Mad ud af huset, including its visibility toggle, is Staff and
-- Owner), section 6 (drafts hold only the changed keys; the live document moves only
-- on publish; the immediate-path table names four operations and the switch is not
-- one of them), section 7e item 4 (an image reference is warned about and then
-- cleared — never left dangling), section 8 ("A published image reference is moved
-- outside the workflow"), section 9 (E2E 8: "Turn 'Vis siden' off → both the page and
-- the nav item disappear"), section 15 (phase 11B). Design 1aj: *"Almindelig
-- tre-trins-proces: alt gemmes som kladde, forhåndsvises på den rigtige side og går
-- først live ved Offentliggør."*
--
-- WHAT THIS MIGRATION DOES, in the same objects rather than beside them:
--
--   * `image_references` gains two rows for Mad ud af huset — the published document's
--     `image_id` (live) and the draft's (pending) — under one kind, `page:takeaway`,
--     named "Mad ud af huset". The library's caption, the delete refusal and the
--     alt-edit expiry learn about the page from the one definition of "referenced".
--   * `delete_image()` and `replace_image()` move the page's reference exactly as they
--     move the columns and the Forside's paths: the live path under the trusted
--     transition, the draft path as a pending selection, one transaction, and
--     `affected` reports the rows moved under a sixth count, `page:takeaway`, so the
--     application expires the `page:takeaway` tag when — and only when — the live
--     document changed. The draft path is a **top-level key** (unlike the Forside's
--     sections), so a confirmed delete removes the key, as it does for the column
--     entities (10C-1): "no pending change to the photo", and an emptied draft is NULL.
--   * The published-reference guard on `pages` (20260902120000) is extended to the
--     takeaway document's one image path — and to `is_visible`, for every page row:
--     a direct PostgREST write that moves the switch is refused for `anon` and
--     `authenticated` unless the statement-scoped marker names `publish`. The reason
--     is §0w's: publishing decides *when* a change becomes public and carries the
--     version check, the audit row and the public cache expiry with it; a direct
--     write of the switch would hide the page from guests up to five minutes late,
--     unaudited, and leave every open editor holding a stale token. Staff and Owner
--     are refused alike — authority to publish is not authority to bypass. Every
--     other write of `published` is exactly the write it was.
--   * `publish_page()` moves a draft's `is_visible` into the column, strips it from
--     the document merge (it is a draft key, never a document key), and raises the
--     `publish` marker around the one UPDATE so both the switch and the photograph go
--     live through the three-step path alone.
--   * `page_content()` — the publish audit's before/after — now records `is_visible`
--     beside the document, so a publish that hides or shows the page is a visible
--     transition in `audit_log`, and the recovery story (§8) names both states.
--
-- WHO MAY DETACH MAD UD AF HUSET. Both transitions are SECURITY INVOKER and spend the
-- caller's own UPDATE privilege on `pages`; `pages_update_scoped` grants the
-- `takeaway` row to `public.is_staff()`, so a Staff member's confirmed delete or
-- replacement reaches it exactly as the Owner's does. The `owner_only` refusal stays
-- what phase 11A made it — the Forside's alone.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No new table, column, index, policy or grant. No SECURITY DEFINER anywhere;
--     every function stays SECURITY INVOKER with search_path pinned.
--   * No change to the guard on the three column tables, its marker vocabulary or its
--     consumer — the consumer already sits on `pages`.
--   * No image key for `about`: its schema carries none (the phase that builds 1i's
--     editor adds its paths here, explicitly). No document walker.
--   * No parsing of arbitrary JSON: the path is a literal, and only a value shaped
--     like a uuid is ever cast.

-- ---------------------------------------------------------------------------
-- 1. The takeaway path, stated once
-- ---------------------------------------------------------------------------

/* Does this document name the image at Mad ud af huset's one image path? */
create or replace function public.takeaway_page_names_image(p_doc jsonb, p_image uuid)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_doc is not null and p_doc ->> 'image_id' = p_image::text
$fn$;

comment on function public.takeaway_page_names_image(jsonb, uuid) is
  'True when a Mad ud af huset document names the image at its top-level image_id (phase 11B).';

revoke all on function public.takeaway_page_names_image(jsonb, uuid) from public, anon;
grant execute on function public.takeaway_page_names_image(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. image_references — Mad ud af huset's two rows join the one definition
-- ---------------------------------------------------------------------------

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
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  -- The Forside (phase 11A): the three live paths of the published document, and the
  -- three pending paths of the draft — six explicit branches, one per path, rather
  -- than a document walker. One place, "Forsiden", however many of its slots name
  -- the image; the library's caption says it once.
  union all
  select (p.published #>> '{hero,image_id}')::uuid, 'page:home', p.id, 'Forsiden', false
    from public.pages p
   where p.key = 'home'
     and p.published #>> '{hero,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.published #>> '{award,image_id}')::uuid, 'page:home', p.id, 'Forsiden', false
    from public.pages p
   where p.key = 'home'
     and p.published #>> '{award,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.published #>> '{about_excerpt,image_id}')::uuid, 'page:home', p.id, 'Forsiden', false
    from public.pages p
   where p.key = 'home'
     and p.published #>> '{about_excerpt,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft #>> '{hero,image_id}')::uuid, 'page:home', p.id, 'Forsiden', true
    from public.pages p
   where p.key = 'home'
     and p.draft #>> '{hero,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft #>> '{award,image_id}')::uuid, 'page:home', p.id, 'Forsiden', true
    from public.pages p
   where p.key = 'home'
     and p.draft #>> '{award,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft #>> '{about_excerpt,image_id}')::uuid, 'page:home', p.id, 'Forsiden', true
    from public.pages p
   where p.key = 'home'
     and p.draft #>> '{about_excerpt,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  -- Mad ud af huset (phase 11B): the one live path of the published document and the
  -- one pending path of the draft. Two explicit branches, the same rule.
  union all
  select (p.published ->> 'image_id')::uuid, 'page:takeaway', p.id, 'Mad ud af huset', false
    from public.pages p
   where p.key = 'takeaway'
     and p.published ->> 'image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft ->> 'image_id')::uuid, 'page:takeaway', p.id, 'Mad ud af huset', true
    from public.pages p
   where p.key = 'takeaway'
     and p.draft ->> 'image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

comment on view public.image_references is
  'Every place an image is referenced — the four live image_id columns, the three draft image_id keys, the Forside document''s three image paths and Mad ud af huset''s one, live and pending (phases 10C-1, 11A, 11B). SECURITY INVOKER: RLS decides every row for the caller. The one definition delete_image(), replace_image(), the library''s usage labels and the alt-edit expiry all share.';

revoke all on public.image_references from public, anon, authenticated;
grant select on public.image_references to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The guard: the takeaway image path, and the switch
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE OF published, is_visible ON pages, FOR EACH ROW. The 11A shape, with
-- two additions: the takeaway document's one path, and `is_visible` on every row. A
-- text edit of a document — through publish or otherwise — is still exactly the write
-- it was.

create or replace function public.tg_guard_page_image_reference_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op    text;
  v_paths text[][];
  v_path  text[];
  v_old   text;
  v_new   text;
begin
  -- Migrations, `supabase/seed.sql` and the pgTAP fixtures arrive as postgres or
  -- service_role and are trusted with the whole table. The guard exists for the two
  -- roles a PostgREST request runs as.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  v_op := coalesce(pg_catalog.current_setting('app.image_reference_write', true), '');

  -- The switch (phase 11B): published through publish_page() alone, whichever row.
  if old.is_visible is distinct from new.is_visible and v_op <> 'publish' then
    raise exception
      'pages: is_visible is written only by publish_page() — the transition that carries the version check, the audit row and the public cache expiry (phase 11B)'
      using errcode = '42501';
  end if;

  -- Which image paths this row carries. A later page adds its own here, explicitly.
  if new.key = 'home' then
    v_paths := array[['hero', 'image_id'], ['award', 'image_id'], ['about_excerpt', 'image_id']];
  elsif new.key = 'takeaway' then
    v_paths := array[['image_id']];
  else
    return new;
  end if;

  foreach v_path slice 1 in array v_paths
  loop
    v_old := old.published #>> v_path;
    v_new := new.published #>> v_path;

    -- An unchanged path is not a write of it, whatever else the statement changed.
    if v_old is not distinct from v_new then
      continue;
    end if;

    -- Each word admits the shape of movement its transition makes, and no other:
    -- publish may set, change or clear; replace moves one image to another; detach
    -- only clears.
    if v_op = 'publish'
       or (v_op = 'replace' and v_old is not null and v_new is not null)
       or (v_op = 'detach'  and v_new is null)
    then
      continue;
    end if;

    raise exception
      'pages: the published % image (%) is written only by publish_page(), replace_image() or a confirmed delete_image() — the transitions that carry the version check, the audit row and the public cache expiry (phases 11A, 11B)',
      new.key, array_to_string(v_path, '.')
      using errcode = '42501';
  end loop;

  return new;
end;
$fn$;

comment on function public.tg_guard_page_image_reference_write() is
  'BEFORE UPDATE OF published, is_visible on pages: refuses any movement of the Forside document''s three published image paths or Mad ud af huset''s one that did not come from the publish, replace or detach transition, and any movement of is_visible that did not come from publish — recognised by the statement-scoped app.image_reference_write marker (phases 11A, 11B).';

drop trigger if exists pages_guard_image_reference_write on public.pages;
create trigger pages_guard_image_reference_write
  before update of published, is_visible on public.pages
  for each row execute function public.tg_guard_page_image_reference_write();

-- The statement-level consumer is unchanged and already attached to `pages`
-- (20260902120000): the marker dies with the statement it authorised.

-- ---------------------------------------------------------------------------
-- 4. page_content() — the audit projection records the switch
-- ---------------------------------------------------------------------------
-- Phase 4 excluded `is_visible` because nothing published it. Phase 11B publishes it,
-- so the before/after of a page publish carries it beside the document — the
-- recovery story for "somebody hid the page" is the audit row, and it has to say so.

create or replace function public.page_content(p public.pages)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select p.published || jsonb_build_object('is_visible', p.is_visible) $fn$;

-- ---------------------------------------------------------------------------
-- 5. publish_page() — the phase-4 merge, the switch, under the marker
-- ---------------------------------------------------------------------------
-- The 11A function with one addition: a draft's `is_visible` moves into the column
-- and is stripped from the document merge. Only a JSON boolean moves it — anything
-- else a stored draft might carry there leaves the column alone (the application
-- refuses such a draft as invalid_draft before this function runs in any case).

create or replace function public.publish_page(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.pages%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_merged boolean;
begin
  select * into v_row from public.pages t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.page_content(v_row);

  perform pg_catalog.set_config('app.image_reference_write', 'publish', true);

  update public.pages t
     set published  = t.published || (v_draft - 'is_visible'),
         is_visible = case when jsonb_typeof(v_draft -> 'is_visible') = 'boolean'
                           then (v_draft ->> 'is_visible')::boolean
                           else t.is_visible end,
         draft      = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;
  v_merged := found;

  perform pg_catalog.set_config('app.image_reference_write', '', true);

  if not v_merged then
    if exists (select 1 from public.pages t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.page_content(v_row);
  perform public.log_audit('publish', 'page:' || v_row.key, v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_page(uuid, timestamptz) is
  'Publishes one page document: published || draft (the draft''s is_visible moved into the column instead, phase 11B), draft cleared, audit written, one transaction (§6). Raises the publish marker around its merge, so a page image and the Mad ud af huset switch go live through the three-step path alone (phases 11A, 11B).';

-- ---------------------------------------------------------------------------
-- 6. delete_image() — Mad ud af huset's reference, live and pending
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
  v_row              public.images%rowtype;
  v_live_refs        integer;
  v_draft_refs       integer;
  v_page_refs        integer;
  v_refs             integer;
  v_before           jsonb;
  v_draft_dish       integer := 0;
  v_draft_weekly     integer := 0;
  v_draft_monthly    integer := 0;
  v_draft_news       integer := 0;
  v_draft_page       integer := 0;
  v_draft_takeaway   integer := 0;
  v_live_dish        integer := 0;
  v_live_weekly      integer := 0;
  v_live_monthly     integer := 0;
  v_live_news        integer := 0;
  v_live_page        integer := 0;
  v_live_takeaway    integer := 0;
  v_hidden_dish      integer := 0;
  v_deleted          integer;
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
         count(*) filter (where r.pending),
         count(*) filter (where r.kind = 'page:home')
    into v_live_refs, v_draft_refs, v_page_refs
    from public.image_references r
   where r.image_id = p_id;

  v_refs := v_live_refs + v_draft_refs;

  if v_refs > 0 and not p_confirmed then
    return jsonb_build_object('status', 'in_use', 'references', v_refs);
  end if;

  -- The Forside is the Owner's (§5). A caller who could not detach it would leave a
  -- dangling id behind, so the answer is a refusal before any write, never a partial
  -- transition (phase 11A). Mad ud af huset is Staff-editable and needs no such gate.
  if v_page_refs > 0 and not public.is_owner() then
    return jsonb_build_object('status', 'owner_only', 'references', v_refs);
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

  -- Mad ud af huset's pending selection (phase 11B) is a top-level key like the
  -- column entities', and leaves the draft the same way.
  update public.pages
     set draft = nullif(draft - 'image_id', '{}'::jsonb)
   where key = 'takeaway'
     and draft ->> 'image_id' = p_id::text;
  get diagnostics v_draft_takeaway = row_count;

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

  -- The Forside (phase 11A): the published document first, under `detach`, then the
  -- draft — whose pending selection returns to the published value the statement
  -- above just left there. Both run under the caller's own RLS, which admits the
  -- Owner alone; the owner_only refusal above is what keeps this from being a
  -- half-applied transition for anybody else.
  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.pages
       set published = public.home_page_image_moved(published, p_id, 'null'::jsonb)
     where key = 'home'
       and public.home_page_names_image(published, p_id)
    returning id
  )
  select count(*) into v_live_page from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  with moved as (
    update public.pages
       set draft = public.home_page_draft_detached(draft, published, p_id)
     where key = 'home'
       and public.home_page_names_image(draft, p_id)
    returning id
  )
  select count(*) into v_draft_page from moved;

  -- Mad ud af huset (phase 11B): the published document's one path, under `detach`.
  -- The row is Staff-writable (§5), so the caller's own RLS admits it.
  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.pages
       set published = jsonb_set(published, '{image_id}', 'null'::jsonb)
     where key = 'takeaway'
       and public.takeaway_page_names_image(published, p_id)
    returning id
  )
  select count(*) into v_live_takeaway from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

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
  -- under (phase 10C-2; the Forside since 11A; Mad ud af huset since 11B).
  return jsonb_build_object(
    'status', 'deleted',
    'references', v_refs,
    'storage_path', v_row.storage_path,
    'affected', jsonb_build_object(
      'live', jsonb_build_object(
        'dish', v_live_dish, 'weekly', v_live_weekly,
        'monthly', v_live_monthly, 'news', v_live_news,
        'page:home', v_live_page, 'page:takeaway', v_live_takeaway),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news,
        'page:home', v_draft_page, 'page:takeaway', v_draft_takeaway)));
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A, draft-aware since 10C-1, Forside-aware since 11A, Mad ud af huset-aware since 11B). Version-checked behind FOR UPDATE; refuses with ''in_use'' unless confirmed, counting live and draft references alike, and with ''owner_only'' when the Forside names the image and the caller is not an owner; a confirmed delete clears the image_id key from every draft, detaches the three guarded live columns, the Forside''s published paths and Mad ud af huset''s under the ''detach'' transition, returns the Forside draft''s pending selection to the published value, detaches the news column, removes the row and audits as ''delete'' — one transaction, no dangling id. Reports ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them.';

-- ---------------------------------------------------------------------------
-- 7. replace_image() — Mad ud af huset's reference repointed with the rest
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
  v_old              public.images%rowtype;
  v_new              public.images%rowtype;
  v_before           jsonb;
  v_page_refs        integer;
  v_refs             integer := 0;
  v_draft_dish       integer := 0;
  v_draft_weekly     integer := 0;
  v_draft_monthly    integer := 0;
  v_draft_news       integer := 0;
  v_draft_page       integer := 0;
  v_draft_takeaway   integer := 0;
  v_live_dish        integer := 0;
  v_live_weekly      integer := 0;
  v_live_monthly     integer := 0;
  v_live_news        integer := 0;
  v_live_page        integer := 0;
  v_live_takeaway    integer := 0;
  v_hidden_dish      integer := 0;
  v_deleted          integer;
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

  -- The Forside is the Owner's (§5): a caller who could not repoint it would leave
  -- the old id behind on a row about to be deleted (phase 11A).
  select count(*) into v_page_refs
    from public.image_references r
   where r.image_id = p_old_id and r.kind = 'page:home';

  if v_page_refs > 0 and not public.is_owner() then
    return jsonb_build_object('status', 'owner_only');
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

  -- The Forside's published paths, under `replace` (phase 11A).
  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.pages
       set published = public.home_page_image_moved(published, p_old_id, to_jsonb(p_new_id))
     where key = 'home'
       and public.home_page_names_image(published, p_old_id)
    returning id
  )
  select count(*) into v_live_page from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_page;

  -- Mad ud af huset's published path, under `replace` (phase 11B).
  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.pages
       set published = jsonb_set(published, '{image_id}', to_jsonb(p_new_id))
     where key = 'takeaway'
       and public.takeaway_page_names_image(published, p_old_id)
    returning id
  )
  select count(*) into v_live_takeaway from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_takeaway;

  -- And the pending references (phase 10C-1). jsonb_set names exactly one typed
  -- key; every other pending field in the draft is preserved unchanged.
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

  -- The Forside draft's pending selections (phase 11A): the same repointing, the
  -- same three literal paths, every other pending key untouched.
  with moved as (
    update public.pages
       set draft = public.home_page_image_moved(draft, p_old_id, to_jsonb(p_new_id))
     where key = 'home'
       and public.home_page_names_image(draft, p_old_id)
    returning id
  )
  select count(*) into v_draft_page from moved;
  v_refs := v_refs + v_draft_page;

  -- Mad ud af huset's pending selection (phase 11B): one top-level key.
  update public.pages
     set draft = jsonb_set(draft, '{image_id}', to_jsonb(p_new_id))
   where key = 'takeaway'
     and draft ->> 'image_id' = p_old_id::text;
  get diagnostics v_draft_takeaway = row_count;
  v_refs := v_refs + v_draft_takeaway;

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
        'monthly', v_live_monthly, 'news', v_live_news,
        'page:home', v_live_page, 'page:takeaway', v_live_takeaway),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news,
        'page:home', v_draft_page, 'page:takeaway', v_draft_takeaway)));
end;
$fn$;

comment on function public.replace_image(uuid, timestamptz, uuid) is
  'The one way an image is replaced (phase 10B, draft-aware since 10C-1, Forside-aware since 11A, Mad ud af huset-aware since 11B): repoints every image_id reference — live columns, pending draft keys, the Forside document''s three paths and Mad ud af huset''s one, published and pending — to an already-finalized new image and removes the old row in one transaction. Version-checked; refused with ''owner_only'' when the Forside names the image and the caller is not an owner; audited as ''replace''; returns the old storage_path for trusted file cleanup and ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them. SECURITY INVOKER — RLS decides for the caller''s own JWT.';
