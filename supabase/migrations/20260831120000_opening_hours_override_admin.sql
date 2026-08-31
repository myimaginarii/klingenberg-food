-- Klingenberg Food — phase 8B: one-off opening-hours overrides (§4, §5, §6, §7b, §7e).
--
-- 1t's lower half — "ENKELT ÆNDRING": *Lukket en bestemt dato* and *Andre tider en enkelt
-- dag* — is an editor over machinery that has existed since phases 1 and 4. The table, its
-- shape CHECK, its four RLS policies, `publish_opening_hours_override()`, the
-- `pending_changes` view, the public `date >= today` filter and the phase-2 engine that
-- honours a published override in both directions were all already there.
--
-- This migration adds the **one** thing that was not, and nothing else.
--
-- ===========================================================================
-- WHY A `draft` COLUMN, WHEN §4 SAYS AN OVERRIDE IS PENDING THROUGH ITS `status`
-- ===========================================================================
--
-- §4's table describes an override as "per-row publish", like `news`: `status` moves from
-- 'draft' to 'published' and there is no draft column. That model expresses three of the
-- four states this phase needs, and cannot express the fourth:
--
--   1. **no row** — the date follows the normal weekly schedule;
--   2. **status = 'draft'** — a one-off change waiting to be published. Invisible to a
--      guest (`overrides_select_public` requires `status = 'published'`), so its own
--      columns are safe to edit in place — there is nothing live to protect;
--   3. **status = 'published'** — live, and honoured by the phase-2 engine;
--   4. **published, with a pending edit** — the restaurant has told the hjemmeside it is
--      *closed* on Sunday, and somebody is preparing *13:00–18:00* instead. §6's promise
--      is that the guest goes on reading the published answer until Offentliggør.
--
-- State 4 has nowhere to live. `date` is UNIQUE, so the pending edit cannot be a second
-- row; `status` is one value, so moving it back to 'draft' would take the published
-- override off the hjemmeside *without* anybody publishing anything — a live change made
-- by pressing Gem, which is the one thing §6 exists to prevent; and overwriting the three
-- content columns publishes the edit immediately, which is the same failure by the other
-- route.
--
-- So the column is added, and it is **§4's own draft mechanism** rather than a new idea:
-- one nullable `draft jsonb` holding only the changed fields, merged into the columns by
-- the publish function and set to null in the same statement. That is what `pages`,
-- `site_contact`, `opening_hours`, `announcement`, `menu_categories`, `dishes`,
-- `weekly_special` and `monthly_burger` all do. No second publishing path, no new status
-- vocabulary, no history table, and nothing an existing reader has to learn.
--
-- **`anon` cannot read it.** The public grant on this table is column-level
-- (`grant select (id, date, kind, opens_at, closes_at, status, updated_at)`), so a column
-- added here is granted to nobody by that statement and is unreadable by a guest — the
-- same property `opening_hours.draft` has, and asserted from a real anonymous JWT in
-- `supabase/tests/014_opening_hours_overrides.test.sql`.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES NOT ADD
-- ===========================================================================
--
--   * **No announcement of any kind.** `public.announcement` is named by no statement
--     below. `source = 'opening_hours'`, `previous`, `replaced_at`, "Vis også som besked
--     øverst på hjemmesiden" and 1ae's conflict sheet are **phase 8C**, and
--     `announcement_created` — the column §4 reserves for exactly that — is written by
--     nothing here and stays `false`.
--   * **No policy change.** The four policies from phase 1 are untouched: staff may
--     select, insert, update and delete, and `anon` may select published rows dated today
--     or later. Widening none of them is what makes the Staff/Owner split in §5 a property
--     of the database rather than of the application's good manners.
--   * **No SECURITY DEFINER write path.** Both functions below are SECURITY INVOKER, so
--     RLS decides for every caller against their own JWT.
--   * **Nothing that touches `public.opening_hours`.** The recurring weekly schedule stays
--     Owner-only, with `opening_hours_update_owner` as its only UPDATE policy.

