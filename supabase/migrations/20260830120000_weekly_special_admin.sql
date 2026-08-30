-- Klingenberg Food — phase 6A: administering Ugens ret and Lørdagsmenu (§4, §6, §7b, §8).
--
-- Design 1ag is the editor; 1af is every public state it produces. Phase 4 already
-- built everything this screen needs in order to *publish*: `publish_weekly_special()`
-- merges the draft into the columns, clears it, writes one audit row and does all of it
-- in one transaction. Nothing about that is touched here, and there is deliberately no
-- second weekly-special publishing path.
--
-- What phase 6A adds is the two operations that are **not** a publish, because §6 says
-- they are not:
--
--   1. **Udsolgt i dag**, on the weekly dish and on the Saturday menu. §6's
--      immediate-path table names both by name, and 1ag draws a "Tilgængelig" switch on
--      each card: *"Ændres straks på hjemmesiden"* and *"Udsolgt slår igennem med det
--      samme"*. So it writes the live column, bypasses the draft entirely, and offers
--      ~10 seconds of Fortryd — exactly as `set_dish_sold_out()` does for a dish.
--   2. **"Kopiér sidste uge"** (decision 4). A draft-seeding operation that reads the
--      currently live row, writes it forward into `draft` under next week's number, and
--      **never publishes and never touches a live column**.
--
-- WHY EACH IS ITS OWN FUNCTION RATHER THAN A PARAMETER ON AN EXISTING ONE
--
-- `set_dish_sold_out()` is not reused, and could not be: it names `public.dishes` in
-- every statement, and `dishes` carries `sold_out_changed_at` / `sold_out_changed_by`
-- attribution columns that `weekly_special` does not have (§4's table lists them for
-- one table and not the other). A function that took a table name would be a function
-- that could be pointed at a table nobody reviewed. Two tables, two functions, each one
-- readable on its own.
--
-- WHAT `set_weekly_special_sold_out()` GUARANTEES
--
--   1. **One transaction.** The column write and the audit row commit together or not
--      at all.
--   2. **Exactly one column moves, and it is named in the text.** The two targets are
--      two explicit UPDATE statements, not one dynamic statement with a column name in
--      a variable. A caller cannot reach a price, a name, `draft`, `iso_week` or the
--      *other* sold-out column, because no statement here mentions them.
--   3. **The actor comes from the JWT.** `public.log_audit()` stamps `actor_id` itself;
--      it is not a parameter, so attribution cannot be forged.
--   4. **The date is today's, in Copenhagen, or nothing.** Verified here, before the
--      row is even read, so a malformed request cannot learn anything about the row.
--   5. **Optimistic concurrency (§6, §7e item 2).** The version the screen was rendered
--      from is part of the UPDATE's WHERE clause.
--
-- WHAT `copy_weekly_special_to_draft()` GUARANTEES
--
--   1. **The server decides what is copied.** The function reads the live row itself.
--      No document, no field list and no value crosses the wire from a browser — the
--      only parameters are the destination week, the version token and an explicit
--      confirmation flag.
--   2. **It cannot publish.** The UPDATE names `draft` and nothing else. There is no
--      statement in this function that writes `name`, `price_small_ore`, `sat_enabled`
--      or any other live column, so "the public site is unchanged by a copy" is a
--      property of the text rather than of a test.
--   3. **It cannot carry operational or attribution state forward.** The draft is built
--      from `public.weekly_special_content()` — the same function that describes a
--      publish and an audit entry — which names the thirteen content columns and
--      **neither `sold_out_on` nor `sat_sold_out_on`**, and no timestamp, no
--      `updated_by` and no `id`. There is nowhere for those to come from.
--   4. **It refuses to overwrite silently.** A row that already carries a draft answers
--      `needs_confirmation` until the caller passes `p_confirm := true`, which is what
--      1ag's confirmation puts in front of a person.
--   5. **It refuses to produce a blank draft.** A live row with nothing a guest could
--      read answers `nothing_to_copy`, which is what disables the button (§6).
--
-- SECURITY INVOKER throughout, like every function phase 4 added: RLS re-decides
-- `is_staff()` against the caller's own JWT, so the application's guard is not the only
-- gate (§5, §8). Both Staff and Owner may do all of this — §5's matrix says so in two
-- rows, "Ugens ret, incl. 'Kopiér sidste uge'" and "Lørdagsmenu" — and
-- `weekly_special_update_staff` is the policy that enforces it.
--
-- NOTHING IS SCHEDULED. A copied week sits as a draft until a person presses
-- Offentliggør (§6), and a sold-out marking clears itself on read through
-- `resolveSoldOut()` (§7b). No job, no cron, no `sold_out_expires_at`.


