-- ===========================================================================
-- Phase 7B — taking the announcement down by hand (§4, §6, §7c, §8)
--
-- Design 1ad draws two controls and one rule beside them:
--
--     "Fjerne → ét tryk. 'Vis besked' fra eller 'Fjern beskeden nu' virker straks —
--      ingen forhåndsvisning, ingen offentliggørelse. En forkert besked skal kunne
--      stoppes med det samme."
--
-- against the other half of the same card:
--
--     "Skrive eller ændre → tre trin. Ret → Forhåndsvis → Offentliggør."
--
-- §6's immediate-path table names the first of those as a write of `is_visible=false`
-- plus a revalidate, with ~10 s of Fortryd. This migration is that write, and nothing
-- else.
--
-- TWO FUNCTIONS. NO TABLE, NO VIEW, NO TRIGGER, NO INDEX, NO POLICY, NO NEW COLUMN.
--
-- `public.announcement` already carries every column, CHECK and RLS policy this needs
-- (`20260829120000_initial_schema.sql`), and `announcement_update_staff` is already the
-- policy that decides who may write it. What was missing is an operation that writes
-- **only** `is_visible`, audits it in the same transaction, and refuses to be pointed
-- at anything else.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT CONTAIN
--
--   * **No replacement of an active announcement.** `previous`, `replaced_at` and the
--     restore-from-`previous` undo are §6's *third* immediate row and belong to phase 8
--     with 1ae's conflict sheet. No statement below names either column, so this
--     operation cannot write one even by accident.
--   * **No generated opening-hours announcement.** `source` stays `'manual'`; it is not
--     named by any statement here.
--   * **No content path.** The UPDATE names one column. A caller cannot extend this
--     operation to the message, either link column, the label, the expiry, the draft or
--     the source, because no statement here mentions them. That is a property of the
--     text rather than of a check somebody has to remember to write.
--   * **No generic "immediate action" function.** This takes no table name, no column
--     name and no entity name — for the reason §0e answer A records for the three
--     sold-out functions: a function that builds an identifier from an argument is a
--     function that can be pointed at a table nobody reviewed.
--
-- WHAT IT GUARANTEES, in the same five terms phase 5C stated for `set_dish_sold_out`
--
--   1. **One transaction.** The column write and the audit row commit together or not
--      at all. PostgREST wraps the call, so there is no path where the bar disappears
--      from the hjemmeside and the log does not say who took it down.
--   2. **Only `is_visible` moves.** One column, named once.
--   3. **The actor comes from the JWT.** `updated_by` is stamped by the table's own
--      `announcement_touch` trigger from `auth.uid()`, and the audit row is written
--      through `public.log_audit()`, which takes the actor from the JWT too (§8).
--      Neither is a parameter, so attribution cannot be forged.
--   4. **Optimistic concurrency (§6, §7e item 2).** The version the screen was rendered
--      from is part of the UPDATE's WHERE clause, so a colleague's change is reported as
--      a conflict rather than silently overwritten — and a conflict writes no audit row,
--      because the whole statement never runs.
--   5. **SECURITY INVOKER**, like every other write function here: RLS re-decides
--      `is_staff()` against the caller's own JWT, so the application's guard is not the
--      only gate (§5, §8). Both Staff and Owner may do this — the announcement is in
--      both rows of §5's matrix — and `announcement_update_staff` is the policy that
--      says so.
--
-- THE UNDO IS THIS SAME FUNCTION, CALLED AGAIN WITH `true`
--
-- §6: *"Undo is not server-held state. The change is already live; undo is simply a
-- second authorized write."* So there is no restore function, no undo token and no
-- server memory of what was undone — Fortryd is `p_visible => true` with the version
-- token the first write returned.
--
-- That direction restores **visibility of the same, unchanged, already-published
-- announcement**. It is not the `previous jsonb` mechanism, it publishes nothing, and it
-- cannot make a pending draft public: the UPDATE does not name `draft`, so a draft
-- written before the hide is still sitting there afterwards, still pending, still
-- invisible to a guest.
-- ===========================================================================


-- ===========================================================================
-- 1. The audited shape of an announcement's visibility
-- ===========================================================================
--
-- `announcement_content()` (phase 4) describes what a *publish* changes. This is the
-- immediate path's equivalent, and it is deliberately one field wide — exactly as
-- `dish_availability()` is for §7b. An audit entry for a visibility change should record
-- visibility, so that reading the log makes it obvious this operation cannot have moved
-- anything else.

