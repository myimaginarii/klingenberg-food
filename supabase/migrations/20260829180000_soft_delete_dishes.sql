-- Klingenberg Food — phase 5D: soft-deleting a dish, and taking it back (§4, §6, §8).
--
-- The second — and last — immediate path in this system. Like Udsolgt (phase 5C) it
-- bypasses Kladde → Forhåndsvis → Offentliggør entirely: pressing Slet ret removes the
-- dish from the hjemmeside on the next request, and Fortryd puts it back. §6 lists it
-- in as many words: *"Delete a dish | soft delete (`deleted_at`) | 10 s Fortryd clears
-- `deleted_at`"*.
--
-- It gets its **own** function rather than being folded together with
-- `set_dish_sold_out`. The two operations look alike from a distance — one column, one
-- audit row, one version check — and are entirely different underneath: availability
-- refuses to touch a deleted dish, deletion must reach one; availability writes a date
-- the function validates, deletion writes an instant the function chooses; and the
-- negative promise each of them makes names a different column. A shared "immediate
-- action" function would have to be told which of those it was doing, and the promise
-- "this statement cannot move anything else" would stop being a property of the text.
--
-- WHAT THIS FUNCTION GUARANTEES
--
--   1. **One transaction.** The column write, its attribution and the audit row commit
--      together or not at all. PostgREST wraps the call, so there is no path where the
--      dish leaves the menu and the log does not say who removed it.
--   2. **Only `deleted_at` and `deleted_by` move.** The UPDATE names two columns. A
--      caller cannot extend this operation to a price, a name, a category, a label,
--      `sold_out_on`, `is_new_draft` or `draft`, because no statement here mentions
--      them. That is a property of the text, not of a check somebody has to remember.
--   3. **The row is never removed.** There is no DELETE statement in this file. §8's
--      recovery story for a dish is the row itself, and phase 5D adds no purge, no
--      retention job and no hard delete — those are a later decision, not a side effect
--      of this one.
--   4. **The actor comes from the JWT.** `deleted_by` is `auth.uid()` and the audit row
--      goes through `public.log_audit()`, which takes its actor from the JWT too (§8).
--      Neither is a parameter, so attribution cannot be forged.
--   5. **Optimistic concurrency (§6, §7e item 2).** The version the screen was rendered
--      from is part of the UPDATE's WHERE clause, so a colleague's intervening edit is
--      reported as a conflict rather than silently overwritten — and a conflict writes
--      no audit row, because the whole statement never runs. This is what stops a stale
--      Fortryd, offered ten seconds ago and pressed in a tab left open since, from
--      quietly undoing somebody else's work.
--   6. **`pages.home` is not touched, and cannot be.** No statement in this file names
--      `public.pages`, and the function is SECURITY INVOKER, so a Staff member calling
--      it holds exactly the privileges `pages_update_scoped` gives them — which for the
--      `home` row is none (§5). Deleting a dish that Forsiden features therefore leaves
--      the Forside document exactly as the Owner left it; the reference simply stops
--      resolving, and `selectFeaturedDishes()` already drops what it cannot resolve.
--      Nulling the reference here would need a privilege-elevation path, and the
--      permission matrix is not something a delete button gets to route around.
--
-- SECURITY INVOKER, like every publish function and like `set_dish_sold_out`: RLS
-- re-decides `is_staff()` against the caller's own JWT, so the application's guard is
-- not the only gate (§5, §8). Both Staff and Owner may delete and restore a dish (§5
-- matrix, first row); `dishes_update_staff` is the policy that says so.


-- ===========================================================================
-- 1. Deletion attribution (§4)
-- ===========================================================================
--
-- `dishes.deleted_at` has existed since the initial schema; `deleted_by` has not, and
-- the plan's field list for `dishes` does not name it. It is added here as the smallest
-- change that makes the operation answerable, and it follows a convention the table
-- already has rather than inventing one: `sold_out_changed_by` records who made the
-- other immediate change, for exactly the same reason.
--
-- Why not lean on `updated_by`, which the touch trigger already stamps? Because it is
-- overwritten by the *next* write — a restore, or a later publish — so it answers "who
-- touched this last", not "who removed it". And why not lean on `audit_log` alone?
-- Because Staff cannot read `audit_log` (§5), so it can answer the question for an
-- Owner and for nobody else. One nullable uuid closes both gaps.
--
-- No `deleted_changed_at`: `deleted_at` *is* the instant, so a second timestamp would
-- be a copy of it that could disagree.
--
-- `anon` is granted SELECT column by column in the initial schema, so a new column is
-- unreadable publicly by construction — nothing has to be revoked here. `authenticated`
-- holds a table-level grant and picks the column up with the same RLS as before.

alter table public.dishes
  add column deleted_by uuid references auth.users (id) on delete set null;

comment on column public.dishes.deleted_by is
  'Who soft-deleted the dish, from the JWT. NULL whenever deleted_at is NULL (§4, §6).';


