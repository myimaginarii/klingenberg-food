-- Klingenberg Food — phase 10C-1 hardening: a published image reference is moved
-- only by the transition that owns it.
--
-- Technical plan section 5 (the permission matrix and its column-privilege
-- constraint), section 6 (Kladde → Forhåndsvis → Offentliggør: the live columns move
-- only on publish), section 7e item 4 (an image reference is warned about and then
-- moved — never left dangling), section 8 ("A trusted function is fed forged state
-- through a direct write"), section 15 (phase 10).
--
-- THE GAP THIS CLOSES. §0v recorded, for the final audit, that a Staff or Owner JWT
-- could write `dishes.image_id`, `weekly_special.image_id` and
-- `monthly_burger.image_id` directly through PostgREST — the phase-1 table grant
-- that every SECURITY INVOKER publish, replace and delete function necessarily
-- spends. The direct write carried no privilege the same person lacks through
-- Kladde → Forhåndsvis → Offentliggør, and that was the argument for accepting it.
-- The argument mistook what the workflow is for: publishing decides *when* a change
-- becomes public, and it carries the version check, the audit row and (from 10C-2)
-- the cache expiry with it. A direct UPDATE skipped all of that and changed the
-- guest's photo at once. It is closed here, narrowly.
--
-- WHY NOT A COLUMN REVOKE. The property 20260831160000 measured for the announcement
-- applies unchanged: the publish and replace functions are SECURITY INVOKER, so a
-- grant narrowed past `image_id` refuses them too, and SECURITY DEFINER is refused as
-- a way around that — it would take the transitions out from under RLS. So, exactly
-- as for `announcement`, the *transition* is constrained rather than the privilege:
-- every grant and every policy stands, and a BEFORE trigger recognises the trusted
-- transitions by a transaction-local marker.
--
-- THE MARKER, and why it is not `app.image_write`. `app.image_write` guards the
-- images row itself and is consumed by the first row it admits: one marker, one
-- row. The reference guard cannot work that way, because `replace_image()` moves
-- every reference to an image in one statement — `update public.dishes set image_id
-- = new where image_id = old` may touch any number of dishes — and a replacement
-- that admitted the first dish and refused the second would be a half-applied
-- transition. So the reference marker, `app.image_reference_write`, authorises
-- exactly ONE STATEMENT rather than one row: every row of that statement is
-- admitted, and an AFTER ... FOR EACH STATEMENT trigger clears the marker when the
-- statement ends — a zero-row statement included, and whether or not the function
-- that set it remembers to clear it (each one does, immediately). Two markers with
-- two consumption rules under one name would be a trap for the next reader, so this
-- is a second name in the same family: transaction-local, set only by the trusted
-- functions, spent by the statement it was set for, readable in one place.
--
-- A PostgREST request is one transaction holding one statement (or one RPC), so a
-- browser session has no second statement in which a marker could be used and no
-- way to set one: `set_config` is not an exposed RPC, and the only functions that
-- set this marker clear it before they return.
--
-- EVERY LEGITIMATE WRITER OF A LIVE image_id, enumerated from the source before
-- this was written, and the transition word each one says:
--
--   publish_dish() / publish_weekly_special() / publish_monthly_burger()   'publish'
--   replace_image()  — the live references old → new, on three tables       'replace'
--   delete_image()   — a confirmed delete detaches the live references     'detach'
--
-- Nothing else moves the column. set_dish_sold_out(), set_dish_deleted(), the
-- reorder, copy_weekly_special_to_draft() and every editor save write other columns
-- or `draft`, and a direct UPDATE of any of those columns is untouched by this
-- migration — the guard looks at `image_id` and nothing else. The FK referential
-- action (ON DELETE SET NULL) was measured too: PostgreSQL runs it as the table
-- owner, so the guard steps aside for it exactly as it does for a migration.
-- delete_image() nevertheless detaches the three guarded columns explicitly under
-- 'detach' before its DELETE — a transition should be readable in the function
-- that owns it rather than rest on the privilege context of a referential action —
-- and leaves `news.image_id` to the FK as before.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No guard on `news.image_id`. News has no draft column and no
--     Draft → Preview → Publish snapshot (§4); its direct-edit model was accepted
--     and locked in phase 9 and is not this migration's to reopen.
--   * No change to any grant, any policy, any other column, `app.image_write`,
--     create_image(), the sold-out guard or the touch trigger.
--   * No SECURITY DEFINER. Every function below remains SECURITY INVOKER with
--     search_path pinned; RLS still decides every row for the caller's own JWT.
--   * No new publish logic. The three publish functions are restated with the
--     marker around the one UPDATE each already had, and nothing else about them
--     changes — except one bookkeeping order, recorded at the functions: PERFORM
--     sets FOUND and ROW_COUNT (a `select set_config(...)` returns one row), so the
--     count of a guarded statement is read before the marker is cleared, never
--     after. delete_image() and replace_image() read theirs in that order now too;
--     their FOR UPDATE lock had already made the other order unreachable.

-- ---------------------------------------------------------------------------
-- 1. The guard: a live image_id moves only under a named transition
-- ---------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE OF image_id, FOR EACH ROW, on the three draft entities.
-- It reads the marker and never consumes it — consumption is the statement
-- trigger's job below — so every row of a multi-row transition is judged by the
-- same marker. The refusal is 42501, the code a missing grant produces, because
-- that is what it is from the caller's side: permission denied, decided by a rule
-- instead of by a grant. PostgREST turns it into a 403.

create or replace function public.tg_guard_image_reference_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op text;
begin
  -- Migrations, `supabase/seed.sql` and the pgTAP fixtures arrive as postgres or
  -- service_role and are trusted with the whole table; a referential action runs as
  -- the table owner. The guard exists for the two roles a PostgREST request runs
  -- as. `authenticated` is a member of no other role, so this is not an exemption
  -- a session can put on.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Only a movement of the live image_id is this guard's business. An UPDATE that
  -- names the column with its current value is not a write of it, and every other
  -- column on these tables is written exactly as before.
  if tg_op = 'UPDATE' and new.image_id is not distinct from old.image_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.image_id is null then
    return new;
  end if;

  -- No transition creates a row with a photo: a new dish is born as a draft
  -- (is_new_draft, lib/publishing/create.ts) and meets its first live image only
  -- through publish. So no marker admits an INSERT, and the vocabulary has no word
  -- for one.
  if tg_op = 'INSERT' then
    raise exception
      '%: a row is never created with a published image_id — a new dish is a draft, and its photo goes live through publish_dish() (phase 10C-1 hardening)',
      tg_table_name
      using errcode = '42501';
  end if;

  v_op := coalesce(pg_catalog.current_setting('app.image_reference_write', true), '');

  -- Each word admits the shape of movement its transition makes, and no other:
  -- publish may set, change or clear; replace moves one image to another; detach
  -- only clears.
  if v_op = 'publish'
     or (v_op = 'replace' and old.image_id is not null and new.image_id is not null)
     or (v_op = 'detach'  and new.image_id is null)
  then
    return new;
  end if;

  raise exception
    '%: the published image_id is written only by publish_dish(), publish_weekly_special(), publish_monthly_burger(), replace_image() or a confirmed delete_image() — the transitions that carry the version check, the audit row and the public cache expiry (phase 10C-1 hardening)',
    tg_table_name
    using errcode = '42501';
end;
$fn$;

comment on function public.tg_guard_image_reference_write() is
  'BEFORE INSERT/UPDATE OF image_id on dishes, weekly_special and monthly_burger: refuses any movement of the published image reference that did not come from the publish, replace or detach transition, recognised by the statement-scoped app.image_reference_write marker (phase 10C-1 hardening).';

-- ---------------------------------------------------------------------------
-- 2. The consumer: the marker dies with the statement it authorised
-- ---------------------------------------------------------------------------
-- AFTER INSERT OR UPDATE, FOR EACH STATEMENT, on the same three tables. Statement
-- triggers fire whether the statement moved many rows, one or none, so a marker
-- raised for a statement that found nothing to move is spent all the same, and a
-- marker cannot be held open for a later statement in the same transaction.

create or replace function public.tg_consume_image_reference_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  return null;
end;
$fn$;

comment on function public.tg_consume_image_reference_write() is
  'AFTER INSERT/UPDATE FOR EACH STATEMENT on dishes, weekly_special and monthly_burger: clears app.image_reference_write, so the marker authorises exactly the one statement it was raised for — rows moved or not (phase 10C-1 hardening).';

drop trigger if exists dishes_guard_image_reference on public.dishes;
create trigger dishes_guard_image_reference
  before insert or update of image_id on public.dishes
  for each row execute function public.tg_guard_image_reference_write();

drop trigger if exists dishes_consume_image_reference on public.dishes;
create trigger dishes_consume_image_reference
  after insert or update on public.dishes
  for each statement execute function public.tg_consume_image_reference_write();

drop trigger if exists weekly_special_guard_image_reference on public.weekly_special;
create trigger weekly_special_guard_image_reference
  before insert or update of image_id on public.weekly_special
  for each row execute function public.tg_guard_image_reference_write();

drop trigger if exists weekly_special_consume_image_reference on public.weekly_special;
create trigger weekly_special_consume_image_reference
  after insert or update on public.weekly_special
  for each statement execute function public.tg_consume_image_reference_write();

drop trigger if exists monthly_burger_guard_image_reference on public.monthly_burger;
create trigger monthly_burger_guard_image_reference
  before insert or update of image_id on public.monthly_burger
  for each row execute function public.tg_guard_image_reference_write();

drop trigger if exists monthly_burger_consume_image_reference on public.monthly_burger;
create trigger monthly_burger_consume_image_reference
  after insert or update on public.monthly_burger
  for each statement execute function public.tg_consume_image_reference_write();

revoke all on function public.tg_guard_image_reference_write()   from public, anon, authenticated;
revoke all on function public.tg_consume_image_reference_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The three publish transitions say 'publish'
-- ---------------------------------------------------------------------------
-- Byte-for-byte the phase-4 functions (20260829140000), with the marker raised
-- immediately before the one UPDATE and cleared immediately after it. The
-- affected-row count is read between the two, because PERFORM would overwrite it;
-- `if not found` becomes `if v_count = 0` for the same reason. The `forbidden`
-- probe, the audit row and the reply are unchanged.

create or replace function public.publish_dish(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.dishes%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_count  integer;
begin
  select * into v_row from public.dishes t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.dish_content(v_row);

  -- This statement is the publish transition for image_id (20260901200000).
  perform pg_catalog.set_config('app.image_reference_write', 'publish', true);

  update public.dishes t set
    category_id    = case when v_draft ? 'category_id'    then coalesce((v_draft ->> 'category_id')::uuid, t.category_id) else t.category_id    end,
    name           = case when v_draft ? 'name'           then coalesce(v_draft ->> 'name', t.name)                       else t.name           end,
    description    = case when v_draft ? 'description'    then v_draft ->> 'description'                                  else t.description    end,
    secondary_note = case when v_draft ? 'secondary_note' then v_draft ->> 'secondary_note'                               else t.secondary_note end,
    price_ore      = case when v_draft ? 'price_ore'      then (v_draft ->> 'price_ore')::integer                         else t.price_ore      end,
    labels         = case when v_draft ? 'labels'         then public.jsonb_text_array(v_draft -> 'labels', t.labels)     else t.labels         end,
    details        = case when v_draft ? 'details'        then public.jsonb_nullif_null(v_draft -> 'details')             else t.details        end,
    image_id       = case when v_draft ? 'image_id'       then (v_draft ->> 'image_id')::uuid                             else t.image_id       end,
    sort_order     = case when v_draft ? 'sort_order'     then coalesce((v_draft ->> 'sort_order')::integer, t.sort_order) else t.sort_order    end,
    is_new_draft   = false,
    draft          = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;
  get diagnostics v_count = row_count;

  perform pg_catalog.set_config('app.image_reference_write', '', true);

  if v_count = 0 then
    if exists (select 1 from public.dishes t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.dish_content(v_row);
  perform public.log_audit('publish', 'dish', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_dish(uuid, timestamptz) is
  'Publishes one dish and clears is_new_draft in the same statement. Udsolgt and delete stay immediate (§6). The one publish transition for dishes.image_id (phase 10C-1 hardening).';


create or replace function public.publish_weekly_special(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.weekly_special%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_count  integer;
begin
  select * into v_row from public.weekly_special t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.weekly_special_content(v_row);

  -- This statement is the publish transition for image_id (20260901200000).
  perform pg_catalog.set_config('app.image_reference_write', 'publish', true);

  update public.weekly_special t set
    iso_year        = case when v_draft ? 'iso_year'        then (v_draft ->> 'iso_year')::integer                  else t.iso_year        end,
    iso_week        = case when v_draft ? 'iso_week'        then (v_draft ->> 'iso_week')::integer                  else t.iso_week        end,
    days            = case when v_draft ? 'days'            then public.jsonb_text_array(v_draft -> 'days', t.days) else t.days            end,
    name            = case when v_draft ? 'name'            then v_draft ->> 'name'                                 else t.name            end,
    description     = case when v_draft ? 'description'     then v_draft ->> 'description'                          else t.description     end,
    price_small_ore = case when v_draft ? 'price_small_ore' then (v_draft ->> 'price_small_ore')::integer            else t.price_small_ore end,
    price_large_ore = case when v_draft ? 'price_large_ore' then (v_draft ->> 'price_large_ore')::integer            else t.price_large_ore end,
    image_id        = case when v_draft ? 'image_id'        then (v_draft ->> 'image_id')::uuid                      else t.image_id        end,
    sat_enabled     = case when v_draft ? 'sat_enabled'     then coalesce((v_draft ->> 'sat_enabled')::boolean, false) else t.sat_enabled   end,
    sat_name        = case when v_draft ? 'sat_name'        then v_draft ->> 'sat_name'                             else t.sat_name        end,
    sat_description = case when v_draft ? 'sat_description' then v_draft ->> 'sat_description'                      else t.sat_description end,
    sat_price_ore   = case when v_draft ? 'sat_price_ore'   then (v_draft ->> 'sat_price_ore')::integer              else t.sat_price_ore   end,
    sat_deadline    = case when v_draft ? 'sat_deadline'    then v_draft ->> 'sat_deadline'                         else t.sat_deadline    end,
    draft           = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;
  get diagnostics v_count = row_count;

  perform pg_catalog.set_config('app.image_reference_write', '', true);

  if v_count = 0 then
    if exists (select 1 from public.weekly_special t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.weekly_special_content(v_row);
  perform public.log_audit('publish', 'weekly_special', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_weekly_special(uuid, timestamptz) is
  'Publishes Ugens ret and Loerdagsmenu together. Both sold-out fields stay on the immediate path (§6). The one publish transition for weekly_special.image_id (phase 10C-1 hardening).';


create or replace function public.publish_monthly_burger(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.monthly_burger%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_count  integer;
begin
  select * into v_row from public.monthly_burger t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.monthly_burger_content(v_row);

  -- This statement is the publish transition for image_id (20260901200000).
  perform pg_catalog.set_config('app.image_reference_write', 'publish', true);

  -- Publishing is still a human action even when starts_on is in the future: the date
  -- window only decides whether an already-published burger is currently shown (§7d).
  update public.monthly_burger t set
    name             = case when v_draft ? 'name'             then v_draft ->> 'name'                                     else t.name             end,
    description      = case when v_draft ? 'description'      then v_draft ->> 'description'                              else t.description      end,
    price_ore        = case when v_draft ? 'price_ore'        then (v_draft ->> 'price_ore')::integer                     else t.price_ore        end,
    image_id         = case when v_draft ? 'image_id'         then (v_draft ->> 'image_id')::uuid                         else t.image_id         end,
    starts_on        = case when v_draft ? 'starts_on'        then (v_draft ->> 'starts_on')::date                        else t.starts_on        end,
    ends_on          = case when v_draft ? 'ends_on'          then (v_draft ->> 'ends_on')::date                          else t.ends_on          end,
    show_on_homepage = case when v_draft ? 'show_on_homepage' then coalesce((v_draft ->> 'show_on_homepage')::boolean, false) else t.show_on_homepage end,
    draft            = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;
  get diagnostics v_count = row_count;

  perform pg_catalog.set_config('app.image_reference_write', '', true);

  if v_count = 0 then
    if exists (select 1 from public.monthly_burger t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.monthly_burger_content(v_row);
  perform public.log_audit('publish', 'monthly_burger', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_monthly_burger(uuid, timestamptz) is
  'Publishes Maanedens burger. The date window is a read-time filter, never a scheduler (§7d). The one publish transition for monthly_burger.image_id (phase 10C-1 hardening).';

-- ---------------------------------------------------------------------------
-- 4. delete_image() detaches the live references itself, under 'detach'
-- ---------------------------------------------------------------------------
-- The 10C-1 contract stands whole (20260901180000): FOR UPDATE, the version check,
-- the in_use refusal counted from image_references, the draft detach of exactly one
-- typed key, the audit before-document with its reference counts, the storage_path
-- reply. The one addition: the three guarded live columns are cleared by this
-- function, each in one statement under the 'detach' marker, before the DELETE —
-- so the transition is readable here, and the FK finds nothing left to null on
-- them. `news.image_id` is still nulled by its FK, exactly as before.

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

  -- Then the live references, one guarded statement each (20260901200000). The
  -- touch triggers stamp the moved rows, so an open editor sees an honest conflict,
  -- exactly as the FK's SET NULL stamped them before.
  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  update public.dishes set image_id = null where image_id = p_id;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  update public.weekly_special set image_id = null where image_id = p_id;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  perform pg_catalog.set_config('app.image_reference_write', 'detach', true);
  update public.monthly_burger set image_id = null where image_id = p_id;
  perform pg_catalog.set_config('app.image_reference_write', '', true);

  -- The row itself, through the images guard's own door. Only news can still hold
  -- a live reference here, and its FK nulls it.
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
  -- failed removal leaves orphaned bytes, never a dangling reference.
  return jsonb_build_object(
    'status', 'deleted', 'references', v_refs, 'storage_path', v_row.storage_path);
end;
$fn$;

comment on function public.delete_image(uuid, timestamptz, boolean) is
  'The one way an images row is removed (phase 10A, draft-aware since 10C-1). Version-checked behind FOR UPDATE; refuses with ''in_use'' unless confirmed, counting live and draft references alike; a confirmed delete clears the image_id key from every draft, detaches the three guarded live columns under the ''detach'' transition and lets the news FK null its own, all in one transaction; audited as ''delete'' with the content and the cleared reference counts.';

-- ---------------------------------------------------------------------------
-- 5. replace_image() says 'replace' for each guarded live statement
-- ---------------------------------------------------------------------------
-- The 10B/10C-1 contract stands whole: the new image is a finished library row
-- before this runs, one transaction repoints every reference — the four live
-- columns and the three draft keys — and removes the old row, storage cleanup
-- happens only after commit, one audit row names both storage paths. The marker
-- is raised before each of the three guarded live UPDATEs and cleared after it;
-- the news UPDATE and the draft UPDATEs are not guarded and raise none.

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
  -- open editor sees an honest conflict. The three guarded columns move under the
  -- 'replace' transition, one statement each, however many rows it reaches
  -- (20260901200000); the count is read before the marker is cleared.
  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  update public.dishes set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_moved;

  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  update public.weekly_special set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
  v_refs := v_refs + v_moved;

  perform pg_catalog.set_config('app.image_reference_write', 'replace', true);
  update public.monthly_burger set image_id = p_new_id where image_id = p_old_id;
  get diagnostics v_moved = row_count;
  perform pg_catalog.set_config('app.image_reference_write', '', true);
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
    'storage_path', v_old.storage_path);
end;
$fn$;

comment on function public.replace_image(uuid, timestamptz, uuid) is
  'The one way an image is replaced (phase 10B, draft-aware since 10C-1): repoints every image_id reference — live columns and pending draft keys alike — to an already-finalized new image and removes the old row in one transaction, the three guarded live columns under the ''replace'' transition. Version-checked; audited as ''replace''; returns the old storage_path for trusted file cleanup. SECURITY INVOKER — RLS decides for the caller''s own JWT.';
