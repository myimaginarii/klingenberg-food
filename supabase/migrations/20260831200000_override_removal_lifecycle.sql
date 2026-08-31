-- ===========================================================================
-- Phase 8C-3B — removing an override that owns a generated announcement,
-- and closing the direct-DELETE hole (§5, §6, §7e item 6, §8)
--
-- Two things, and they are the same thing seen from two sides.
--
-- 8C-3A left `remove_opening_hours_override()` refusing with `owns_announcement`
-- whenever an override owned the current announcement **or** the one stashed for a
-- Fortryd, and recorded that deciding what to do instead was 8C-3B's. §7e item 6 is
-- that decision: *"Ask, and default to removing the announcement too."* This migration
-- builds the transition that answers it.
--
-- It also closes the hole 8C-3A named in the same breath. `restore_announcement()`'s
-- `owner_missing` status carries this sentence:
--
--     "remove_opening_hours_override() refuses exactly that deletion, so this is
--      reachable only through a direct PostgREST DELETE."
--
-- That was accurate, and it is the hole. §18 of the initial migration granted
-- `delete on public.opening_hours_overrides to authenticated`, and
-- `overrides_delete_staff` permits it. A staff member holding their own JWT could
-- therefore reach PostgREST directly and delete an override — bypassing the version
-- check, the ownership check, the audit row and the `previous`-snapshot integrity that
-- the trusted function exists to enforce. The foreign key would still refuse a delete
-- of the **current** owner; nothing at all protected an override named only inside
-- `previous`, because a foreign key does not reach into jsonb.
--
--
-- ONE MIGRATION. NO NEW TABLE, NO NEW COLUMN, NO NEW VIEW, NO NEW INDEX, NO NEW
-- POLICY, AND NO NEW SECURITY DEFINER FUNCTION ANYWHERE.
--
--   1. one BEFORE DELETE guard trigger on `public.opening_hours_overrides`;
--   2. the announcement write guard, taught two more transitions by name;
--   3. `remove_opening_hours_override()`, which now asks, removes, and cleans up.
--
--
-- ---------------------------------------------------------------------------
-- WHY THE DELETE PRIVILEGE CANNOT SIMPLY BE REVOKED
-- ---------------------------------------------------------------------------
--
-- The obvious fix is `revoke delete on public.opening_hours_overrides from
-- authenticated` and let the trusted function keep deleting. **That does not work, for
-- exactly the reason `20260831160000` records for the announcement's columns.** A
-- SECURITY INVOKER function executes with the privileges of whoever called it.
-- PostgreSQL has no per-function table privilege and no way to run a body with the
-- function's rights while keeping the caller's identity — SECURITY DEFINER changes both
-- together or neither. So the DELETE the trusted function issues is the *caller's*
-- DELETE, and revoking it takes the trusted path away with the untrusted one.
--
-- Measured, not assumed. With `delete` revoked, from a real Staff JWT:
--
--     direct DELETE /opening_hours_overrides   ->  ERROR 42501 permission denied (goal)
--     remove_opening_hours_override()          ->  ERROR 42501 permission denied (cost)
--
-- The three ways out are the same three, and so is the answer:
--
--   * **SECURITY DEFINER.** Refused, by the brief and by §8. It would move the deletion
--     out from under RLS and discard the second of §5's two enforcement points.
--   * **Move the rows somewhere a caller cannot reach.** No help: an invoker-rights
--     function needs the same privilege wherever they live.
--   * **Keep the privilege and constrain the *transition*.** A BEFORE DELETE trigger is
--     not a privilege — it is a rule the operation must satisfy, in the same family as
--     the table's CHECKs and its RLS policies. It runs for every deleter, a caller who
--     does not own the table cannot turn it off, and it lets `authenticated` keep
--     exactly the grant PostgreSQL insists it keeps while refusing every use of that
--     grant except the one the lifecycle makes.
--
-- This migration takes the third, which is the same mechanism, the same GUC convention
-- and the same `42501` the announcement's own guard already uses. One pattern in this
-- repository for "a privilege that may only be spent by a named transition", not two.
--
--
-- ---------------------------------------------------------------------------
-- WHAT "REMOVE THE GENERATED ANNOUNCEMENT" MEANS — §7e item 6, and no more
-- ---------------------------------------------------------------------------
--
-- The announcement row is a singleton and is never deleted. Taking its generated
-- message away is therefore a **transition to the empty state**, which this model
-- already has a name for: `announcement_replacement_kind()` calls it `'none'`, and
-- phase 8C-1 established that the empty state is a valid snapshot rather than an
-- absence. The transition writes, in one statement:
--
--     message = null, link_type = 'none', link_page/link_url/link_label = null,
--     expires_at = null, is_visible = false,
--     source = 'manual', source_override_id = null,
--     previous = null, replaced_at = null
--
-- Each half of that is a requirement rather than a tidy-up:
--
--   * **the message goes**, so the generated live content cannot be toggled back on
--     later as a message about hours that no longer exist. Clearing `is_visible` alone
--     would leave exactly that — a hidden, valid, re-showable opening-hours message
--     whose override is gone.
--   * **the ownership goes**, and `source` goes with it, because
--     `announcement_source_owner_check` makes the two one fact: a generated
--     announcement without an owner is not storable, and neither is a manual one with.
--   * **`previous` and `replaced_at` go**, because whatever they held is now
--     unreachable: this statement moves `updated_at`, so any Fortryd already on offer is
--     bound to a token that no longer matches and would be refused as a conflict. A
--     stash only a stale token could reach is dead state, and §17 asks that nothing be
--     left that could be re-shown.
--   * **`draft` is not named**, and that is the whole of what protects a pending manual
--     announcement somebody is halfway through writing. It survives the removal
--     untouched, as it survives every other lifecycle write in this system.
--
-- Nothing is resurrected. The displaced announcement is **not** put back: §6's ~10 s
-- Fortryd after a replacement is the restore path this model has, and deleting an
-- override is not a second, silent one.
--
--
-- ---------------------------------------------------------------------------
-- AN OVERRIDE NAMED ONLY BY `previous` — §18 of the brief
-- ---------------------------------------------------------------------------
--
-- Generated A is owned by override A; generated B, owned by override B, replaces it; so
-- `previous.source_override_id` is A. A now owns nothing the foreign key can see, and
-- deleting it would leave a snapshot naming a row that is gone — `owner_missing` on the
-- next Fortryd.
--
-- The deletion resolves it rather than leaving it: `previous` and `replaced_at` are
-- cleared, the **current** announcement B is left exactly as it stands, the override is
-- deleted, and both are audited. This is not a thing to ask about — the person is
-- deleting the source that snapshot describes, and there is no second answer in which
-- the snapshot stays meaningful. A Fortryd that was already on screen then fails as a
-- conflict, which is correct: somebody explicitly deleted the thing it would restore.
--
-- No history table, and no text parsing. Which override owns what is
-- `announcement.source_override_id` and `previous ->> 'source_override_id'`, and
-- nothing else ever.
-- ===========================================================================


