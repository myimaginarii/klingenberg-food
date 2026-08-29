-- Klingenberg Food — phase 5C: the immediate "Udsolgt i dag" path (§4, §6, §7b, §8).
--
-- Availability is the **one** exception to Kladde → Forhåndsvis → Offentliggør (§6,
-- design 1aa): pressing Udsolgt changes the public menu at once, with no draft, no
-- preview and no publish. That makes it a different kind of write from everything
-- phase 4 built, and it gets its own function rather than being bent into the publish
-- machinery — which merges a draft and clears it, and has no business touching
-- `sold_out_on` at all (`publish_dish` deliberately omits the column).
--
-- WHAT THIS FUNCTION GUARANTEES
--
--   1. **One transaction.** The column write, the two attribution columns and the
--      audit row commit together or not at all. PostgREST wraps the call, so there is
--      no path where the menu changes and the log does not, or the reverse.
--   2. **Only `sold_out_on` moves.** The UPDATE names three columns. A caller cannot
--      extend this operation to a price, a name, a category, a draft or `deleted_at`,
--      because no statement here mentions them. That is a property of the text, not of
--      a check somebody has to remember to write.
--   3. **The actor comes from the JWT.** `sold_out_changed_by` is `auth.uid()` and the
--      audit row is written through `public.log_audit()`, which takes the actor from
--      the JWT too (§8). Neither is a parameter, so attribution cannot be forged.
--   4. **The date is today's, in Copenhagen, or nothing.** The parameter exists so the
--      application states its intent explicitly, and it is verified here: anything
--      other than NULL or today's Copenhagen date is refused. The browser never
--      chooses it — see `lib/menu/sold-out.ts`, which is the only caller.
--   5. **Optimistic concurrency (§6, §7e item 2).** The version the screen was rendered
--      from is part of the UPDATE's WHERE clause, so a colleague's change is reported
--      as a conflict rather than silently overwritten — and a conflict writes no audit
--      row, because the whole statement never runs.
--
-- SECURITY INVOKER, like every publish function: RLS re-decides `is_staff()` against
-- the caller's own JWT, so the application's guard is not the only gate (§5, §8).
-- Both Staff and Owner may change availability (§5 matrix); `dishes_update_staff` is
-- the policy that says so, and owners are staff.
--
-- The `dishes_sold_out_guard` trigger from the initial schema stays where it is. It
-- allows ±1 day and exists to catch a timezone slip on *any* write to the table; this
-- function is stricter, and is the rule. The trigger is the backstop beneath it.
--
-- NOTHING IS SCHEDULED. There is no job that clears `sold_out_on` when the restaurant
-- next opens (§4, §7b): the reset is derived on read by `resolveSoldOut()`, so a stale
-- historical date may sit in the column until the next write. That is by design — a
-- stored expiry would go out of date the moment the opening hours changed.


-- ===========================================================================
-- 1. The audited shape of a dish's availability
-- ===========================================================================
--
-- The `*_content` functions from phase 4 describe what a *publish* changes. This is the
-- immediate path's equivalent, and it is deliberately one field wide: an audit entry
-- for an availability change should record availability, so that reading the log makes
-- it obvious this operation cannot have moved anything else.

create or replace function public.dish_availability(d public.dishes)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object('sold_out_on', d.sold_out_on)
$fn$;

comment on function public.dish_availability(public.dishes) is
  'The one field the immediate availability path may change, as the audit before/after pair (§7b).';


-- ===========================================================================
-- 2. set_dish_sold_out — the immediate availability transaction (§6, §7b)
-- ===========================================================================
--
-- Returns the same jsonb vocabulary the publish functions use, so the application maps
-- one shape rather than two:
--
--   status = 'updated'      the dish changed; `before`/`after` carry the pair
--          | 'unchanged'    it already held that value; nothing was written or logged
--          | 'not_found'    no such dish, or RLS hides it, or it is soft-deleted
--          | 'conflict'     the row moved on since the screen was rendered (§6)
--          | 'forbidden'    RLS refused the write
--          | 'invalid_date' the date was neither NULL nor today in Copenhagen
--
-- `unchanged` rather than a second identical audit row: pressing Udsolgt twice — two
-- taps on a phone, a double submit, a resubmitted POST — is one decision, and the log
-- should say so. It is still a success from the screen's point of view, because the
-- dish ends in the state that was asked for.

create or replace function public.set_dish_sold_out(
  p_id                  uuid,
  p_sold_out_on         date,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.dishes%rowtype;
  v_today  date := (now() at time zone 'Europe/Copenhagen')::date;
  v_before jsonb;
  v_after  jsonb;
begin
  -- The date is the application's to determine and this function's to verify. Stated
  -- before anything is read, so a malformed request cannot even learn whether the dish
  -- exists.
  if p_sold_out_on is not null and p_sold_out_on <> v_today then
    return jsonb_build_object('status', 'invalid_date', 'today', v_today);
  end if;

  select * into v_row
    from public.dishes t
   where t.id = p_id
     and t.deleted_at is null;

  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  if v_row.sold_out_on is not distinct from p_sold_out_on then
    return jsonb_build_object(
      'status', 'unchanged', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
      'before', public.dish_availability(v_row), 'after', public.dish_availability(v_row));
  end if;

  v_before := public.dish_availability(v_row);

  -- Three columns, named. The version check is repeated inside the statement, so the
  -- decision to write and the write itself cannot come apart.
  update public.dishes t
     set sold_out_on         = p_sold_out_on,
         sold_out_changed_at = now(),
         sold_out_changed_by = (select auth.uid())
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.deleted_at is null
  returning * into v_row;

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
    if exists (select 1 from public.dishes t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.deleted_at is null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.dish_availability(v_row);
  perform public.log_audit('availability', 'dish', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'updated', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.set_dish_sold_out(uuid, date, timestamptz) is
  'Immediate Udsolgt/Tilgaengelig: sold_out_on plus its two attribution columns and the audit row, one transaction. No draft (§6, §7b).';

revoke all on function public.dish_availability(public.dishes)              from public, anon;
revoke all on function public.set_dish_sold_out(uuid, date, timestamptz)    from public, anon;
grant execute on function public.dish_availability(public.dishes)           to authenticated;
grant execute on function public.set_dish_sold_out(uuid, date, timestamptz) to authenticated;