-- ===========================================================================
-- 1. The audited shape of the weekly special's availability
-- ===========================================================================
--
-- `weekly_special_content()` from phase 4 describes what a *publish* changes. This is
-- the immediate path's equivalent, and it is deliberately two fields wide: an audit
-- entry for an availability change should record availability, so that reading the log
-- makes it obvious the operation cannot have moved anything else. Both fields appear in
-- both directions, so the entry also records which of the two cards was left alone.

create or replace function public.weekly_special_availability(w public.weekly_special)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'sold_out_on',     w.sold_out_on,
    'sat_sold_out_on', w.sat_sold_out_on)
$fn$;

comment on function public.weekly_special_availability(public.weekly_special) is
  'The two immediate-path columns, for the audit entry an availability change writes (§6, §7b).';


-- ===========================================================================
-- 2. set_weekly_special_sold_out — the immediate availability transaction (§6, §7b)
-- ===========================================================================
--
-- Returns the same jsonb vocabulary the publish functions and `set_dish_sold_out()` use,
-- so the application maps one shape rather than three:
--
--   status = 'updated'      the row changed; `before`/`after` carry the pair
--          | 'unchanged'    it already held that value; nothing was written or logged
--          | 'not_found'    no row, or RLS hides it
--          | 'conflict'     the row moved on since the screen was rendered (§6)
--          | 'forbidden'    RLS refused the write
--          | 'invalid_date' the date was neither NULL nor today in Copenhagen
--          | 'invalid_target' the target was neither 'week' nor 'saturday'
--
-- `p_target` selects between two written-out statements. It is checked against a
-- two-value list first, so it can never be anything else by the time either statement
-- is reached — and neither statement contains an identifier built from it.