-- ===========================================================================
-- 1. The DELETE guard — the rule privileges cannot express
-- ===========================================================================
--
-- BEFORE DELETE, one row at a time, for every deleter. It answers one question — *was
-- this delete issued by `remove_opening_hours_override()`?* — and refuses otherwise.
--
-- SECURITY INVOKER, like everything else here. It reads no table, calls no helper and
-- holds no privilege of its own. There is nothing in it for a SECURITY DEFINER to be
-- needed for.
--
-- The refusal is `42501` — the same code a missing grant produces — because that is what
-- it is from the caller's side: permission denied, decided by a rule instead of by a
-- grant. PostgREST turns it into a 403.

create or replace function public.tg_guard_override_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op text;
begin
  -- The guard exists for the two roles a PostgREST request runs as. A migration,
  -- `supabase/seed.sql` and the pgTAP fixtures are not browser sessions: they arrive as
  -- `postgres` or `service_role`, they are already trusted with the whole table, and a
  -- guard that stopped them would stop `supabase db reset`. `authenticated` is a member
  -- of no other role, so this is not an exemption a session can put on.
  if current_user not in ('anon', 'authenticated') then
    return old;
  end if;

  v_op := pg_catalog.current_setting('app.opening_hours_override_write', true);

  -- Single use: the marker authorises this row-delete and no later one. Consumed here
  -- and cleared again by the function after its DELETE, exactly as the announcement
  -- guard consumes its own.
  if v_op is not null and v_op <> '' then
    perform pg_catalog.set_config('app.opening_hours_override_write', '', true);
  end if;

  -- `coalesce` rather than a bare comparison: an unset marker is SQL NULL, and a NULL
  -- comparison is neither true nor false — which `if` treats as false, so this is
  -- belt-and-braces rather than load-bearing. It is written the same way as the
  -- announcement guard so the two read alike.
  if coalesce(v_op, '') <> 'remove' then
    raise exception
      'opening_hours_overrides: a one-off change is removed only by remove_opening_hours_override(), which checks the version, the announcement it may own and the audit trail'
      using errcode = '42501';
  end if;

  return old;
