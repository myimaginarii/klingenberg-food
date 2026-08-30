-- Klingenberg Food — phase 6B: administering Månedens burger (§4, §6, §7b, §7d, §8).
--
-- Design 1ah is the editor. Phase 4 already built everything this screen needs in order
-- to *publish*: `publish_monthly_burger()` merges the draft into the columns, clears it,
-- writes one audit row and does all of it in one transaction, and it deliberately does
-- not name `sold_out_on`. Nothing about that is touched here, and there is deliberately
-- **no second monthly-burger publishing path**.
--
-- What phase 6B adds is the one operation that is *not* a publish, because §6 says it is
-- not: **Udsolgt i dag**. §6's immediate-path table names Månedens burger by name —
-- *"Tilgængelig / Udsolgt on a dish, Ugens ret, Lørdagsmenu, Månedens burger"* — and
-- 1ah draws the switch with its own promise beside it: *"Udsolgt slår igennem straks"*.
-- So it writes the live column, bypasses the draft entirely, and offers ~10 seconds of
-- Fortryd.
--
-- WHY THIS IS A THIRD FUNCTION AND NOT A PARAMETER ON ONE OF THE OTHER TWO
--
-- `set_dish_sold_out()` names `public.dishes` in every statement and writes the
-- `sold_out_changed_at` / `sold_out_changed_by` attribution columns that only that table
-- has. `set_weekly_special_sold_out()` names `public.weekly_special` and has to choose
-- between *two* sold-out columns on one row. `monthly_burger` is a third shape again:
-- one singleton row, one sold-out column, no attribution columns, and no target to
-- select between — so this function takes no target at all.
--
-- A function that took a table name, a column name and an attribution policy as
-- arguments would be a function that can be pointed at a table nobody reviewed. Three
-- tables, three functions, each readable on its own, sharing the one thing they
-- genuinely share: §7b's reset rule, which is computed at read time in
-- `lib/menu/availability.ts` and is not restated in any of them.
--
-- WHAT `set_monthly_burger_sold_out()` GUARANTEES
--
--   1. **One transaction.** The column write and the audit row commit together or not
--      at all.
--   2. **Exactly one column moves, and it is named in the text.** One UPDATE, one
--      `set`, one column. A caller cannot reach `name`, `description`, `price_ore`,
--      `image_id`, `starts_on`, `ends_on`, `show_on_homepage` or `draft`, because no
--      statement here mentions them. That is a property of the text rather than of a
--      check somebody has to remember to write.
--   3. **The actor comes from the JWT.** `public.log_audit()` stamps `actor_id` itself;
--      it is not a parameter, so attribution cannot be forged.
--   4. **The date is today's, in Copenhagen, or nothing.** Verified here, before the row
--      is even read, so a malformed request cannot learn anything about the row. The
--      browser never chooses it — `lib/menu/monthly-availability.ts` is the only caller
--      and determines it from the same boundary module the hours engine uses.
--   5. **Optimistic concurrency (§6, §7e item 2).** The version the screen was rendered
--      from is part of the UPDATE's WHERE clause, so a colleague's change is reported as
--      a conflict rather than silently overwritten — and a conflict writes no audit row,
--      because the statement never runs.
--   6. **No draft is created.** `draft` is not named in either direction, so a burger
--      that is sold out gains no Kladde badge and appears in no publish list.
--
-- SECURITY INVOKER, like every function phase 4, 5C and 6A added: RLS re-decides
-- `is_staff()` against the caller's own JWT, so the application's guard is not the only
-- gate (§5, §8). Both Staff and Owner may do this — §5's matrix says so in the row
-- "Månedens burger (draft, publish, date window)" and in the availability row above it —
-- and `monthly_burger_update_staff` is the policy that enforces it.
--
-- NOTHING IS SCHEDULED. `starts_on` / `ends_on` remain a read-time filter and never a
-- scheduler (§7d, clarification C4), and a sold-out marking clears itself on read
-- through `resolveSoldOut()` (§7b). No job, no cron, no `sold_out_expires_at`.
--
-- The `monthly_burger_sold_out_guard` trigger from the initial schema stays where it is.
-- It allows ±1 day and exists to catch a timezone slip on *any* write to the table; this
-- function is stricter, and is the rule. The trigger is the backstop beneath it.