-- ===========================================================================
-- 1. The draft column
-- ===========================================================================

alter table public.opening_hours_overrides
  add column draft jsonb;

alter table public.opening_hours_overrides
  add constraint overrides_draft_shape check (draft is null or jsonb_typeof(draft) = 'object');

comment on column public.opening_hours_overrides.draft is
  'Pending changes to kind/opens_at/closes_at, merged by publish_opening_hours_override(). Never readable by anon (§4, §6).';

comment on table public.opening_hours_overrides is
  'One-off opening-hour changes. Staff-writable (§5); pending while status = draft or draft is not null; honoured in both directions by the sold-out reset (§7b).';


-- ===========================================================================
-- 2. Publishing one override — now a merge as well as a status change
-- ===========================================================================
--
-- The shape of the function is unchanged from phase 4: the same four refusals in the same
-- order, the same repeated version check inside the UPDATE, the same forbidden-versus-
-- conflict probe, the same `log_audit('publish', 'opening_hours_override', …)` with the
-- before/after pair and the actor taken from the JWT.
--
-- Two things move:
--
--   * **"pending" is now `status = 'draft' OR draft is not null`.** A published override
--     carrying an edit is as pending as one that has never been live, and `nothing_to_
--     publish` is reserved for a row that is neither.
--   * **The three content columns are merged from the draft** with `draft ? 'column'`,
--     which is the same presence test — not a `!= null` test — that every other publish
--     function in this schema uses. A field the draft does not mention keeps its live
--     value; a field present with a JSON `null` clears it, which is how *Andre tider* →
--     *Lukket* removes the two times. `lib/drafts/overlay.ts` states the identical rule
--     for the preview, and the unit suite holds the two to the same fixtures.
--
-- The merged row still has to satisfy `overrides_shape_check` — closed with no times, or
-- custom with both and `opens_at < closes_at`. A draft that would break it is refused by
-- the CHECK with nothing written, which is what makes the application's own validation a
-- courtesy rather than the guarantee.

