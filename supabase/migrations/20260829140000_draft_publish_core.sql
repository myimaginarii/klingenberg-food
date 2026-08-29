-- Klingenberg Food — draft/publish core (technical plan §4, §5, §6, §8).
--
-- Phase 4. The initial migration already gave every draft-enabled table its nullable
-- `draft jsonb` column. This migration adds the half that turns a draft into live
-- content, and it adds it in the database rather than in the application because §6
-- requires publishing to be one transaction:
--
--     "in one transaction merges `draft` into the columns, nulls `draft`, writes an
--      `audit_log` row, and calls revalidateTag() for the affected pages."
--
-- Several independent PostgREST calls cannot provide that. A crash between "apply the
-- draft" and "write the audit row" would leave live content changed with no record of
-- who changed it, and a crash between "apply" and "clear" would leave a draft that
-- silently republishes itself later. One function per entity, called once over the
-- wire, runs inside PostgREST's own statement transaction: every statement in it
-- commits together, or none of them does.
--
-- ---------------------------------------------------------------------------------
-- WHY THERE IS NO GENERIC `publish(table_name, id)`
-- ---------------------------------------------------------------------------------
--
-- A single function taking a table name would need dynamic SQL, and a privileged
-- function that executes a caller-supplied identifier is the most dangerous shape a
-- database function can have. Every function below names its table, its columns and
-- its casts literally. There is no `format()`, no `execute`, and no identifier that
-- comes from a parameter anywhere in this file. The cost is repetition; the benefit
-- is that each one can be read in full and understood on its own.
--
-- ---------------------------------------------------------------------------------
-- WHY THEY ARE SECURITY INVOKER
-- ---------------------------------------------------------------------------------
--
-- Every publish function runs with the caller's own privileges, so the RLS policies
-- written in the initial migration still decide what may be written. A staff member
-- calling `publish_page()` on the Forsiden row updates zero rows — the owner-only
-- USING clause filters it out — and the function reports `forbidden` rather than
-- succeeding. That keeps §5's two independent enforcement points intact: the Server
-- Action checks the role, and the database checks it again through the user's own JWT.
--
-- `public.log_audit()` remains the single SECURITY DEFINER door into `audit_log`; it
-- stamps `actor_id` from the JWT, so a publish cannot forge attribution.
--
-- ---------------------------------------------------------------------------------
-- RESULT SHAPE
-- ---------------------------------------------------------------------------------
--
-- Every function returns one jsonb object carrying a `status`:
--
--   published            the draft is live, `draft` is null, an audit row exists
--   conflict             `updated_at` moved since the editor loaded the row (§6)
--   nothing_to_publish   there is no draft, or the item is already published
--   not_found            no such row, or the caller may not even read it
--   forbidden            the caller may read the row but not write it (RLS said no)
--
-- Only `published` performs a write. Every other status returns before anything has
-- been changed, so a failed publish leaves live content, the draft and the audit log
-- exactly as they were — which is what §6 requires and what the pgTAP suite asserts.


-- ===========================================================================
-- 1. Small value helpers
-- ===========================================================================
--
-- A draft holds only the fields that were edited, so every merge below asks
-- `draft ? 'column'` — "was this column edited?" — rather than `draft ->> 'column' is
-- not null`. That distinction is the whole reason a partial draft cannot blank an
-- untouched value, and it is also what makes an explicit `null` in a draft mean
-- "clear this field" rather than "leave it alone".
--
-- `->>` already yields SQL NULL for a JSON null, so scalar columns need no helper.
-- These two exist for the shapes where it does not: a jsonb column, and a text[].