-- ===========================================================================
-- 1. The audited shape of the monthly burger's availability
-- ===========================================================================
--
-- `monthly_burger_content()` from phase 4 describes what a *publish* changes. This is
-- the immediate path's equivalent, and it is deliberately one field wide: an audit entry
-- for an availability change should record availability, so that reading the log makes
-- it obvious the operation cannot have moved anything else.

create or replace function public.monthly_burger_availability(m public.monthly_burger)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object('sold_out_on', m.sold_out_on)
$fn$;

comment on function public.monthly_burger_availability(public.monthly_burger) is
  'The one immediate-path column, for the audit entry an availability change writes (§6, §7b).';


-- ===========================================================================
-- 2. set_monthly_burger_sold_out — the immediate availability transaction (§6, §7b)
-- ===========================================================================
--
-- Returns the same jsonb vocabulary the publish functions, `set_dish_sold_out()` and
-- `set_weekly_special_sold_out()` use, so the application maps one shape rather than
-- four:
--
--   status = 'updated'      the row changed; `before`/`after` carry the column
--          | 'unchanged'    it already held that value; nothing was written or logged
--          | 'not_found'    no row, or RLS hides it
--          | 'conflict'     the row moved on since the screen was rendered (§6)
--          | 'forbidden'    RLS refused the write
--          | 'invalid_date' the date was neither NULL nor today in Copenhagen
--
-- `unchanged` rather than a second identical audit row: pressing Udsolgt twice — two
-- taps on a phone, a double submit, a resubmitted POST — is one decision, and the log
-- should say so. It is still a success from the screen's point of view, because the row
-- ends in the state that was asked for.

create or replace function public.set_monthly_burger_sold_out(
  p_sold_out_on         date,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.monthly_burger%rowtype;
  v_today  date := (now() at time zone 'Europe/Copenhagen')::date;
  v_before jsonb;
  v_after  jsonb;
begin
  -- The date is the application's to determine and this function's to verify. Stated
  -- before anything is read, so a malformed request cannot even learn whether the row
  -- exists.
  if p_sold_out_on is not null and p_sold_out_on <> v_today then
    return jsonb_build_object('status', 'invalid_date', 'today', v_today);
  end if;

  select * into v_row from public.monthly_burger t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  if v_row.sold_out_on is not distinct from p_sold_out_on then
    return jsonb_build_object(
      'status', 'unchanged', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
      'before', public.monthly_burger_availability(v_row),
      'after',  public.monthly_burger_availability(v_row));
  end if;

  v_before := public.monthly_burger_availability(v_row);

  -- One statement, one column. The version check is repeated inside the statement, so
  -- the decision to write and the write itself cannot come apart.
  update public.monthly_burger t
     set sold_out_on = p_sold_out_on
   where t.id = v_row.id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
    if exists (select 1 from public.monthly_burger t
                where t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.monthly_burger_availability(v_row);
  perform public.log_audit('availability', 'monthly_burger', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'updated', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.set_monthly_burger_sold_out(date, timestamptz) is
  'Immediate Udsolgt/Tilgaengelig for Maanedens burger: one named column plus the audit row, one transaction. No draft (§6, §7b).';


-- ===========================================================================
-- 3. Privileges
-- ===========================================================================
--
-- `authenticated` only, exactly as phases 4, 5C and 6A granted theirs. `anon` is revoked
-- explicitly rather than left to the default, so the grant is readable as an intention
-- rather than inferred from an absence.

revoke all on function public.monthly_burger_availability(public.monthly_burger) from public, anon;
revoke all on function public.set_monthly_burger_sold_out(date, timestamptz)      from public, anon;

grant execute on function public.monthly_burger_availability(public.monthly_burger) to authenticated;
grant execute on function public.set_monthly_burger_sold_out(date, timestamptz)     to authenticated;
