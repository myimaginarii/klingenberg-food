-- Klingenberg Food — phase 14B1: Om os owns three photographs, and the image reference
-- model, the published-reference guard and the two image transitions learn about them.
--
-- Technical plan section 4 ("Document shapes": about carries `heading`, `story_blocks`,
-- `team {text, image_id}`, `method {heading, text, image_id}`, `venue_image_id`),
-- section 5 (Om os is Staff and Owner — the phase-1 `pages_update_scoped` policy admits
-- every page but `home` to `public.is_staff()`), section 6 (drafts hold only the changed
-- keys and sections; the live document moves only on publish), section 7e item 4 (an
-- image reference is warned about and then cleared — never left dangling), section 8
-- ("A published image reference is moved outside the workflow"), section 15 (phase 14B1).
-- Design 1i: the three reserved frames — "Stedet" (the facade beside the story), "Ét
-- holdfoto — fuld bredde" (the team) and "Køkken / tilberedning" (beside the method).
--
-- WHAT THIS MIGRATION DOES, in the same objects rather than beside them:
--
--   * `image_references` gains six rows for Om os — the three live paths of the
--     published document and the three pending paths of the draft — under one kind,
--     `page:about`, named "Om os". The library's caption, the delete refusal and the
--     alt-edit expiry learn about the page from the one definition of "referenced".
--   * `delete_image()` and `replace_image()` move the page's references exactly as
--     they move the columns and the other two pages' paths: the live paths under the
--     trusted transition, the draft paths as a pending selection, one transaction, and
--     `affected` reports the rows moved under a seventh count, `page:about`, so the
--     application expires the `page:about` tag when — and only when — the live document
--     changed.
--   * The published-reference guard on `pages` (20260902120000, 20260902160000) is
--     extended to the about document's three image paths. A direct PostgREST write that
--     MOVES one of them is refused for `anon` and `authenticated` unless the
--     statement-scoped `app.image_reference_write` marker names publish, replace or
--     detach — Staff and Owner alike, for §0w's reason: publishing carries the version
--     check, the audit row and the public cache expiry, and a direct write of the image
--     would leave a guest with a photograph up to five minutes late, unaudited, and
--     every open editor holding a stale token. Every other write of `published` is
--     exactly the write it was.
--
-- THE DRAFT SEMANTICS, mixed on purpose, because the document is. `venue_image_id` is a
-- **top-level key** (like Mad ud af huset's `image_id`), so a confirmed delete removes
-- the key from the draft and an emptied draft is NULL — "no pending change to the
-- photo". `team.image_id` and `method.image_id` sit **inside sections** (like the
-- Forside's), and a section in a draft must be whole, so the same meaning is expressed
-- by returning the pending path to the PUBLISHED value and dropping a section that then
-- equals its published section (20260902120000's rule, `about_page_draft_detached`).
--
-- WHO MAY DETACH OM OS. Both transitions are SECURITY INVOKER and spend the caller's
-- own UPDATE privilege on `pages`; `pages_update_scoped` grants the `about` row to
-- `public.is_staff()`, so a Staff member's confirmed delete or replacement reaches it
-- exactly as the Owner's does. The `owner_only` refusal stays what phase 11A made it —
-- the Forside's alone.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No new table, column, index, policy or grant. No SECURITY DEFINER anywhere; every
--     function stays SECURITY INVOKER with search_path pinned.
--   * No change to `publish_page()`: it merges documents and parses nothing, and the
--     marker it raises already covers every page row.
--   * No `award_image_id`. The award band on Om os states the confirmed result and its
--     photograph is the Forside document's own (`home.award.image_id`); a second award
--     source on a Staff-writable page would be two owners for one fact (§0am).
--   * No document walker: the three paths are literals, and only a value shaped like a
--     uuid is ever cast.

-- ---------------------------------------------------------------------------
-- 1. The three paths, stated once
-- ---------------------------------------------------------------------------

/* Does this document name the image at any of Om os's three image paths? */
create or replace function public.about_page_names_image(p_doc jsonb, p_image uuid)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_doc is not null and (
       p_doc ->> 'venue_image_id'        = p_image::text
    or p_doc #>> '{team,image_id}'       = p_image::text
    or p_doc #>> '{method,image_id}'     = p_image::text)
$fn$;

comment on function public.about_page_names_image(jsonb, uuid) is
  'True when an Om os document names the image at venue_image_id, team.image_id or method.image_id (phase 14B1).';

/* The document with every path that names p_old set to p_new; nothing else moves. */
create or replace function public.about_page_image_moved(p_doc jsonb, p_old uuid, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_doc    jsonb := p_doc;
  v_dotted text;
  v_path   text[];
begin
  if v_doc is null then
    return null;
  end if;

  -- The paths differ in depth (one top-level key, two nested), so they are spelled
  -- dotted and split here rather than held in a ragged array PostgreSQL cannot build.
  foreach v_dotted in array array['venue_image_id', 'team.image_id', 'method.image_id'] loop
    v_path := string_to_array(v_dotted, '.');
    if v_doc #>> v_path = p_old::text then
      v_doc := jsonb_set(v_doc, v_path, p_new);
    end if;
  end loop;

  return v_doc;
end;
$fn$;

comment on function public.about_page_image_moved(jsonb, uuid, jsonb) is
  'An Om os document with every image path naming p_old set to p_new — the replace (a uuid) and detach (JSON null) shapes share it (phase 14B1).';

/*
 * An Om os draft after the image it names has been detached. The top-level
 * `venue_image_id` leaves the draft (the Mad ud af huset rule); a nested path that
 * named the image returns to the PUBLISHED value at that path, a section that then
 * equals its published section leaves the draft (the Forside rule), and an emptied
 * draft is NULL. `'{"image_id": null}' || published_section` compares against a
 * published section that may predate the image key (the seed's), so an unchanged
 * section collapses.
 */
create or replace function public.about_page_draft_detached(p_draft jsonb, p_published jsonb, p_image uuid)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_draft   jsonb := p_draft;
  v_section text;
  v_path    text[];
begin
  if v_draft is null then
    return null;
  end if;

  if v_draft ->> 'venue_image_id' = p_image::text then
    v_draft := v_draft - 'venue_image_id';
  end if;

  foreach v_section in array array['team', 'method'] loop
    v_path := array[v_section, 'image_id'];

    if v_draft #>> v_path = p_image::text then
      v_draft := jsonb_set(v_draft, v_path, coalesce(p_published #> v_path, 'null'::jsonb));
    end if;

    if v_draft ? v_section
       and p_published -> v_section is not null
       and v_draft -> v_section = ('{"image_id": null}'::jsonb || (p_published -> v_section))
    then
      v_draft := v_draft - v_section;
    end if;
  end loop;

  return nullif(v_draft, '{}'::jsonb);
end;
$fn$;

comment on function public.about_page_draft_detached(jsonb, jsonb, uuid) is
  'An Om os draft with the pending selection of p_image cleared: the top-level facade key removed, a nested selection returned to the published value, unchanged sections dropped and an empty draft NULL (phase 14B1).';

revoke all on function public.about_page_names_image(jsonb, uuid)          from public, anon;
revoke all on function public.about_page_image_moved(jsonb, uuid, jsonb)   from public, anon;
revoke all on function public.about_page_draft_detached(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.about_page_names_image(jsonb, uuid)          to authenticated;
grant execute on function public.about_page_image_moved(jsonb, uuid, jsonb)   to authenticated;
grant execute on function public.about_page_draft_detached(jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. image_references — Om os's six rows join the one definition
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
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  -- Om os (phase 14B1): the three live paths of the published document and the three
  -- pending paths of the draft. Six explicit branches, the same rule; one place,
  -- "Om os", however many of its slots name the image.
  union all
  select (p.published ->> 'venue_image_id')::uuid, 'page:about', p.id, 'Om os', false
    from public.pages p
   where p.key = 'about'
     and p.published ->> 'venue_image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.published #>> '{team,image_id}')::uuid, 'page:about', p.id, 'Om os', false
    from public.pages p
   where p.key = 'about'
     and p.published #>> '{team,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.published #>> '{method,image_id}')::uuid, 'page:about', p.id, 'Om os', false
    from public.pages p
   where p.key = 'about'
     and p.published #>> '{method,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft ->> 'venue_image_id')::uuid, 'page:about', p.id, 'Om os', true
    from public.pages p
   where p.key = 'about'
     and p.draft ->> 'venue_image_id'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft #>> '{team,image_id}')::uuid, 'page:about', p.id, 'Om os', true
    from public.pages p
   where p.key = 'about'
     and p.draft #>> '{team,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union all
  select (p.draft #>> '{method,image_id}')::uuid, 'page:about', p.id, 'Om os', true
    from public.pages p
   where p.key = 'about'
     and p.draft #>> '{method,image_id}'
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

comment on view public.image_references is
  'Every place an image is referenced — the four live image_id columns, the three draft image_id keys, the Forside document''s three image paths, Mad ud af huset''s one and Om os''s three, live and pending (phases 10C-1, 11A, 11B, 14B1). SECURITY INVOKER: RLS decides every row for the caller. The one definition delete_image(), replace_image(), the library''s usage labels and the alt-edit expiry all share.';

revoke all on public.image_references from public, anon, authenticated;
grant select on public.image_references to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The guard: the three about paths join the list
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE OF published, is_visible ON pages, FOR EACH ROW. The 11B shape, with
-- one addition — the about document's three paths — and one restatement: the paths
-- are spelled dotted and split, because they now differ in depth within one page and
-- PostgreSQL has no ragged array. A text edit of a document — through publish or
-- otherwise — is still exactly the write it was.

create or replace function public.tg_guard_page_image_reference_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op     text;
  v_paths  text[];
  v_dotted text;
  v_path   text[];
  v_old    text;
  v_new    text;
begin
  -- Migrations, the seed files and the pgTAP fixtures arrive as postgres or
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
    v_paths := array['hero.image_id', 'award.image_id', 'about_excerpt.image_id'];
  elsif new.key = 'takeaway' then
    v_paths := array['image_id'];
  elsif new.key = 'about' then
    v_paths := array['venue_image_id', 'team.image_id', 'method.image_id'];
  else
    return new;
  end if;

  foreach v_dotted in array v_paths
  loop
    v_path := string_to_array(v_dotted, '.');
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
      'pages: the published % image (%) is written only by publish_page(), replace_image() or a confirmed delete_image() — the transitions that carry the version check, the audit row and the public cache expiry (phases 11A, 11B, 14B1)',
      new.key, v_dotted
      using errcode = '42501';
  end loop;

  return new;
end;
$fn$;

comment on function public.tg_guard_page_image_reference_write() is
  'BEFORE UPDATE OF published, is_visible on pages: refuses any movement of the Forside document''s three published image paths, Mad ud af huset''s one or Om os''s three that did not come from the publish, replace or detach transition, and any movement of is_visible that did not come from publish — recognised by the statement-scoped app.image_reference_write marker (phases 11A, 11B, 14B1).';

-- The row trigger and the statement-level consumer are unchanged and already attached
-- to `pages` (20260902120000, 20260902160000): the function body above is what moved.

-- ---------------------------------------------------------------------------
-- 4. delete_image() — Om os's references, live and pending
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
  v_draft_about      integer := 0;
  v_live_dish        integer := 0;
  v_live_weekly      integer := 0;
  v_live_monthly     integer := 0;
  v_live_news        integer := 0;
  v_live_page        integer := 0;
  v_live_takeaway    integer := 0;
  v_live_about       integer := 0;
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
  -- transition (phase 11A). Mad ud af huset and Om os are Staff-editable and need no
  -- such gate.
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

  -- Om os (phase 14B1): the published document's three paths under `detach`, then the
  -- draft — the facade key removed, a nested pending selection returned to the
  -- published value the statement above just left there. Staff-writable (§5).
  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  with moved as (
    update public.pages
       set published = public.about_page_image_moved(published, p_id, 'null'::jsonb)
     where key = 'about'
       and public.about_page_names_image(published, p_id)
    returning id
  )
  select count(*) into v_live_about from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  with moved as (
    update public.pages
       set draft = public.about_page_draft_detached(draft, published, p_id)
     where key = 'about'
       and public.about_page_names_image(draft, p_id)
    returning id
  )
  select count(*) into v_draft_about from moved;

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
  -- under (phase 10C-2; the Forside since 11A; Mad ud af huset since 11B; Om os
  -- since 14B1).
  return jsonb_build_object(
    'status', 'deleted',
    'references', v_refs,
    'storage_path', v_row.storage_path,
    'affected', jsonb_build_object(
      'live', jsonb_build_object(
        'dish', v_live_dish, 'weekly', v_live_weekly,
        'monthly', v_live_monthly, 'news', v_live_news,
        'page:home', v_live_page, 'page:takeaway', v_live_takeaway,
        'page:about', v_live_about),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news,
        'page:home', v_draft_page, 'page:takeaway', v_draft_takeaway,
        'page:about', v_draft_about)));
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A, draft-aware since 10C-1, Forside-aware since 11A, Mad ud af huset-aware since 11B, Om os-aware since 14B1). Version-checked behind FOR UPDATE; refuses with ''in_use'' unless confirmed, counting live and draft references alike, and with ''owner_only'' when the Forside names the image and the caller is not an owner; a confirmed delete clears the image_id key from every draft, detaches the three guarded live columns and the three page documents'' published paths under the ''detach'' transition, returns the Forside''s and Om os''s pending selections to the published value, detaches the news column, removes the row and audits as ''delete'' — one transaction, no dangling id. Reports ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them.';

-- ---------------------------------------------------------------------------
-- 5. replace_image() — Om os's references repointed with the rest
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
  v_draft_about      integer := 0;
  v_live_dish        integer := 0;
  v_live_weekly      integer := 0;
  v_live_monthly     integer := 0;
  v_live_news        integer := 0;
  v_live_page        integer := 0;
  v_live_takeaway    integer := 0;
  v_live_about       integer := 0;
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

  -- Om os's published paths, under `replace` (phase 14B1).
  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  with moved as (
    update public.pages
       set published = public.about_page_image_moved(published, p_old_id, to_jsonb(p_new_id))
     where key = 'about'
       and public.about_page_names_image(published, p_old_id)
    returning id
  )
  select count(*) into v_live_about from moved;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_live_about;

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

  -- Om os draft's pending selections (phase 14B1): the same three literal paths.
  with moved as (
    update public.pages
       set draft = public.about_page_image_moved(draft, p_old_id, to_jsonb(p_new_id))
     where key = 'about'
       and public.about_page_names_image(draft, p_old_id)
    returning id
  )
  select count(*) into v_draft_about from moved;
  v_refs := v_refs + v_draft_about;

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
        'page:home', v_live_page, 'page:takeaway', v_live_takeaway,
        'page:about', v_live_about),
      'draft', jsonb_build_object(
        'dish', v_draft_dish + v_hidden_dish, 'weekly', v_draft_weekly,
        'monthly', v_draft_monthly, 'news', v_draft_news,
        'page:home', v_draft_page, 'page:takeaway', v_draft_takeaway,
        'page:about', v_draft_about)));
end;
$fn$;

comment on function public.replace_image(uuid, timestamptz, uuid) is
  'The one way an image is replaced (phase 10B, draft-aware since 10C-1, Forside-aware since 11A, Mad ud af huset-aware since 11B, Om os-aware since 14B1): repoints every image_id reference — live columns, pending draft keys and the three page documents'' image paths, published and pending — to an already-finalized new image and removes the old row in one transaction. Version-checked; refused with ''owner_only'' when the Forside names the image and the caller is not an owner; audited as ''replace''; returns the old storage_path for trusted file cleanup and ''affected'' (per-kind live/draft counts of the rows it moved) so the application expires exactly the public cache tags that rendered them. SECURITY INVOKER — RLS decides for the caller''s own JWT.';