end;
$fn$;

comment on function public.tg_guard_override_delete() is
  'BEFORE DELETE on public.opening_hours_overrides: refuses any deletion that did not come from remove_opening_hours_override(). A direct PostgREST DELETE would bypass the version check, the generated-announcement ownership rules, the previous-snapshot cleanup and the audit row (technical plan section 5, section 7e item 6, section 8).';

drop trigger if exists overrides_guard_delete on public.opening_hours_overrides;

create trigger overrides_guard_delete
  before delete on public.opening_hours_overrides
  for each row execute function public.tg_guard_override_delete();

revoke all on function public.tg_guard_override_delete() from public, anon, authenticated;


-- ===========================================================================
-- 2. The announcement write guard, taught two more transitions
-- ===========================================================================
--
-- Byte-identical to `20260831180000`'s except for the two names added to the four
-- vocabularies below. Restated in full rather than patched, because the whole point of
-- the guard is that a reader can see every transition it permits in one place.
--
--   `detach`            — the generated announcement is taken down because the override
--                         that owns it has been deleted. Moves the content, the
--                         visibility, the source and the lifecycle columns: it is the
--                         one transition that clears all four at once.
--   `discard_previous`  — the stashed snapshot named an override that is being deleted,
--                         so the stash is dropped. Moves the **lifecycle columns only**;
--                         the published announcement is not touched, and this marker
--                         does not permit touching it.
--
-- Both are set only by `remove_opening_hours_override()` in §3, immediately before its
-- own UPDATE, and cleared immediately after it.

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
  v_owner     boolean;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  v_op := pg_catalog.current_setting('app.announcement_write', true);

  if v_op is not null and v_op <> '' then
    perform pg_catalog.set_config('app.announcement_write', '', true);
  end if;

  v_op        := coalesce(v_op, '');
  v_content   := v_op in ('publish', 'replace', 'restore', 'detach');
  v_visible   := v_op in ('publish', 'visibility', 'replace', 'restore', 'detach');
  v_source    := v_op in ('replace', 'restore', 'detach');
  v_owner     := v_op in ('replace', 'restore', 'detach');
  v_lifecycle := v_op in ('replace', 'restore', 'detach', 'discard_previous');

  if not v_content and (
       new.message    is distinct from old.message
    or new.link_type  is distinct from old.link_type
    or new.link_page  is distinct from old.link_page
    or new.link_url   is distinct from old.link_url
    or new.link_label is distinct from old.link_label
    or new.expires_at is distinct from old.expires_at)
  then
    raise exception
      'announcement: the published message, its link and its expiry are written only by publish_announcement(), replace_announcement(), restore_announcement() or remove_opening_hours_override()'
      using errcode = '42501';
  end if;

  if not v_visible and new.is_visible is distinct from old.is_visible then
    raise exception
      'announcement: is_visible is written only by set_announcement_visible(), publish_announcement(), replace_announcement(), restore_announcement() or remove_opening_hours_override()'
      using errcode = '42501';
  end if;

  if not v_source and new.source is distinct from old.source then
    raise exception
      'announcement: source is written only by replace_announcement(), restore_announcement() or remove_opening_hours_override()'
      using errcode = '42501';
  end if;

  -- Ownership is provenance and moves with it (8C-3A), so it answers to the same
  -- vocabulary `source` does rather than to a fifth one.
  if not v_owner and new.source_override_id is distinct from old.source_override_id then
    raise exception
      'announcement: source_override_id is written only by replace_announcement(), restore_announcement() or remove_opening_hours_override()'
      using errcode = '42501';
  end if;

  if not v_lifecycle and (
       new.previous    is distinct from old.previous
    or new.replaced_at is distinct from old.replaced_at)
  then
    raise exception
      'announcement: previous and replaced_at are written only by replace_announcement(), restore_announcement() or remove_opening_hours_override()'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_guard_announcement_write() is
  'BEFORE UPDATE on public.announcement: refuses any movement of the published, visibility, source, ownership and lifecycle columns that did not come from the lifecycle transition owning it. A direct PostgREST write owns draft and nothing else (technical plan section 5, section 8).';