-- ===========================================================================
-- 2. The sold-out date guard only guards a date that is being written (§4)
-- ===========================================================================
--
-- `tg_guard_sold_out_date` rejects a sold-out date more than one day from today in
-- Copenhagen. Its own header says what it is for: *"validate what is being written, at
-- the moment it is written"*. It did not quite do that. It read `NEW` unconditionally,
-- so it also validated a value that was **not** being written — and `sold_out_on` is
-- deliberately allowed to go stale, because §7b resets availability by derivation on
-- read and never by clearing the column:
--
--     "a stale historical date may sit in the column until the next write. That is by
--      design — a stored expiry would go out of date the moment the opening hours
--      changed."
--
-- Put together, those two sentences made a dish that was marked Udsolgt on Friday
-- impossible to change at all on Monday: deleting it, restoring it or publishing a
-- draft on it would each raise a check violation about a column the statement never
-- touched. Phase 5D is where that first becomes reachable from a screen, so it is fixed
-- here rather than worked around.
--
-- The fix is one clause, and it narrows nothing: on UPDATE, a column whose value is
-- unchanged is not being written, so there is nothing to validate. Writing a date is
-- still checked exactly as before, on INSERT and on UPDATE alike — including the
-- ±1-day window and every existing assertion about it.

create or replace function public.tg_guard_sold_out_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  today_cph date := (now() at time zone 'Europe/Copenhagen')::date;
  col       text;
  val       date;
  old_val   date;
begin
  foreach col in array tg_argv loop
    execute format('select ($1).%I', col) into val using new;

    -- An UPDATE that leaves the column alone is not a write of this column, so it is
    -- not this trigger's business. Only a value that is actually changing is checked.
    if tg_op = 'UPDATE' then
      execute format('select ($1).%I', col) into old_val using old;
      if val is not distinct from old_val then
        continue;
      end if;
    end if;

    if val is not null and val not between today_cph - 1 and today_cph + 1 then
      raise exception
        'Column %.% must be within one day of the current Copenhagen date (%), got %.',
        tg_table_name, col, today_cph, val
        using errcode = 'check_violation',
              hint = 'sold_out_on is always written as today''s Copenhagen-local date (§4, §7b).';
    end if;
  end loop;

  return new;
end;
$fn$;

comment on function public.tg_guard_sold_out_date() is
  'BEFORE INSERT/UPDATE: rejects a sold-out date more than one day from today in Europe/Copenhagen. A value that is not changing is not validated (§4, §7b).';


-- ===========================================================================
-- 3. The audited shape of a dish's deletion
-- ===========================================================================
--
-- One field wide, for the same reason `dish_availability` is: an audit entry for a
-- deletion should record the deletion, so that reading the log makes it obvious this
-- operation cannot have moved anything else. What was deleted is not copied into the
-- log either — the row is still there, whole, which is the entire point of a soft
-- delete.

create or replace function public.dish_deletion(d public.dishes)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object('deleted_at', d.deleted_at)
$fn$;

comment on function public.dish_deletion(public.dishes) is
  'The one field the soft-delete path may change, as the audit before/after pair (§6).';


-- ===========================================================================
-- 4. set_dish_deleted — the soft-delete transaction (§6)
-- ===========================================================================
--
-- Returns the vocabulary the publish functions and `set_dish_sold_out` already use, so
-- the application maps one shape rather than three:
--
--   status = 'deleted'    the dish was soft-deleted; `before`/`after` carry the pair
--          | 'restored'   the dish came back
--          | 'unchanged'  it already stood that way; nothing was written or logged
--          | 'not_found'  no such dish, or RLS hides it
--          | 'conflict'   the row moved on since the screen was rendered (§6)
--          | 'forbidden'  RLS refused the write
--
-- Two statuses rather than one for a success, and two audit actions beneath them, so
-- the log reads as what happened — 'delete' and 'restore' — instead of as one action
-- whose meaning has to be reconstructed from its before/after pair (§10).
--
-- `unchanged` rather than a second identical audit row: a resubmitted POST, a double
-- tap or a Fortryd pressed twice is one decision, and the log should say so. It is
-- still a success from the screen's point of view, because the dish ends in the state
-- that was asked for.
--
-- Note what is **absent** from the row lookup: `set_dish_sold_out` filters
-- `deleted_at is null`, because a dish on its way out has no availability worth
-- changing. This function must be able to reach a deleted dish — restoring one is half
-- of what it does — so it filters on nothing but the id, and lets RLS decide the rest.

create or replace function public.set_dish_deleted(
  p_id                  uuid,
  p_deleted             boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.dishes%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.dishes t where t.id = p_id;

  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  if (v_row.deleted_at is not null) = p_deleted then
    return jsonb_build_object(
      'status', 'unchanged', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
      'before', public.dish_deletion(v_row), 'after', public.dish_deletion(v_row));
  end if;

  v_before := public.dish_deletion(v_row);

  -- Two columns, named. The version check is repeated inside the statement, so the
  -- decision to write and the write itself cannot come apart. `draft`, `sold_out_on`
  -- and `is_new_draft` are deliberately absent: deleting a dish preserves the work
  -- somebody left in progress on it, and restoring it hands that work back untouched.
  update public.dishes t
     set deleted_at = case when p_deleted then now() else null end,
         deleted_by = case when p_deleted then (select auth.uid()) else null end
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
    if exists (select 1 from public.dishes t
                where t.id = p_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.dish_deletion(v_row);
  perform public.log_audit(
    case when p_deleted then 'delete' else 'restore' end,
    'dish', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', case when p_deleted then 'deleted' else 'restored' end,
    'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.set_dish_deleted(uuid, boolean, timestamptz) is
  'Soft delete / restore: deleted_at plus its attribution column and the audit row, one transaction. Never a DELETE, never pages.home (§6, §8).';

revoke all on function public.dish_deletion(public.dishes)                from public, anon;
revoke all on function public.set_dish_deleted(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.dish_deletion(public.dishes)                to authenticated;
grant execute on function public.set_dish_deleted(uuid, boolean, timestamptz) to authenticated;