create or replace function public.jsonb_nullif_null(p_value jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select case when p_value is null or jsonb_typeof(p_value) = 'null' then null else p_value end;
$fn$;

comment on function public.jsonb_nullif_null(jsonb) is
  'SQL NULL for a JSON null, so an explicitly cleared jsonb draft field clears the column.';

create or replace function public.jsonb_text_array(p_value jsonb, p_fallback text[])
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'array' then p_fallback
    else coalesce(
      (select array_agg(element #>> '{}' order by ordinality)
         from jsonb_array_elements(p_value) with ordinality as t(element, ordinality)),
      '{}'::text[])
  end;
$fn$;

comment on function public.jsonb_text_array(jsonb, text[]) is
  'A jsonb array of strings as text[], order preserved; the fallback for any other shape.';

revoke all on function public.jsonb_nullif_null(jsonb)           from public, anon;
revoke all on function public.jsonb_text_array(jsonb, text[])    from public, anon;
grant execute on function public.jsonb_nullif_null(jsonb)        to authenticated;
grant execute on function public.jsonb_text_array(jsonb, text[]) to authenticated;


-- ===========================================================================
-- 2. Content projections — what `before` and `after` mean for each entity
-- ===========================================================================
--
-- Publishing must record a correct before and after state. These functions define,
-- once per entity, exactly which columns are "the content": the publishable fields and
-- nothing else. Each is used twice inside its publish function — for `before` and for
-- `after` — so the audit projection cannot drift from the merge above it.
--
-- Deliberately excluded everywhere: `id`, `created_at`, `updated_at`, `updated_by`,
-- `draft`, and every immediate-path or server-controlled field (`sold_out_on`,
-- `deleted_at`, `is_new_draft`, `is_visible`, `source`, `previous`, `author_id`).
-- Those are not published, so they are not part of a publish record.
--
-- They take a table rowtype, which also makes them addressable as PostgREST computed
-- columns. EXECUTE is revoked from `anon` on every one, and `authenticated` may
-- already read the underlying columns, so this grants no role any new reach.

create or replace function public.page_content(p public.pages)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select p.published $fn$;

create or replace function public.site_contact_content(c public.site_contact)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'venue_name',      c.venue_name,
    'address_line1',   c.address_line1,
    'postal_code',     c.postal_code,
    'city',            c.city,
    'primary_phone',   c.primary_phone,
    'secondary_phone', c.secondary_phone,
    'email',           c.email,
    'facebook_url',    c.facebook_url,
    'map_attribution', c.map_attribution)
$fn$;

create or replace function public.opening_hours_content(h public.opening_hours)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select jsonb_build_object('schedule', h.schedule) $fn$;

create or replace function public.announcement_content(a public.announcement)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'message',    a.message,
    'link_type',  a.link_type,
    'link_page',  a.link_page,
    'link_url',   a.link_url,
    'link_label', a.link_label,
    'expires_at', a.expires_at)
$fn$;

create or replace function public.menu_category_content(c public.menu_categories)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'name',       c.name,
    'intro',      c.intro,
    'note',       c.note,
    'sort_order', c.sort_order)
$fn$;

create or replace function public.dish_content(d public.dishes)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'category_id',    d.category_id,
    'name',           d.name,
    'description',    d.description,
    'secondary_note', d.secondary_note,
    'price_ore',      d.price_ore,
    'labels',         to_jsonb(d.labels),
    'details',        d.details,
    'image_id',       d.image_id,
    'sort_order',     d.sort_order)
$fn$;

create or replace function public.weekly_special_content(w public.weekly_special)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'iso_year',        w.iso_year,
    'iso_week',        w.iso_week,
    'days',            to_jsonb(w.days),
    'name',            w.name,
    'description',     w.description,
    'price_small_ore', w.price_small_ore,
    'price_large_ore', w.price_large_ore,
    'image_id',        w.image_id,
    'sat_enabled',     w.sat_enabled,
    'sat_name',        w.sat_name,
    'sat_description', w.sat_description,
    'sat_price_ore',   w.sat_price_ore,
    'sat_deadline',    w.sat_deadline)
$fn$;

create or replace function public.monthly_burger_content(m public.monthly_burger)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'name',             m.name,
    'description',      m.description,
    'price_ore',        m.price_ore,
    'image_id',         m.image_id,
    'starts_on',        m.starts_on,
    'ends_on',          m.ends_on,
    'show_on_homepage', m.show_on_homepage)