create or replace function public.announcement_visibility(a public.announcement)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object('is_visible', a.is_visible)
$fn$;

comment on function public.announcement_visibility(public.announcement) is
  'The one field the immediate announcement path may change, as the audit before/after pair (technical plan section 6).';


-- ===========================================================================
-- 2. set_announcement_visible — the immediate visibility transaction (§6, 1ad)
-- ===========================================================================
--
-- Returns the same jsonb vocabulary the publish and sold-out functions use, so the
-- application maps one shape rather than several:
--
--   status = 'updated'         the bar changed; `before`/`after` carry the pair
--          | 'unchanged'       it already stood that way; nothing written, nothing logged
--          | 'not_found'       no row, or RLS hides it
--          | 'conflict'        the row moved on since the screen was rendered (§6)
--          | 'forbidden'       RLS refused the write
--          | 'not_showable'    asked to show a bar a guest could not be given, with
--                              `reason` = 'message' or 'expires_at'
--          | 'invalid_request' no intent was given at all
--
-- `unchanged` rather than a second identical audit row: pressing "Fjern beskeden nu"
-- twice — two taps on a phone, a double submit, a resubmitted POST — is one decision,
-- and the log should say so. It is still a success from the screen's point of view,
-- because the bar ends in the state that was asked for.
--
-- `not_showable` IS THE ANSWER TO THE ONE HONEST RACE THIS OPERATION HAS
--
-- Fortryd is offered for about ten seconds. An expiry can pass inside those ten seconds.
-- Restoring `is_visible` on a row whose expiry has gone would write `true` into a column
-- that the anonymous RLS policy — `is_visible and message is not null and expires_at is
-- not null and expires_at > now()` — would go on filtering out, and the screen would
-- then report a message put back that no guest can read. So the two standing rules of
-- 1ac ("Kort besked", "**Udløb er påkrævet**") are checked here for the direction that
-- turns a bar **on**, and the refusal is named rather than dressed up as a success.
-- These are the same two rules `publish_announcement` refuses on, in the same order, and
-- for the same reason neither can be a CHECK: "in the future" is not immutable.
--
-- The **off** direction is never refused for either reason. A message that can no longer
-- be shown is exactly the one somebody may still want switched off, and an operation
-- whose whole purpose is "stop this now" must not have a state it declines to stop.
--
-- NOTHING HERE EXTENDS `expires_at`. A restore restores visibility. If the message has
-- expired, the answer is `not_showable`, not a quietly moved deadline — an administration
-- that extended a deadline to make an undo succeed would be deciding what somebody meant.

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
  v_row    public.announcement%rowtype;
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  -- Stated before anything is read, so a request that names no intent cannot even
  -- learn whether an announcement exists.
  if p_visible is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- The singleton locates itself (§4). There is deliberately no id parameter: this
  -- operation has exactly one row it could ever act on, and an argument naming a row is
  -- an argument that can name a different one.
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

  -- One column, named. The version check is repeated inside the statement, so the
  -- decision to write and the write itself cannot come apart. `message`, `link_type`,
  -- `link_page`, `link_url`, `link_label`, `expires_at`, `source`, `previous`,
  -- `replaced_at` and `draft` appear nowhere in it.
  update public.announcement t
     set is_visible = p_visible
   where t.id = v_id
     and t.updated_at = p_expected_updated_at
  returning * into v_row;

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
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
  'Immediate "Vis besked" off / "Fjern beskeden nu", and the second write that Fortryd makes (1ad, technical plan section 6). Writes is_visible and its audit row, one transaction, no draft. Refuses to switch a bar on that a guest could not be given. Never touches previous or replaced_at - replacing an announcement is phase 8.';


-- ===========================================================================
-- 3. Privileges
-- ===========================================================================
--
-- `authenticated` only, exactly as phases 4, 5C, 6A, 6B and 7A granted theirs. `anon` is
-- revoked explicitly rather than left to the default, so the grant is readable as an
-- intention rather than inferred from an absence. An anonymous caller therefore meets
-- `42501` at the function, before RLS is ever consulted.

revoke all on function public.announcement_visibility(public.announcement)     from public, anon;
revoke all on function public.set_announcement_visible(boolean, timestamptz)   from public, anon;

grant execute on function public.announcement_visibility(public.announcement)  to authenticated;
grant execute on function public.set_announcement_visible(boolean, timestamptz) to authenticated;