create or replace function public.set_weekly_special_sold_out(
  p_target              text,
  p_sold_out_on         date,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.weekly_special%rowtype;
  v_today  date := (now() at time zone 'Europe/Copenhagen')::date;
  v_before jsonb;
  v_after  jsonb;
  v_same   boolean;
begin
  if p_target is null or p_target not in ('week', 'saturday') then
    return jsonb_build_object('status', 'invalid_target');
  end if;

  -- Stated before anything is read, so a malformed request cannot even learn whether
  -- the row exists.
  if p_sold_out_on is not null and p_sold_out_on <> v_today then
    return jsonb_build_object('status', 'invalid_date', 'today', v_today);
  end if;

  select * into v_row from public.weekly_special t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_same := case p_target
              when 'week'     then v_row.sold_out_on     is not distinct from p_sold_out_on
              else                 v_row.sat_sold_out_on is not distinct from p_sold_out_on
            end;

  if v_same then
    return jsonb_build_object(
      'status', 'unchanged', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
      'before', public.weekly_special_availability(v_row),
      'after',  public.weekly_special_availability(v_row));
  end if;

  v_before := public.weekly_special_availability(v_row);

  -- Two statements, each naming one column. The version check is repeated inside the
  -- statement, so the decision to write and the write itself cannot come apart.
  if p_target = 'week' then
    update public.weekly_special t
       set sold_out_on = p_sold_out_on
     where t.id = v_row.id
       and t.updated_at = p_expected_updated_at
    returning * into v_row;
  else
    update public.weekly_special t
       set sat_sold_out_on = p_sold_out_on
     where t.id = v_row.id
       and t.updated_at = p_expected_updated_at
    returning * into v_row;
  end if;

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
    if exists (select 1 from public.weekly_special t
                where t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.weekly_special_availability(v_row);
  perform public.log_audit('availability', 'weekly_special', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'updated', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.set_weekly_special_sold_out(text, date, timestamptz) is
  'Immediate Udsolgt/Tilgaengelig for Ugens ret or Loerdagsmenu: one named column plus the audit row, one transaction. No draft (§6, §7b).';


-- ===========================================================================
-- 3. copy_weekly_special_to_draft — "Kopiér sidste uge" (§6, decision 4)
-- ===========================================================================
--
--   status = 'copied'               the draft was seeded; `after` carries it
--          | 'needs_confirmation'   a draft already exists and p_confirm was not true
--          | 'nothing_to_copy'      the live row holds nothing a guest could read
--          | 'invalid_week'         the destination week is outside the column CHECKs
--          | 'not_found'            no row, or RLS hides it
--          | 'conflict'             the row moved on since the screen was rendered (§6)
--          | 'forbidden'            RLS refused the write
--
-- There is no `published` status, and no branch of this function can produce one. That
-- is the point: §6 says a copied week "stays a draft until a person presses
-- Offentliggør", and the only column this function writes is `draft`.

create or replace function public.copy_weekly_special_to_draft(
  p_iso_year            integer,
  p_iso_week            integer,
  p_expected_updated_at timestamptz,
  p_confirm             boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row      public.weekly_special%rowtype;
  v_draft    jsonb;
  v_previous jsonb;
begin
  -- The same bounds the column CHECKs state. Checked here because the copy writes into
  -- `draft jsonb`, which no CHECK can see inside — the constraint would only fire later,
  -- at publish, on somebody else's press of a button.
  if p_iso_year is null or p_iso_year not between 2000 and 2999
     or p_iso_week is null or p_iso_week not between 1 and 53 then
    return jsonb_build_object('status', 'invalid_week');
  end if;

  select * into v_row from public.weekly_special t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  -- "Sidste uge" is what is live right now (§6). A row a guest reads nothing off would
  -- copy forward into a blank draft, which is the form the button exists to skip.
  if v_row.name is null and not (v_row.sat_enabled and v_row.sat_name is not null) then
    return jsonb_build_object('status', 'nothing_to_copy');
  end if;

  if v_row.draft is not null and p_confirm is not true then
    return jsonb_build_object('status', 'needs_confirmation');
  end if;

  -- Captured before the write, because `v_row` is about to be replaced by the UPDATE's
  -- RETURNING and would otherwise report the new draft as the old one.
  v_previous := v_row.draft;

  -- The whole of the transformation, and the whole of the reason it cannot carry
  -- anything it should not: `weekly_special_content()` names the thirteen content
  -- columns and nothing else — no `sold_out_on`, no `sat_sold_out_on`, no `updated_by`,
  -- no timestamp and no `id`. The destination week then replaces the source's.
  v_draft := public.weekly_special_content(v_row)
             || jsonb_build_object('iso_year', p_iso_year, 'iso_week', p_iso_week);

  -- One column. A copy that could reach a live column would be a publish wearing
  -- another name.
  update public.weekly_special t
     set draft = v_draft
   where t.id = v_row.id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  if not found then
    if exists (select 1 from public.weekly_special t
                where t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  -- §6 item 4: the operation writes an audit row. `before` is the draft that was
  -- replaced — null when there was none — so the log records what a confirmation
  -- actually cost, which is the one thing a person might want back.
  perform public.log_audit(
    'copy_previous_week', 'weekly_special', v_row.id,
    jsonb_build_object('draft', v_previous),
    jsonb_build_object('draft', v_draft));

  return jsonb_build_object(
    'status', 'copied', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'after', v_draft);
end;
$fn$;

comment on function public.copy_weekly_special_to_draft(integer, integer, timestamptz, boolean) is
  'Seeds weekly_special.draft from the live row under a new ISO week. Writes no live column and never publishes (§6, decision 4).';


-- ===========================================================================
-- 4. Privileges
-- ===========================================================================
--
-- `authenticated` only, exactly as phase 4 and phase 5C granted theirs. `anon` is
-- revoked explicitly rather than left to the default, so the grant is readable as an
-- intention rather than inferred from an absence.

revoke all on function public.weekly_special_availability(public.weekly_special) from public, anon;
revoke all on function public.set_weekly_special_sold_out(text, date, timestamptz) from public, anon;
revoke all on function public.copy_weekly_special_to_draft(integer, integer, timestamptz, boolean)
  from public, anon;

grant execute on function public.weekly_special_availability(public.weekly_special) to authenticated;
grant execute on function public.set_weekly_special_sold_out(text, date, timestamptz) to authenticated;
grant execute on function public.copy_weekly_special_to_draft(integer, integer, timestamptz, boolean)
  to authenticated;
