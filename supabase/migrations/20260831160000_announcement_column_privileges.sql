-- ===========================================================================
-- Phase 8C-1 hardening — who may write which announcement column (§5, §6, §8)
--
-- The 8C-1 report left one thing open, and 8C-2 must not be built on top of it:
--
--     "Staff currently have a broad, table-level UPDATE capability on
--      public.announcement. Internal lifecycle fields such as `previous` and
--      `replaced_at` can be modified directly through the database/API, outside
--      the trusted replacement and restore functions."
--
-- That was accurate. `20260829120000_initial_schema.sql` granted
-- `update on public.announcement to authenticated` — every column, including the
-- two that `restore_announcement()` now trusts as its server-side snapshot. A
-- Staff member holding their own JWT (it is httpOnly, which defends against XSS,
-- not against the person the session belongs to) could reach PostgREST directly,
-- write any snapshot they liked into `previous`, and then call the trusted
-- `restore_announcement()` to put it live under a `restore` audit entry.
--
-- ONE MIGRATION. NO NEW TABLE, NO NEW COLUMN, NO NEW VIEW, NO NEW INDEX, NO NEW
-- POLICY, AND NO NEW SECURITY DEFINER FUNCTION ANYWHERE.
--
-- What it contains:
--
--   1. a narrowed column-level UPDATE grant, replacing the table-level one;
--   2. one BEFORE UPDATE guard trigger, `security invoker`, that owns the columns
--      privileges cannot own;
--   3. the four lifecycle functions, re-stated so each names the transition it is
--      making. Every other line of all four is byte-identical to phases 7A, 7B and
--      8C-1 — same SECURITY INVOKER, same `set search_path = ''`, same status
--      vocabulary, same optimistic concurrency, same audit rows.
--
--
-- ---------------------------------------------------------------------------
-- WHY COLUMN PRIVILEGES ALONE CANNOT DO THIS — the PostgreSQL constraint
-- ---------------------------------------------------------------------------
--
-- The obvious fix is `revoke update (previous, replaced_at, …)` and let the trusted
-- functions keep writing them. **That does not work, and it cannot be made to
-- work.** A SECURITY INVOKER function executes with the privileges of whoever
-- called it. PostgreSQL has no mechanism by which such a function holds a grant of
-- its own: there is no per-function table privilege, and no way to run a body with
-- the function's rights while keeping the caller's identity — SECURITY DEFINER
-- changes both together or neither. So every column any of the four functions
-- writes must also be a column `authenticated` holds UPDATE on — which is exactly
-- the privilege the attack uses.
--
-- Measured, not assumed. With `update` revoked and re-granted on `(draft)` only,
-- from a real Staff JWT:
--
--     direct write to previous   ->  ERROR 42501 permission denied  (the goal)
--     publish_announcement()     ->  ERROR 42501 permission denied  (the cost)
--     set_announcement_visible() ->  ERROR 42501 permission denied  (the cost)
--
-- Three ways out, and only one of them is allowed here:
--
--   * **Make the functions SECURITY DEFINER.** Refused. It would move the whole
--     lifecycle out from under RLS, discard the second of §5's two independent
--     enforcement points, and replace a narrow grant with four functions that write
--     as their owner. The brief forbids it and so does §8.
--   * **Move the lifecycle columns to a second table.** No help: a SECURITY INVOKER
--     function would need the same privilege on the new table, and the problem
--     arrives unchanged with a join added.
--   * **Keep the privilege and constrain the *transition*.** A BEFORE UPDATE
--     trigger is not a privilege — it is a rule the row must satisfy, in the same
--     family as the table's CHECKs and its RLS policies. It runs for every writer,
--     a caller who does not own the table cannot turn it off, and it lets
--     `authenticated` keep exactly the grant PostgreSQL insists it keeps while
--     refusing every use of that grant except the ones the lifecycle makes.
--
-- This migration takes the third, and narrows the grant as far as privileges *can*
-- go underneath it.
--
--
-- ---------------------------------------------------------------------------
-- THE MODEL, ONE PARAGRAPH PER LAYER
-- ---------------------------------------------------------------------------
--
--   `draft`
--       The caller's column. Written directly, by `saveEntityDraft()` and by
--       nothing else in the system. It is the *only* column a PostgREST UPDATE may
--       move, and it is safe to be: a draft is not published content, nothing
--       public reads it, and it reaches the site only through
--       `publish_announcement()`, which re-validates it.
--
--   `message`, `link_type`, `link_page`, `link_url`, `link_label`, `expires_at`
--       The published announcement. Written by `publish_announcement()` (the merge),
--       `replace_announcement()` (1ae's "Erstat med den nye besked") and
--       `restore_announcement()` (the Fortryd). Never directly.
--
--   `is_visible`
--       The immediate path. The three above, plus `set_announcement_visible()`,
--       which is the only one that may move it on its own. Never directly.
--
--   `source`
--       Provenance — 'manual', or 8C-2's 'opening_hours'. `replace_announcement()`
--       takes it from a closed vocabulary; `restore_announcement()` puts back what
--       was stored. Never directly, and never by a draft: the draft schema has no
--       such field, so a forged draft key cannot introduce one.
--
--   `previous`, `replaced_at`
--       Internal lifecycle state, and the reason this migration exists.
--       `replace_announcement()` writes them; `restore_announcement()` reads and
--       clears them. **Never directly, by anybody, ever.**
--
--   `id`, `is_singleton`, `created_at`, `updated_at`, `updated_by`
--       Identity and attribution. Not writable by `authenticated` at all any more —
--       these are removed from the grant, which is the honest place for them, since
--       no function and no application path writes them either. `updated_at` and
--       `updated_by` continue to be stamped by the table's own `announcement_touch`
--       trigger; a BEFORE trigger's assignment to NEW is not privilege-checked, so
--       removing the grant costs the stamp nothing and costs a forger the
--       concurrency token.
--
--
-- ---------------------------------------------------------------------------
-- WHY THE MARKER IS NOT A BACK DOOR
-- ---------------------------------------------------------------------------
--
-- The trigger tells a lifecycle write from a direct one by a transaction-local GUC
-- that each of the four functions sets immediately before its own UPDATE. The
-- question that matters is whether a caller could set it themselves. They cannot,
-- and it is four separate facts rather than one:
--
--   * `set_config()` lives in `pg_catalog`. PostgREST exposes `public` and
--     `graphql_public` (`supabase/config.toml`), so there is no `/rpc/set_config`
--     and no other door to it. No function in either exposed schema takes a setting
--     name — `set_config` and `current_setting` appear in no other migration.
--   * A PostgREST request is one transaction containing one operation. There is no
--     request that calls an RPC *and* issues a table UPDATE, so even a marker that
--     leaked could not be spent on a second statement.
--   * The trigger **consumes** the marker on the way past, and each function clears
--     it again after its UPDATE. It authorises one row-write: the one it was set
--     for.
--   * `authenticated` is a member of no other role and holds no CREATE on `public`,
--     so it can neither `set role service_role` nor define a function of its own.
--     `session_replication_role`, the other way to silence a trigger, is
--     superuser-only.
--
-- And the marker is not the only thing standing there. It says *which* transition
-- is being made; RLS still decides whether this caller may write the row at all,
-- `mayChangeEntity()` still decided it once in the Server Action, and every
-- function still validates its own payload. This is one more layer, not a
-- replacement for any of them.
--
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
--
--   * **It does not change any function's behaviour.** Every status, every refusal,
--     every audit row and every reply key is what 7A, 7B and 8C-1 shipped. The only
--     new outcome anywhere is `42501` on a path no application code takes.
--   * **It does not touch `public.weekly_special`, `public.monthly_burger`,
--     `public.opening_hours`, `public.site_contact` or `public.pages`**, which carry
--     the same table-level `update` grant. None of them has a column a trusted
--     function is the sole author of and a second trusted function then believes, so
--     none of them has this problem yet. Widening the pass to them is a decision of
--     its own, not a side effect of this one.
--   * **It adds no SECURITY DEFINER function.** The count of them in this repository
--     is unchanged, and the pgTAP suite asserts it.
--   * **It changes no screen, no Server Action and no TypeScript.** The application
--     already writes `draft` and calls RPCs for everything else; that is why nothing
--     above the database has to move.
-- ===========================================================================


-- ===========================================================================
-- 1. The grant, stated column by column
-- ===========================================================================
--
-- Replaces `grant select, update on public.announcement to authenticated` from §18
-- of the initial migration. SELECT is untouched — the editor reads every column,
-- `previous` included — and `anon`'s six-column read grant is not named here at all.
--
-- The eleven columns below are not a wish list: they are exactly the columns some
-- statement in this repository writes as `authenticated`. Ten of them are here only
-- because PostgreSQL requires the *caller* of a SECURITY INVOKER function to hold
-- the privilege; the guard trigger in §2 is what actually decides when they may
-- move. `draft` is the one that is genuinely the caller's.

revoke update on public.announcement from authenticated;

grant update (
  -- the caller's own column: `saveEntityDraft()` writes this and nothing else
  draft,
  -- the published announcement: publish / replace / restore
  message, link_type, link_page, link_url, link_label, expires_at,
  -- the immediate path: publish / visibility / replace / restore
  is_visible,
  -- provenance: replace / restore
  source,
  -- internal lifecycle: replace writes, restore clears
  previous, replaced_at
) on public.announcement to authenticated;

-- Not granted, and named here so the omission reads as a decision: `id`,
-- `is_singleton`, `created_at` (identity — there is one row and it is not being
-- recreated) and `updated_at`, `updated_by` (the concurrency token and the actor,
-- both stamped by `announcement_touch` from `now()` and the JWT).


-- ===========================================================================
-- 2. The guard — the rule privileges cannot express
-- ===========================================================================
--
-- BEFORE UPDATE, one row at a time, for every writer. It answers one question —
-- *was this write made by a lifecycle function, and if so which one?* — and then
-- refuses any column movement that transition does not own.
--
-- SECURITY INVOKER, like everything else here. It reads no table, calls no helper
-- and holds no privilege of its own; it compares OLD to NEW and raises. There is
-- nothing in it for a SECURITY DEFINER to be needed for.
--
-- The refusals are `42501` — the same code a missing grant produces — because that
-- is what they are from the caller's side: permission denied on a column, decided
-- by a rule instead of by a grant. PostgREST turns it into a 403.

create or replace function public.tg_guard_announcement_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op        text;
  v_content   boolean;
  v_visible   boolean;
  v_source    boolean;
  v_lifecycle boolean;
begin
  -- The guard exists for the two roles a PostgREST request runs as. A migration,
  -- `supabase/seed.sql`, `scripts/seed-local-users.mjs` and the pgTAP fixtures are
  -- not browser sessions: they arrive as `postgres` or `service_role`, they are
  -- already trusted with the whole table, and a guard that stopped them would stop
  -- `supabase db reset`. `authenticated` is a member of no other role, so this is
  -- not an exemption a session can put on.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  v_op := pg_catalog.current_setting('app.announcement_write', true);

  -- Single use: the marker authorises this row-write and no later one.
  if v_op is not null and v_op <> '' then
    perform pg_catalog.set_config('app.announcement_write', '', true);
  end if;

  -- `coalesce` rather than a bare `in`: an unset marker is SQL NULL, and a NULL
  -- here would make every `not v_…` below NULL, which `if` treats as false — the
  -- guard would wave through exactly the write it exists to stop.
  v_op        := coalesce(v_op, '');
  v_content   := v_op in ('publish', 'replace', 'restore');
  v_visible   := v_op in ('publish', 'visibility', 'replace', 'restore');
  v_source    := v_op in ('replace', 'restore');
  v_lifecycle := v_op in ('replace', 'restore');

  -- A marker this migration does not name is not a marker: every flag above is
  -- false for it, so an unrecognised value is judged exactly as a direct write is.

  if not v_content and (
       new.message    is distinct from old.message
    or new.link_type  is distinct from old.link_type
    or new.link_page  is distinct from old.link_page
    or new.link_url   is distinct from old.link_url
    or new.link_label is distinct from old.link_label
    or new.expires_at is distinct from old.expires_at)
  then
    raise exception
      'announcement: the published message, its link and its expiry are written only by publish_announcement(), replace_announcement() or restore_announcement()'
      using errcode = '42501';
  end if;

  if not v_visible and new.is_visible is distinct from old.is_visible then
    raise exception
      'announcement: is_visible is written only by set_announcement_visible(), publish_announcement(), replace_announcement() or restore_announcement()'
      using errcode = '42501';
  end if;

  if not v_source and new.source is distinct from old.source then
    raise exception
      'announcement: source is written only by replace_announcement() or restore_announcement()'
      using errcode = '42501';
  end if;

  -- The one this migration exists for. `restore_announcement()` trusts `previous`
  -- as its server-side record of what to put back, so a `previous` a caller could
  -- choose is a message a caller could publish without any of the checks
  -- `replace_announcement()` and `publish_announcement()` make.
  if not v_lifecycle and (
       new.previous    is distinct from old.previous
    or new.replaced_at is distinct from old.replaced_at)
  then
    raise exception
      'announcement: previous and replaced_at are written only by replace_announcement() or restore_announcement()'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_guard_announcement_write() is
  'BEFORE UPDATE on public.announcement: refuses any movement of the published, visibility, source and lifecycle columns that did not come from the lifecycle function owning it. A direct PostgREST write owns draft and nothing else (technical plan section 5, section 8).';

-- Fires before `announcement_touch` (triggers run in name order), which is
-- immaterial: the guard compares only columns the touch trigger does not stamp.
drop trigger if exists announcement_guard_write on public.announcement;

create trigger announcement_guard_write
  before update on public.announcement
  for each row execute function public.tg_guard_announcement_write();

revoke all on function public.tg_guard_announcement_write() from public, anon, authenticated;


-- ===========================================================================
-- 3. The four lifecycle functions, each naming its own transition
-- ===========================================================================
--
-- The added lines are the same three in each, and they are the whole change:
--
--     perform pg_catalog.set_config('app.announcement_write', '<op>', true);
--     …the existing UPDATE, unchanged…
--     v_written := found;
--     perform pg_catalog.set_config('app.announcement_write', '', true);
--
-- `v_written` is not decoration. `perform` sets `FOUND`, so clearing the marker
-- immediately after the UPDATE would overwrite the very flag the next line reads to
-- tell a conflict from a refusal. The row count is captured first, and every
-- `if not found` below became `if not v_written` for that reason and no other.
-- ===========================================================================


-- --- publish_announcement (phase 7A) ---------------------------------------
--
-- Unchanged in every other respect: the two rules that cannot be CHECKs are still
-- checked at the moment of the merge, the merge still reads `draft ? 'key'` so an
-- untouched field is not blanked, Offentliggør still makes the bar visible, and the
-- before/after pair is still `announcement_content()`.

create or replace function public.publish_announcement(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row     public.announcement%rowtype;
  v_draft   jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_message text;
  v_expires timestamptz;
  v_written boolean;
begin
  select * into v_row from public.announcement t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.announcement_content(v_row);

  v_message := case when v_draft ? 'message'    then v_draft ->> 'message'                  else v_row.message    end;
  v_expires := case when v_draft ? 'expires_at' then (v_draft ->> 'expires_at')::timestamptz else v_row.expires_at end;

  if v_message is null or btrim(v_message) = '' then
    return jsonb_build_object('status', 'invalid_draft', 'reason', 'message');
  end if;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('status', 'invalid_draft', 'reason', 'expires_at');
  end if;

  -- A publish moves the published content, clears the draft and makes the bar
  -- visible. It may not move `source`, `previous` or `replaced_at`, and does not
  -- name them.
  perform pg_catalog.set_config('app.announcement_write', 'publish', true);

  update public.announcement t set
    message    = case when v_draft ? 'message'    then v_draft ->> 'message'                 else t.message    end,
    link_type  = case when v_draft ? 'link_type'  then coalesce(v_draft ->> 'link_type', 'none') else t.link_type  end,
    link_page  = case when v_draft ? 'link_page'  then v_draft ->> 'link_page'                else t.link_page  end,
    link_url   = case when v_draft ? 'link_url'   then v_draft ->> 'link_url'                 else t.link_url   end,
    link_label = case when v_draft ? 'link_label' then v_draft ->> 'link_label'               else t.link_label end,
    expires_at = case when v_draft ? 'expires_at' then (v_draft ->> 'expires_at')::timestamptz else t.expires_at end,
    is_visible = true,
    draft      = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  v_written := found;
  perform pg_catalog.set_config('app.announcement_write', '', true);

  if not v_written then
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
  'Publishes an edited announcement and makes it visible (1ad: Ret -> Forhaandsvis -> Offentliggoer). Refuses a merge with a blank message or a missing/past expiry (1ac: "Udloeb er paakraevet"). Switching a bar off is the immediate path and never a draft (technical plan section 6). Declares its transition to the announcement write guard.';


-- --- set_announcement_visible (phase 7B) -----------------------------------
--
-- Still one column, named once. The marker it declares says so: `visibility` is the
-- only transition the guard lets move `is_visible` alone, and it lets it move
-- nothing else.

create or replace function public.set_announcement_visible(
  p_visible             boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row     public.announcement%rowtype;
  v_id      uuid;
  v_before  jsonb;
  v_after   jsonb;
  v_written boolean;
begin
  if p_visible is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_row from public.announcement t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  v_id := v_row.id;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  if p_visible then
    if v_row.message is null or btrim(v_row.message) = '' then
      return jsonb_build_object('status', 'not_showable', 'reason', 'message');
    end if;

    if v_row.expires_at is null or v_row.expires_at <= now() then
      return jsonb_build_object('status', 'not_showable', 'reason', 'expires_at');
    end if;
  end if;

  if v_row.is_visible is not distinct from p_visible then
    return jsonb_build_object(
      'status', 'unchanged', 'entity_id', v_id, 'updated_at', v_row.updated_at,
      'before', public.announcement_visibility(v_row),
      'after',  public.announcement_visibility(v_row));
  end if;

  v_before := public.announcement_visibility(v_row);

  perform pg_catalog.set_config('app.announcement_write', 'visibility', true);

  update public.announcement t
     set is_visible = p_visible
   where t.id = v_id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  v_written := found;
  perform pg_catalog.set_config('app.announcement_write', '', true);

  if not v_written then
    if exists (select 1 from public.announcement t
                where t.id = v_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.announcement_visibility(v_row);
  perform public.log_audit('visibility', 'announcement', v_id, v_before, v_after);

  return jsonb_build_object(
    'status', 'updated', 'entity_id', v_id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.set_announcement_visible(boolean, timestamptz) is
  'Immediate "Vis besked" off / "Fjern beskeden nu", and the second write that Fortryd makes (1ad, technical plan section 6). Writes is_visible and its audit row, one transaction, no draft. Refuses to switch a bar on that a guest could not be given. Never touches previous or replaced_at, and the write guard enforces that rather than trusting it.';


-- --- replace_announcement (phase 8C-1) -------------------------------------
--
-- The only statement in the system that may write `previous` and `replaced_at`, and
-- now the only one that can. Every validation, every status and the snapshot pair
-- are 8C-1's, unchanged.

create or replace function public.replace_announcement(
  p_message             text,
  p_link_type           text,
  p_link_page           text,
  p_link_url            text,
  p_link_label          text,
  p_expires_at          timestamptz,
  p_source              text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row      public.announcement%rowtype;
  v_id       uuid;
  v_previous jsonb;
  v_after    jsonb;
  v_replaced text;
  v_written  boolean;
begin
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'message');
  end if;

  if length(p_message) > 90 then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'message_length');
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'expires_at');
  end if;

  if p_source is null or p_source not in ('manual', 'opening_hours') then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'source');
  end if;

  if p_link_type is null or p_link_type not in ('none', 'page', 'url') then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link');
  end if;

  if not (
       (p_link_type = 'none' and p_link_page is null and p_link_url is null)
    or (p_link_type = 'page' and p_link_page is not null and p_link_url is null)
    or (p_link_type = 'url'  and p_link_url  is not null and p_link_page is null))
  then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link');
  end if;

  if p_link_page is not null
     and p_link_page not in ('/', '/menu', '/mad-ud-af-huset', '/om-os', '/nyheder', '/find-os')
  then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link');
  end if;

  if p_link_url is not null and p_link_url !~ '^https://[^\s]+$' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link');
  end if;

  if p_link_type = 'url' and (p_link_label is null or btrim(p_link_label) = '') then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link_label');
  end if;

  select * into v_row from public.announcement t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  v_id := v_row.id;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_replaced := case
    when v_row.message is null or btrim(v_row.message) = ''            then 'none'
    when v_row.expires_at is null or v_row.expires_at <= now()         then 'expired'
    when not v_row.is_visible                                          then 'hidden'
    else 'active'
  end;

  -- Built from the row the server just read. This is the only place a `previous`
  -- value is ever composed, and — since this migration — the only place one can be
  -- written at all.
  v_previous := public.announcement_snapshot(v_row);

  if not public.is_valid_announcement_snapshot(v_previous) then
    return jsonb_build_object('status', 'invalid_snapshot');
  end if;

  perform pg_catalog.set_config('app.announcement_write', 'replace', true);

  update public.announcement t set
    message     = p_message,
    link_type   = p_link_type,
    link_page   = p_link_page,
    link_url    = p_link_url,
    link_label  = p_link_label,
    expires_at  = p_expires_at,
    source      = p_source,
    is_visible  = true,
    previous    = v_previous,
    replaced_at = now()
   where t.id = v_id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  v_written := found;
  perform pg_catalog.set_config('app.announcement_write', '', true);

  if not v_written then
    if exists (select 1 from public.announcement t
                where t.id = v_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.announcement_snapshot(v_row);
  perform public.log_audit('replace', 'announcement', v_id, v_previous, v_after);

  return jsonb_build_object(
    'status',      'replaced',
    'entity_id',   v_id,
    'updated_at',  v_row.updated_at,
    'replaced',    v_replaced,
    'replaced_at', v_row.replaced_at,
    'before',      v_previous,
    'after',       v_after);
end;
$fn$;

comment on function public.replace_announcement(text, text, text, text, text, timestamptz, text, timestamptz) is
  'Replaces the published announcement with another already-validated one, stashes the current published state in previous, stamps replaced_at, makes the replacement visible and audits it - one transaction (design 1ae, technical plan section 6). Takes typed scalars, never a json document; never touches draft; keeps exactly one level of previous. The only statement in the system that may write previous, and the write guard is what makes that true.';


-- --- restore_announcement (phase 8C-1) -------------------------------------
--
-- The function that made this migration necessary: it trusts `previous` as the
-- server-side record of what to put back. That trust is now earned rather than
-- assumed — `previous` can only have been written by `replace_announcement()`
-- above, from the row's own columns.
--
-- The snapshot validator stays exactly where it was. It is no longer the only thing
-- standing between a forged snapshot and a publish, but a `previous` written before
-- this migration, or by a later migration, or by a service-role script, is still
-- refused rather than trusted.

create or replace function public.restore_announcement(p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row      public.announcement%rowtype;
  v_id       uuid;
  v_snapshot jsonb;
  v_before   jsonb;
  v_after    jsonb;
  v_written  boolean;
begin
  select * into v_row from public.announcement t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  v_id := v_row.id;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_snapshot := v_row.previous;

  if v_snapshot is null then
    return jsonb_build_object('status', 'nothing_to_restore');
  end if;

  if not public.is_valid_announcement_snapshot(v_snapshot) then
    return jsonb_build_object('status', 'invalid_snapshot');
  end if;

  v_before := public.announcement_snapshot(v_row);

  perform pg_catalog.set_config('app.announcement_write', 'restore', true);

  update public.announcement t set
    message     = v_snapshot ->> 'message',
    link_type   = v_snapshot ->> 'link_type',
    link_page   = v_snapshot ->> 'link_page',
    link_url    = v_snapshot ->> 'link_url',
    link_label  = v_snapshot ->> 'link_label',
    expires_at  = (v_snapshot ->> 'expires_at')::timestamptz,
    is_visible  = (v_snapshot ->> 'is_visible')::boolean,
    source      = v_snapshot ->> 'source',
    previous    = null,
    replaced_at = null
   where t.id = v_id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  v_written := found;
  perform pg_catalog.set_config('app.announcement_write', '', true);

  if not v_written then
    if exists (select 1 from public.announcement t
                where t.id = v_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.announcement_snapshot(v_row);
  perform public.log_audit('restore', 'announcement', v_id, v_before, v_after);

  return jsonb_build_object(
    'status',     'restored',
    'entity_id',  v_id,
    'updated_at', v_row.updated_at,
    'showable',   (v_row.is_visible
                   and v_row.message is not null
                   and v_row.expires_at is not null
                   and v_row.expires_at > now()),
    'before',     v_before,
    'after',      v_after);
end;
$fn$;

comment on function public.restore_announcement(timestamptz) is
  'Puts back the announcement stashed in previous, clears previous and replaced_at, and audits it - one transaction (design 1ae, technical plan section 6). Reads the snapshot from the database; the browser sends no content, and since the announcement write guard no caller can put one there either. Never extends an expiry to make itself succeed, and never touches draft.';


-- The EXECUTE grants phases 4, 7A, 7B and 8C-1 made are unchanged and still apply:
-- `revoke all … from public, anon` followed by `grant execute … to authenticated`.
-- `create or replace` preserves them, and re-stating them here would only invite the
-- two to drift.