-- ===========================================================================
-- 3. remove_opening_hours_override — it asks, and then it does both halves
-- ===========================================================================
--
-- The 8B lifecycle is unchanged and is still the caller's to choose between: a draft
-- that was never live, a draft behind a live override, and a live override are three
-- different removals, and `describeOverrideRemoval()` in TypeScript is still the single
-- decision table that words them. This function gains one parameter and two branches.
--
-- `p_remove_announcement` is the answer to §7e item 6's question, and **only** to that
-- question. It cannot make a deletion happen that would not otherwise happen, it cannot
-- reach an announcement that this override does not own, and it is ignored entirely
-- unless the override owns the current one. False is the safe value and the refusal it
-- produces is the 8C-3A behaviour, unchanged.
--
-- The old two-argument signature is dropped rather than overloaded: two functions of the
-- same name reachable through PostgREST is an ambiguity, not a compatibility story.
--
-- Everything else about this function is phase 8B's and 8C-3A's, unchanged: SECURITY
-- INVOKER, `set search_path = ''`, the version token re-checked inside the DELETE, the
-- audit row, and the same status vocabulary.

drop function if exists public.remove_opening_hours_override(uuid, timestamptz);

create or replace function public.remove_opening_hours_override(
  p_id                  uuid,
  p_expected_updated_at timestamptz,
  p_remove_announcement boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row      public.opening_hours_overrides%rowtype;
  v_ann      public.announcement%rowtype;
  v_before   jsonb;
  v_ann_before jsonb;
  v_ann_after  jsonb;
  v_owns_current  boolean;
  v_owns_previous boolean;
  v_written  boolean;
  v_removed_announcement boolean := false;
  v_discarded_previous   boolean := false;
begin
  select * into v_row from public.opening_hours_overrides t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  /*
   * `for update`, and the lock is the point.
   *
   * This function reads the singleton, decides from what it read, and then writes it —
   * and between those two steps another session could replace the announcement and move
   * its ownership to a different override. Without the lock this transaction would go on
   * to clear a message it never looked at, on behalf of an override that no longer owns
   * anything.
   *
   * Taking the row lock at the read makes the two operations serialise on the same row
   * `replace_announcement()` and `restore_announcement()` already lock at *their* UPDATE:
   * whichever arrives second waits, and then meets the `updated_at` check it was always
   * going to meet. There is no lock-ordering inversion to deadlock on — every announcement
   * write in this schema takes this one row and nothing else.
   */
  select * into v_ann from public.announcement t limit 1 for update;

  -- The snapshot half is compared **as text**, deliberately. A cast to `uuid` would
  -- raise `22P02` on a malformed `previous` — a value only a service-role script or a
  -- future migration could have written, but one this function must not fail on — and
  -- `announcement_snapshot()` writes the id in its canonical lowercase form, so the two
  -- renderings cannot disagree.
  v_owns_current  := v_ann.id is not null and v_ann.source_override_id = p_id;
  v_owns_previous := v_ann.id is not null and v_ann.previous ->> 'source_override_id' = p_id::text;

  -- §7e item 6's question, asked once and answered by the caller. Nothing is written in
  -- this branch: no announcement, no override, no audit row.
  if v_owns_current and not coalesce(p_remove_announcement, false) then
    return jsonb_build_object(
      'status', 'owns_announcement',
      'entity_id', p_id,
      'owns', 'current');
  end if;

  v_before := public.opening_hours_override_content(v_row);

  /*
   * The announcement half, first and in the same transaction.
   *
   * Before the DELETE rather than after it, because the foreign key is
   * `on delete restrict`: while `source_override_id` still names this row the delete
   * cannot succeed at all. Ordering the two the other way round would be a constraint
   * violation rather than a bug that got as far as a wrong state, but it would also be
   * a transaction that could never commit.
   */
  if v_owns_current then
    v_ann_before := public.announcement_snapshot(v_ann);

    perform pg_catalog.set_config('app.announcement_write', 'detach', true);

    update public.announcement t set
      message            = null,
      link_type          = 'none',
      link_page          = null,
      link_url           = null,
      link_label         = null,
      expires_at         = null,
      is_visible         = false,
      source             = 'manual',
      source_override_id = null,
      -- Whatever was stashed is unreachable after this statement moves `updated_at`, and
      -- §17 asks that nothing be left that could be re-shown. `draft` is not named.
      previous           = null,
      replaced_at        = null
     where t.id = v_ann.id
    returning * into v_ann;

    v_written := found;
    perform pg_catalog.set_config('app.announcement_write', '', true);

    if not v_written then return jsonb_build_object('status', 'forbidden'); end if;

    v_removed_announcement := true;
    v_ann_after := public.announcement_snapshot(v_ann);
    perform public.log_audit('remove_generated', 'announcement', v_ann.id, v_ann_before, v_ann_after);

  elsif v_owns_previous then
    -- §18. The current announcement is not touched and this marker does not permit
    -- touching it; only the obsolete stash goes.
    v_ann_before := public.announcement_snapshot(v_ann);

    perform pg_catalog.set_config('app.announcement_write', 'discard_previous', true);

    update public.announcement t set
      previous    = null,
      replaced_at = null
     where t.id = v_ann.id
    returning * into v_ann;

    v_written := found;
    perform pg_catalog.set_config('app.announcement_write', '', true);

    if not v_written then return jsonb_build_object('status', 'forbidden'); end if;

    v_discarded_previous := true;
    v_ann_after := public.announcement_snapshot(v_ann);
    perform public.log_audit('discard_previous', 'announcement', v_ann.id, v_ann_before, v_ann_after);
  end if;

  -- The marker this table's own guard consumes, spent on exactly one row-delete.
  perform pg_catalog.set_config('app.opening_hours_override_write', 'remove', true);

  delete from public.opening_hours_overrides t
   where t.id = p_id
     and t.updated_at = p_expected_updated_at;

  v_written := found;
  perform pg_catalog.set_config('app.opening_hours_override_write', '', true);

  if not v_written then
    -- The pre-check passed, so either RLS refused the delete or another session moved
    -- the row first. The probe tells them apart, so the person is told which happened.
    -- Either way the whole transaction rolls back, announcement included: the two halves
    -- commit together or not at all (§19).
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
    'removed_announcement', v_removed_announcement,
    'discarded_previous', v_discarded_previous,
    'before', v_before);
end;
$fn$;

comment on function public.remove_opening_hours_override(uuid, timestamptz, boolean) is
  'Removes one one-off opening-hours change so the date follows the weekly schedule again, together with the generated announcement it owns when the caller confirms it (technical plan section 7e item 6). One transaction, audited, SECURITY INVOKER. Refuses with owns_announcement while it owns the current announcement and removal was not confirmed; silently discards an obsolete previous snapshot that named it. The only path by which a row of this table may be deleted at all - a direct DELETE is refused by overrides_guard_delete.';

revoke all on function public.remove_opening_hours_override(uuid, timestamptz, boolean) from public, anon;
grant execute on function public.remove_opening_hours_override(uuid, timestamptz, boolean) to authenticated;