$fn$;

create or replace function public.news_content(n public.news)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'title',        n.title,
    'slug',         n.slug,
    'status',       n.status,
    'published_at', n.published_at)
$fn$;

create or replace function public.opening_hours_override_content(o public.opening_hours_overrides)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'date',      o.date,
    'kind',      o.kind,
    'opens_at',  o.opens_at,
    'closes_at', o.closes_at,
    'status',    o.status)
$fn$;

revoke all on function public.page_content(public.pages)                    from public, anon;
revoke all on function public.site_contact_content(public.site_contact)     from public, anon;
revoke all on function public.opening_hours_content(public.opening_hours)   from public, anon;
revoke all on function public.announcement_content(public.announcement)     from public, anon;
revoke all on function public.menu_category_content(public.menu_categories) from public, anon;
revoke all on function public.dish_content(public.dishes)                   from public, anon;
revoke all on function public.weekly_special_content(public.weekly_special) from public, anon;
revoke all on function public.monthly_burger_content(public.monthly_burger) from public, anon;
revoke all on function public.news_content(public.news)                     from public, anon;
revoke all on function public.opening_hours_override_content(public.opening_hours_overrides)
  from public, anon;

grant execute on function public.page_content(public.pages)                    to authenticated;
grant execute on function public.site_contact_content(public.site_contact)     to authenticated;
grant execute on function public.opening_hours_content(public.opening_hours)   to authenticated;
grant execute on function public.announcement_content(public.announcement)     to authenticated;
grant execute on function public.menu_category_content(public.menu_categories) to authenticated;
grant execute on function public.dish_content(public.dishes)                   to authenticated;
grant execute on function public.weekly_special_content(public.weekly_special) to authenticated;
grant execute on function public.monthly_burger_content(public.monthly_burger) to authenticated;
grant execute on function public.news_content(public.news)                     to authenticated;
grant execute on function public.opening_hours_override_content(public.opening_hours_overrides)
  to authenticated;


-- ===========================================================================
-- 3. Publish functions
-- ===========================================================================
--
-- Every one of them follows the same six steps, in the same order:
--
--   1. read the row (RLS decides whether it is even visible)
--   2. refuse politely if there is nothing to publish
--   3. refuse politely if `updated_at` has moved since the editor loaded it (§6)
--   4. capture the previous live values, merge the draft, clear the draft — with the
--      version check repeated inside the UPDATE, so the decision to publish is one
--      atomic statement and two simultaneous publishes cannot both win
--   5. write the audit row through public.log_audit()
--   6. return the before/after pair the Server Action reports and the dashboard shows
--
-- Steps 4 and 5 are in one transaction by construction: PostgREST wraps the whole
-- function call in one, so a failure anywhere rolls back the merge, the cleared draft
-- and the audit row together.
--
-- The merge itself is written column by column with `draft ? 'column'`. A column the
-- draft does not mention keeps its live value; a column the draft sets to JSON null is
-- cleared. Nothing else can happen, because no other column is named.
--
-- Reading the row without FOR UPDATE is deliberate. The lock that matters is the one
-- the UPDATE takes, and its WHERE clause repeats the version check, so the read above
-- it only decides which polite refusal to return. When the UPDATE changes no row after
-- a passing pre-check there are exactly two possible causes — RLS refused the write,
-- or another session published in between — and the EXISTS probe tells them apart.


-- --- pages (Forsiden is owner-only; the other two are staff) ----------------------
--
-- `published` is itself a document, so the merge is a shallow jsonb merge rather than
-- a column list: `published || draft` replaces exactly the top-level sections the
-- draft carries and leaves every other section untouched. The Zod schema in
-- lib/schemas/page-documents.ts is what guarantees a section in a draft is complete.

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
begin
  select * into v_row from public.pages t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.page_content(v_row);

  update public.pages t
     set published = t.published || v_draft,
         draft     = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
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
  'Publishes one page document: published || draft, draft cleared, audit written, one transaction (§6).';


-- --- site_contact (owner only) ----------------------------------------------------