create or replace function public.publish_opening_hours_override(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.opening_hours_overrides%rowtype;
  v_draft  jsonb;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.opening_hours_overrides t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if v_row.status = 'published' and v_row.draft is null then
    return jsonb_build_object('status', 'nothing_to_publish');
  end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_before := public.opening_hours_override_content(v_row);
  v_draft  := coalesce(v_row.draft, '{}'::jsonb);

  update public.opening_hours_overrides t
     set kind      = case when v_draft ? 'kind'      then v_draft ->> 'kind' else t.kind end,
         opens_at  = case when v_draft ? 'opens_at'  then (v_draft ->> 'opens_at')::time else t.opens_at end,
         closes_at = case when v_draft ? 'closes_at' then (v_draft ->> 'closes_at')::time else t.closes_at end,
         status    = 'published',
         draft     = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and (t.status = 'draft' or t.draft is not null)
  returning * into v_row;

  if not found then
    if exists (select 1 from public.opening_hours_overrides t
                where t.id = p_id
                  and t.updated_at = p_expected_updated_at
                  and (t.status = 'draft' or t.draft is not null))
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
  'Publishes one one-off opening-hours change: merges draft into the columns, sets status, clears draft, audits — one transaction (§4, §6, §7e).';


-- ===========================================================================
-- 3. Removing one override — the date goes back to the normal weekly schedule
-- ===========================================================================
--
-- §7e item 6 states a rule about an *override that is deleted*, and phase 1 gave staff a
-- DELETE policy on this table — the only content table besides `images` that has one. So
-- deletion is the lifecycle the model already intends, and this function is that deletion
-- written out rather than a new idea: the row goes, and the date resolves through the
-- weekly schedule again, which is exactly what "return this date to normal" means when the
-- absence of a row *is* the normal state (§7).
--
-- It is a DELETE rather than a soft delete, and that is a deliberate difference from a
-- dish. A soft-deleted dish is kept because the row *is* the recovery story (§8, §0a D2):
-- it carries a name, a description, a price, labels, a photo and a position that nobody
-- could retype. An override carries a date and at most two times, and re-creating one is
-- the same three presses that created it. There is nothing here to preserve.
--
-- One function, two consequences, told apart by `was_published` in the result:
--
--   * removing a **pending** override changes nothing a guest can see, so the Server
--     Action expires no cache tag;
--   * removing a **published** one is a change to the hjemmeside, so the `hours` tag is
--     expired — after the transaction commits, and only for this answer.
--
-- SECURITY INVOKER, the version token re-checked inside the DELETE, the same
-- forbidden-versus-conflict probe as `set_dish_deleted`, and one audit row carrying what
-- was removed. It takes an id and a version and nothing else: no table name, no column
-- name, no date and no status, so there is no argument that could point it at a row
-- somebody else's screen was describing.

create or replace function public.remove_opening_hours_override(
  p_id                  uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.opening_hours_overrides%rowtype;
  v_before jsonb;
begin
  select * into v_row from public.opening_hours_overrides t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_before := public.opening_hours_override_content(v_row);

  delete from public.opening_hours_overrides t
   where t.id = p_id
     and t.updated_at = p_expected_updated_at;

  if not found then
    -- The pre-check passed, so either RLS refused the delete or another session moved the
    -- row first. The probe tells them apart, so the person is told which happened.
    if exists (select 1 from public.opening_hours_overrides t
                where t.id = p_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  perform public.log_audit('delete', 'opening_hours_override', p_id, v_before, null);

  return jsonb_build_object(
    'status', 'removed',
    'entity_id', p_id,
    'was_published', v_before ->> 'status' = 'published',
    'before', v_before);
end;
$fn$;

comment on function public.remove_opening_hours_override(uuid, timestamptz) is
  'Removes one one-off opening-hours change so the date follows the weekly schedule again. One transaction, audited, SECURITY INVOKER (§7e item 6).';

revoke all on function public.remove_opening_hours_override(uuid, timestamptz) from public, anon;
grant execute on function public.remove_opening_hours_override(uuid, timestamptz) to authenticated;


-- ===========================================================================
-- 4. pending_changes — an override is pending in two ways now
-- ===========================================================================
--
-- The view is replaced whole because that is the only way Postgres lets one branch of it
-- change. Every other branch below is byte-identical to the phase-4 definition; the
-- override branch gains `or o.draft is not null` and words the two states apart:
--
--   * a row that has **never been live** is `unpublished`, which the dashboard says as
--     "ikke offentliggjort" — the same word `news` uses for the same situation;
--   * a **published** override carrying an edit is a `draft`, which the dashboard says as
--     "kladde" — because that is what it is, and because the hjemmeside is meanwhile
--     showing the published answer exactly as it does for every other entity with a draft.
--
-- `security_invoker` is restated, because a view that lost it would hand every caller an
-- RLS-free listing of every draft in the system.

create or replace view public.pending_changes
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
  -- News has no draft column: an article is pending while its `status` is still 'draft'
  -- (§4). `unpublished` rather than `draft` so the dashboard can word it as "ikke
  -- offentliggjort" instead of "kladde".
  select 'news', n.id, n.title, 'unpublished', n.updated_at, n.updated_by,
         public.editor_name(n.updated_by)
  from public.news n
  where n.status = 'draft'

  union all
  select 'opening_hours_override', o.id, to_char(o.date, 'YYYY-MM-DD'),
         case when o.status = 'draft' then 'unpublished' else 'draft' end::text,
         o.updated_at, o.updated_by, public.editor_name(o.updated_by)
  from public.opening_hours_overrides o
  where o.status = 'draft' or o.draft is not null;

comment on view public.pending_changes is
  'Everything waiting to be published, derived from draft/status columns. security_invoker, so RLS decides every row (§4).';