create or replace function public.publish_site_contact(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.site_contact%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.site_contact t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.site_contact_content(v_row);

  update public.site_contact t set
    venue_name      = case when v_draft ? 'venue_name'      then v_draft ->> 'venue_name'      else t.venue_name      end,
    address_line1   = case when v_draft ? 'address_line1'   then v_draft ->> 'address_line1'   else t.address_line1   end,
    postal_code     = case when v_draft ? 'postal_code'     then v_draft ->> 'postal_code'     else t.postal_code     end,
    city            = case when v_draft ? 'city'            then v_draft ->> 'city'            else t.city            end,
    primary_phone   = case when v_draft ? 'primary_phone'   then v_draft ->> 'primary_phone'   else t.primary_phone   end,
    secondary_phone = case when v_draft ? 'secondary_phone' then v_draft ->> 'secondary_phone' else t.secondary_phone end,
    email           = case when v_draft ? 'email'           then v_draft ->> 'email'           else t.email           end,
    facebook_url    = case when v_draft ? 'facebook_url'    then v_draft ->> 'facebook_url'    else t.facebook_url    end,
    map_attribution = case when v_draft ? 'map_attribution' then v_draft ->> 'map_attribution' else t.map_attribution end,
    draft           = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
    if exists (select 1 from public.site_contact t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.site_contact_content(v_row);
  perform public.log_audit('publish', 'site_contact', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_site_contact(uuid, timestamptz) is
  'Publishes the contact facts. Owner-only through RLS, which this SECURITY INVOKER function keeps in force (§5).';


-- --- opening_hours (owner only) ---------------------------------------------------

create or replace function public.publish_opening_hours(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.opening_hours%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.opening_hours t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.opening_hours_content(v_row);

  -- `schedule` is NOT NULL and shape-checked, so a draft that omits it publishes
  -- nothing new and a draft that nulls it is rejected by the constraint rather than
  -- silently accepted.
  update public.opening_hours t set
    schedule = case when v_draft ? 'schedule' then v_draft -> 'schedule' else t.schedule end,
    draft    = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
    if exists (select 1 from public.opening_hours t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.opening_hours_content(v_row);
  perform public.log_audit('publish', 'opening_hours', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_opening_hours(uuid, timestamptz) is
  'Publishes the weekly opening hours. Owner-only through RLS (§5).';


-- --- announcement (staff) ---------------------------------------------------------
--
-- `is_visible` is deliberately not merged. Showing and hiding the bar is the immediate
-- path in §6 with its own 10 s Fortryd, so it never travels through a draft.

create or replace function public.publish_announcement(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.announcement%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.announcement t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.announcement_content(v_row);

  update public.announcement t set
    message    = case when v_draft ? 'message'    then v_draft ->> 'message'                 else t.message    end,
    link_type  = case when v_draft ? 'link_type'  then coalesce(v_draft ->> 'link_type', 'none') else t.link_type  end,
    link_page  = case when v_draft ? 'link_page'  then v_draft ->> 'link_page'                else t.link_page  end,
    link_url   = case when v_draft ? 'link_url'   then v_draft ->> 'link_url'                 else t.link_url   end,
    link_label = case when v_draft ? 'link_label' then v_draft ->> 'link_label'               else t.link_label end,
    expires_at = case when v_draft ? 'expires_at' then (v_draft ->> 'expires_at')::timestamptz else t.expires_at end,
    draft      = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
    if exists (select 1 from public.announcement t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.announcement_content(v_row);
  perform public.log_audit('publish', 'announcement', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_announcement(uuid, timestamptz) is
  'Publishes an edited announcement. Showing and hiding it is the immediate path and never a draft (§6).';


-- --- menu_categories (staff) ------------------------------------------------------
--
-- `slug` is not merged: it is the anchor a visitor may have linked to (#menu-burgere)
-- and part of the route, not editable content. `kind` and `visible` are structure and
-- an immediate toggle respectively, so neither is a draft field either.

create or replace function public.publish_menu_category(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.menu_categories%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.menu_categories t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.menu_category_content(v_row);

  update public.menu_categories t set
    name       = case when v_draft ? 'name'       then coalesce(v_draft ->> 'name', t.name)          else t.name       end,
    intro      = case when v_draft ? 'intro'      then v_draft ->> 'intro'                           else t.intro      end,
    note       = case when v_draft ? 'note'       then v_draft ->> 'note'                            else t.note       end,
    sort_order = case when v_draft ? 'sort_order' then coalesce((v_draft ->> 'sort_order')::integer, t.sort_order) else t.sort_order end,
    draft      = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
    if exists (select 1 from public.menu_categories t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.menu_category_content(v_row);
  perform public.log_audit('publish', 'menu_category', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_menu_category(uuid, timestamptz) is
  'Publishes one menu section. Slug, kind and visibility are not draft fields (§4, §6).';


-- --- dishes (staff) ---------------------------------------------------------------
--
-- The one place where publishing changes more than the content columns: a dish that
-- has never been live carries `is_new_draft = true`, which is what keeps it out of the
-- public menu. Publishing is the moment that flag is cleared, in the same statement as
-- the merge, so the dish becoming public and the draft being cleared cannot separate.
--
-- `sold_out_on` and `deleted_at` are absent for the same reason as `is_visible` above:
-- both are the immediate path with a 10 s Fortryd, never a draft (§6).

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
begin
  select * into v_row from public.dishes t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.dish_content(v_row);

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

  if not found then
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
  'Publishes one dish and clears is_new_draft in the same statement. Udsolgt and delete stay immediate (§6).';


-- --- weekly_special (staff) -------------------------------------------------------

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
begin
  select * into v_row from public.weekly_special t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.weekly_special_content(v_row);

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

  if not found then
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
  'Publishes Ugens ret and Loerdagsmenu together. Both sold-out fields stay on the immediate path (§6).';


-- --- monthly_burger (staff) -------------------------------------------------------

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
begin
  select * into v_row from public.monthly_burger t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.monthly_burger_content(v_row);

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

  if not found then
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
  'Publishes Maanedens burger. The date window is a read-time filter, never a scheduler (§7d).';


-- --- news (staff) -----------------------------------------------------------------
--
-- News has no `draft` column: an article is pending because its `status` is still
-- 'draft' (§4). Publishing therefore flips the status and stamps `published_at` the
-- first time only, so republishing after an unpublish restores the same URL and the
-- same original date rather than inventing a new one (§7f).

create or replace function public.publish_news(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.news%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.news t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status = 'published' then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_before := public.news_content(v_row);

  update public.news t set
    status       = 'published',
    published_at = coalesce(t.published_at, now())
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.status = 'draft'
  returning * into v_row;

  if not found then
    if exists (select 1 from public.news t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.status = 'draft')
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.news_content(v_row);
  perform public.log_audit('publish', 'news', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_news(uuid, timestamptz) is
  'Publishes one article. published_at is stamped once, so a republished article keeps its original date (§7f).';


-- --- opening_hours_overrides (staff) ----------------------------------------------
--
-- Like news, an override is pending through its `status` rather than a draft column.

create or replace function public.publish_opening_hours_override(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.opening_hours_overrides%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.opening_hours_overrides t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status = 'published' then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_before := public.opening_hours_override_content(v_row);

  update public.opening_hours_overrides t set status = 'published'
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.status = 'draft'
  returning * into v_row;

  if not found then
    if exists (select 1 from public.opening_hours_overrides t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.status = 'draft')
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.opening_hours_override_content(v_row);
  perform public.log_audit('publish', 'opening_hours_override', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_opening_hours_override(uuid, timestamptz) is
  'Publishes one one-off opening-hours change (§4, §7e).';


-- --- EXECUTE grants ---------------------------------------------------------------
--
-- Supabase grants EXECUTE on every new public function to `anon` and `authenticated`
-- by default, and an explicit grant survives a revoke aimed only at PUBLIC. `anon` is
-- therefore named on every line. There is no path by which an anonymous request can
-- call a publish function, and supabase/tests/005_publish.test.sql asserts it.

revoke all on function public.publish_page(uuid, timestamptz)                     from public, anon;
revoke all on function public.publish_site_contact(uuid, timestamptz)             from public, anon;
revoke all on function public.publish_opening_hours(uuid, timestamptz)            from public, anon;
revoke all on function public.publish_announcement(uuid, timestamptz)             from public, anon;
revoke all on function public.publish_menu_category(uuid, timestamptz)            from public, anon;
revoke all on function public.publish_dish(uuid, timestamptz)                     from public, anon;
revoke all on function public.publish_weekly_special(uuid, timestamptz)           from public, anon;
revoke all on function public.publish_monthly_burger(uuid, timestamptz)           from public, anon;
revoke all on function public.publish_news(uuid, timestamptz)                     from public, anon;
revoke all on function public.publish_opening_hours_override(uuid, timestamptz)   from public, anon;

grant execute on function public.publish_page(uuid, timestamptz)                   to authenticated;
grant execute on function public.publish_site_contact(uuid, timestamptz)           to authenticated;
grant execute on function public.publish_opening_hours(uuid, timestamptz)          to authenticated;
grant execute on function public.publish_announcement(uuid, timestamptz)           to authenticated;
grant execute on function public.publish_menu_category(uuid, timestamptz)          to authenticated;
grant execute on function public.publish_dish(uuid, timestamptz)                   to authenticated;
grant execute on function public.publish_weekly_special(uuid, timestamptz)         to authenticated;
grant execute on function public.publish_monthly_burger(uuid, timestamptz)         to authenticated;
grant execute on function public.publish_news(uuid, timestamptz)                   to authenticated;
grant execute on function public.publish_opening_hours_override(uuid, timestamptz) to authenticated;


-- ===========================================================================
-- 4. Who last edited it
-- ===========================================================================
--
-- The dashboard lists pending changes "per item, with who last edited it" (§6). Every
-- draft-bearing table already records `updated_by`, but turning that uuid into a name
-- means reading `public.profiles`, and the phase-1 policy deliberately lets a staff
-- member see their own profile and nobody else's.
--
-- THIS IS THE ONE NEW SECURITY DEFINER FUNCTION IN PHASE 4, AND THIS IS WHY.
--
-- The alternative was to widen `profiles_select_self_or_owner` so that any staff
-- member may read every profile row. That would hand staff the whole table — role,
-- deactivation state, the account list — to solve a problem that only needs one
-- column. This function is the narrow version of the same permission: it returns a
-- display name and nothing else, for one uuid at a time.
--
-- The hardening the plan requires of a SECURITY DEFINER function is all present:
--
--   * `set search_path = ''` and every object schema-qualified, so nothing on the
--     caller's path can be shadowed;
--   * the caller's identity is verified inside the function, not assumed from the
--     EXECUTE grant: a session that is not enabled staff is refused even if it somehow
--     obtains EXECUTE;
--   * EXECUTE is revoked from PUBLIC and from `anon` by name — Supabase's default
--     grant is explicit, so revoking PUBLIC alone would not remove it — and granted
--     only to `authenticated`;
--   * supabase/tests/005_publish.test.sql asserts both the anonymous refusal and the
--     "returns only the name" property.

create or replace function public.editor_name(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_name text;
begin
  if not public.is_staff() then
    raise exception 'Only staff may resolve an editor name.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_id is null then
    return null;
  end if;

  select p.name into v_name from public.profiles p where p.user_id = p_user_id;
  return v_name;
end;
$fn$;

comment on function public.editor_name(uuid) is
  'The display name behind an updated_by uuid, for staff only. Deliberately narrower than a profiles read policy (§6).';

revoke all on function public.editor_name(uuid) from public, anon;
grant execute on function public.editor_name(uuid) to authenticated;


-- ===========================================================================
-- 5. pending_changes — everything waiting to be published (§4)
-- ===========================================================================
--
-- §4 rules out a `publish_queue` table: "Pending changes are derived from `draft is
-- not null`, `news.status`, and `overrides.status` via a `pending_changes` view."
-- This is that view. It stores nothing, so it cannot disagree with the rows it
-- summarises.
--
-- SECURITY
--
-- `with (security_invoker = on)`. Without it a view runs with its *owner's* privileges
-- — the migration role — and would hand every caller a complete, RLS-free listing of
-- every draft in the system. With it, each branch below is filtered by exactly the
-- policies that already govern its table, so the view can add no reach that the
-- caller did not already have. `anon` is additionally denied SELECT on the view
-- itself, so an anonymous request fails at the door rather than at the first table.
--
-- WHAT IT EXPOSES, AND WHAT IT DOES NOT
--
-- Entity, id, the row's own name, state, when and by whom. **No draft content.** The
-- dashboard needs to say "Ret: Thor — kladde, redigeret af Lokal Medarbejder for ti
-- minutter siden"; it does not need the draft itself to do that, and a view is the
-- wrong place to widen who can read one.
--
-- `subject` is the row's own name, or NULL for a singleton that has no name of its
-- own. The Danish label a person reads is composed in lib/publishing/entities.ts —
-- interface wording does not belong in a database view.

create view public.pending_changes
with (security_invoker = on)
as
  select
    'page:' || p.key                     as entity,
    p.id                                 as entity_id,
    null::text                           as subject,
    'draft'::text                        as state,
    p.updated_at                         as updated_at,
    p.updated_by                         as updated_by,
    public.editor_name(p.updated_by)     as editor_name
  from public.pages p
  where p.draft is not null

  union all
  select 'site_contact', c.id, null::text, 'draft', c.updated_at, c.updated_by,
         public.editor_name(c.updated_by)
  from public.site_contact c
  where c.draft is not null

  union all
  select 'opening_hours', h.id, null::text, 'draft', h.updated_at, h.updated_by,
         public.editor_name(h.updated_by)
  from public.opening_hours h
  where h.draft is not null

  union all
  select 'announcement', a.id, null::text, 'draft', a.updated_at, a.updated_by,
         public.editor_name(a.updated_by)
  from public.announcement a
  where a.draft is not null

  union all
  select 'menu_category', mc.id, mc.name, 'draft', mc.updated_at, mc.updated_by,
         public.editor_name(mc.updated_by)
  from public.menu_categories mc
  where mc.draft is not null

  union all
  -- A soft-deleted dish is on its way out, not waiting to go live, so it is not a
  -- pending change even if it still carries a draft.
  select 'dish', d.id, d.name, 'draft', d.updated_at, d.updated_by,
         public.editor_name(d.updated_by)
  from public.dishes d
  where d.draft is not null and d.deleted_at is null

  union all
  select 'weekly_special', w.id, w.name, 'draft', w.updated_at, w.updated_by,
         public.editor_name(w.updated_by)
  from public.weekly_special w
  where w.draft is not null

  union all
  select 'monthly_burger', m.id, m.name, 'draft', m.updated_at, m.updated_by,
         public.editor_name(m.updated_by)
  from public.monthly_burger m
  where m.draft is not null

  union all
  -- News and overrides have no draft column: they are pending while their `status` is
  -- still 'draft' (§4). `unpublished` rather than `draft` so the dashboard can word
  -- them as "ikke offentliggjort" instead of "kladde".
  select 'news', n.id, n.title, 'unpublished', n.updated_at, n.updated_by,
         public.editor_name(n.updated_by)
  from public.news n
  where n.status = 'draft'

  union all
  select 'opening_hours_override', o.id, to_char(o.date, 'YYYY-MM-DD'), 'unpublished',
         o.updated_at, o.updated_by, public.editor_name(o.updated_by)
  from public.opening_hours_overrides o
  where o.status = 'draft';

comment on view public.pending_changes is
  'Everything waiting to be published, derived from draft/status columns. security_invoker, so RLS decides every row (§4).';

revoke all on public.pending_changes from public, anon;
grant select on public.pending_changes to authenticated;
