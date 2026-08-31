-- ===========================================================================
-- Phase 8C-1 — replacing the published announcement, and putting the previous
-- one back (§4, §6, §7e item 8, §8; design 1ae)
--
-- §6's immediate-path table has a third announcement row, and it is the only one
-- phase 7 left unbuilt:
--
--     "Replace an existing announcement — writes new values, stashes the old in
--      `previous jsonb` — 10 s Fortryd restores from `previous`."
--
-- 1ae is the screen it exists for: *"Der vises allerede en besked på hjemmesiden.
-- Der kan kun vises én besked ad gangen. Vælg, hvilken gæsterne skal se."* with
-- "Behold eksisterende besked" beside "Erstat med den nye besked", and beneath
-- them the frame's own account of what follows the second one: *"Den nye besked
-- går live, den gamle fjernes. Grøn besked med Fortryd i 10 sekunder sætter den
-- gamle tilbage."*
--
-- THIS MIGRATION IS THE MECHANISM AND NOTHING ELSE.
--
-- FOUR FUNCTIONS. NO TABLE, NO VIEW, NO TRIGGER, NO INDEX, NO POLICY, NO NEW
-- COLUMN AND NO NEW GRANT ON ANY TABLE.
--
-- `public.announcement` has carried `previous jsonb` and `replaced_at timestamptz`
-- since `20260829120000_initial_schema.sql`, written by nothing through the whole
-- of phases 1–8B. This migration is what gives them their purpose, and it is the
-- first statement anywhere in this repository that names either column.
--
-- WHAT IT DELIBERATELY DOES NOT CONTAIN
--
--   * **No generated opening-hours content.** Nothing here composes a message from
--     a date, a weekday or a pair of times, and nothing here reads
--     `public.opening_hours` or `public.opening_hours_overrides`. `source` is a
--     parameter drawn from a closed vocabulary, and every value it may take was
--     already legal in the table's own `announcement_source_check`. Generating the
--     message is **8C-2**.
--   * **No conflict sheet, and no decision about whether to ask.** 1ae is 8C-3.
--     What is provided here is enough result information for that screen to be
--     written — see `replaced` in the reply — and no screen at all.
--   * **No history.** One snapshot, one level, no array, no stack, no table. §4
--     lists an announcement history table among the tables deliberately not
--     created, and 1ad says why: *"intet arkiv, ingen kladdeliste, ingen historik
--     — én besked ad gangen"*. A second replacement overwrites the first
--     snapshot; `audit_log` is the historical record.
--   * **No draft path.** Neither UPDATE below names `draft`. A pending manual
--     announcement is byte-identical before a replacement, after it, and after the
--     restore. Nothing in the technical plan says a replacement supersedes a
--     draft, so the default safety rule holds: replacement operates on published
--     content only.
--   * **No generic content-replacement framework.** These functions take no table
--     name, no column name and no row locator — the singleton locates itself, for
--     the reason §0e answer A records for the three sold-out functions and §0h
--     answer B repeats for the visibility one.
--   * **No second visibility path.** `set_announcement_visible()` is untouched.
--     Replacement is not "visibility with content attached", and the two functions
--     share no statement.
--
-- WHAT IT GUARANTEES, in the five terms every write function here states
--
--   1. **One transaction.** Reading the current announcement, storing its
--      snapshot, writing the replacement, stamping `replaced_at` and writing the
--      audit row commit together or not at all. There is no intermediate state in
--      which the old message is gone but the replacement failed, in which the
--      replacement is live but `previous` was not stored, or in which the log says
--      "replaced" and the row does not.
--   2. **Only the published columns move.** `message`, the four link columns,
--      `expires_at`, `source`, `is_visible`, `previous` and `replaced_at`. Not
--      `draft`, not `id`, not `created_at`, not `is_singleton`.
--   3. **The actor comes from the JWT.** `updated_by` is stamped by the table's own
--      `announcement_touch` trigger from `auth.uid()`, and the audit row is written
--      through `public.log_audit()`, which takes the actor from the JWT too (§8).
--      Neither is a parameter of either function, so attribution cannot be forged.
--   4. **Optimistic concurrency (§6, §7e item 2).** The version the screen was
--      rendered from is re-checked inside the UPDATE, so a colleague's change is a
--      conflict rather than a silent overwrite — and a conflict writes no audit
--      row, because the statement never runs.
--   5. **SECURITY INVOKER**, with `set search_path = ''`, like every other write
--      function here: RLS re-decides `is_staff()` against the caller's own JWT, so
--      the application's guard is not the only gate (§5, §8). Both Staff and Owner
--      may do this — the announcement is in both rows of §5's matrix, and
--      `announcement_update_staff` is the policy that says so.
--
-- THE BROWSER SUPPLIES NO FIELDS AND NO SNAPSHOT
--
-- `replace_announcement` takes **typed scalar parameters**, not a jsonb document.
-- There is no key a caller could add, no column name it could name and no shape it
-- could smuggle: the eight things a replacement may set are eight arguments, and
-- `is_visible` is not among them because a replacement is always made public
-- (1ae: *"Den nye besked går live"*). `source` is checked against the same closed
-- vocabulary the table's CHECK carries.
--
-- `restore_announcement` takes **one argument**: the version token. The snapshot it
-- restores is read from the row's own `previous` column — the browser never sends
-- the previous message back, and could not, because there is no parameter for it.
--
-- THE SNAPSHOT IS VALIDATED IN BOTH DIRECTIONS
--
-- `is_valid_announcement_snapshot()` is checked before a snapshot is stored and
-- again before one is restored. The first is belt-and-braces — the snapshot is
-- built from the row's own columns, all of which the table's CHECKs already
-- constrain — and the second is the real one: a `previous` written by anything
-- other than this function is refused with `invalid_snapshot`, and the malformed
-- value is left in place rather than quietly dropped.
--
-- WHAT A RESTORE DOES *NOT* DO — and this is a rule, not an omission
--
-- **It does not extend `expires_at`.** If the previous announcement's expiry passed
-- during the ten seconds Fortryd was on offer, restoring it puts back a row whose
-- expiry is in the past, which `announcement_select_public` goes on filtering out.
-- That is the faithful restore of the previous state, and the reply says so
-- (`showable`) so the administration can tell somebody what actually happened.
-- Silently moving a deadline to make an undo look successful would be the
-- administration deciding what somebody meant.
--
-- That is the one place restore and `set_announcement_visible` deliberately part
-- company. The visibility function **refuses** to switch an expired bar on
-- (`not_showable`), because there the request *is* "show this now" and the honest
-- answer is no. Here the request is "put back what was there", the previous state
-- is a fact rather than an intention, and refusing it would leave the replacement
-- live with no way back.
-- ===========================================================================


-- ===========================================================================
-- 1. announcement_snapshot — what `previous` holds, stated once
-- ===========================================================================
--
-- The published content and state of an announcement, and **only** that.
--
-- `announcement_content()` (phase 4) is the audited shape of a *publish* and stops
-- at the six editable fields. A restore has to put back two more — whether the
-- message was being shown, and where it came from — because those are part of the
-- state being replaced and a restore that lost them would not be a restore.
--
-- Eight keys, always present, never any others:
--
--     message, link_type, link_page, link_url, link_label, expires_at,
--     is_visible, source
--
-- WHAT IS DELIBERATELY ABSENT, AND WHY EACH ONE
--
--   * `draft`       — a draft is not published content. Stashing one would let a
--                     restore publish something nobody pressed Offentliggør for.
--   * `previous`    — a snapshot inside a snapshot is a history stack with extra
--                     steps. One level only (§4, 1ad).
--   * `replaced_at` — a fact about the replacement, not about the announcement
--                     being replaced. Restoring it would restore the wrong clock.
--   * `updated_at`  — the concurrency token. It belongs to the row as it is now,
--                     and writing an old one back would corrupt §6's whole model.
--   * `updated_by`  — an actor id. Attribution comes from the JWT of whoever acts
--                     (§8); a stored actor is an actor a caller could choose.
--   * `id`, `created_at`, `is_singleton` — identity, not content. There is one row
--                     and it is not being recreated.
--
-- A timestamptz becomes an ISO-8601 string in jsonb, which is what the restore
-- casts back and what the application's own schema parses.

create or replace function public.announcement_snapshot(a public.announcement)
returns jsonb language sql stable security invoker set search_path = ''
as $fn$
  select jsonb_build_object(
    'message',    a.message,
    'link_type',  a.link_type,
    'link_page',  a.link_page,
    'link_url',   a.link_url,
    'link_label', a.link_label,
    'expires_at', a.expires_at,
    'is_visible', a.is_visible,
    'source',     a.source)
$fn$;

comment on function public.announcement_snapshot(public.announcement) is
  'The published content and state of the announcement, as the previous-snapshot shape and as the replace/restore audit pair (technical plan section 6). Eight keys, no draft, no nested previous, no actor and no concurrency token.';


-- ===========================================================================
-- 2. is_valid_announcement_snapshot — the same shape, read the other way
-- ===========================================================================
--
-- Strict, in the sense the schema layer uses the word: exactly those eight keys,
-- each of the right type, and the same rules the columns themselves carry — the
-- 90-character message, the three link types, the six approved routes, the
-- https-only address, the link shape the three CHECKs agree on, and the two
-- allowed sources.
--
-- It is a `boolean` rather than a raising function because both callers want to
-- answer with a *status*: a malformed `previous` must produce a refusal the
-- application can word in Danish, not an exception that rolls back a transaction
-- and tells a person nothing.
--
-- `stable` rather than `immutable`: casting text to `timestamptz` reads the session
-- time zone.

create or replace function public.is_valid_announcement_snapshot(s jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_keys      text[];
  v_link_type text;
  v_message   text;
  v_page      text;
  v_url       text;
  v_ignored   timestamptz;
begin
  if s is null or jsonb_typeof(s) <> 'object' then return false; end if;

  select array_agg(k order by k) into v_keys from jsonb_object_keys(s) k;

  -- Exactly these eight. A missing key and an extra key are the same answer, which
  -- is what makes an arbitrary json object — a draft, a nested previous, a row
  -- someone dumped with `to_jsonb` — unusable here.
  if v_keys is distinct from array[
       'expires_at', 'is_visible', 'link_label', 'link_page',
       'link_type', 'link_url', 'message', 'source']::text[]
  then return false; end if;

  if jsonb_typeof(s -> 'is_visible') <> 'boolean' then return false; end if;
  if jsonb_typeof(s -> 'link_type')  <> 'string'  then return false; end if;
  if jsonb_typeof(s -> 'source')     <> 'string'  then return false; end if;

  if jsonb_typeof(s -> 'message')    not in ('string', 'null') then return false; end if;
  if jsonb_typeof(s -> 'link_page')  not in ('string', 'null') then return false; end if;
  if jsonb_typeof(s -> 'link_url')   not in ('string', 'null') then return false; end if;
  if jsonb_typeof(s -> 'link_label') not in ('string', 'null') then return false; end if;
  if jsonb_typeof(s -> 'expires_at') not in ('string', 'null') then return false; end if;

  v_message   := s ->> 'message';
  v_link_type := s ->> 'link_type';
  v_page      := s ->> 'link_page';
  v_url       := s ->> 'link_url';

  if v_message is not null and length(v_message) > 90 then return false; end if;
  if v_link_type not in ('none', 'page', 'url') then return false; end if;
  if (s ->> 'source') not in ('manual', 'opening_hours') then return false; end if;

  -- The three link CHECKs, restated. A snapshot that could not be written back
  -- into the columns is not a snapshot this system produced.
  if not (
       (v_link_type = 'none' and v_page is null and v_url is null)
    or (v_link_type = 'page' and v_page is not null and v_url is null)
    or (v_link_type = 'url'  and v_url  is not null and v_page is null))
  then return false; end if;

  if v_page is not null
     and v_page not in ('/', '/menu', '/mad-ud-af-huset', '/om-os', '/nyheder', '/find-os')
  then return false; end if;

  if v_url is not null and v_url !~ '^https://[^\s]+$' then return false; end if;

  if s ->> 'expires_at' is not null then
    begin
      v_ignored := (s ->> 'expires_at')::timestamptz;
    exception when others then
      return false;
    end;
  end if;

  return true;
end;
$fn$;

comment on function public.is_valid_announcement_snapshot(jsonb) is
  'True when a jsonb value is exactly an announcement snapshot: the eight keys announcement_snapshot() writes, each of the right type, and the same rules the columns CHECK. Asked before a snapshot is stored and again before one is restored.';


-- ===========================================================================
-- 3. replace_announcement — 1ae's "Erstat med den nye besked"
-- ===========================================================================
--
-- The status vocabulary, in the same shape the publish, sold-out and visibility
-- functions use, so the application maps one kind of reply rather than several:
--
--   status = 'replaced'        the replacement is live; `before`/`after` carry the
--                              snapshot pair, and `replaced` says what it displaced
--          | 'invalid_payload' nothing was written; `reason` names the rule
--          | 'not_found'       no row, or RLS hides it
--          | 'conflict'        the row moved on since the screen was rendered (§6)
--          | 'forbidden'       RLS refused the write
--          | 'invalid_snapshot' the current row could not be snapshotted at all
--
-- `replaced` IS THE ANSWER 8C-3 NEEDS AND 8C-1 DOES NOT ACT ON (§8 of the brief)
--
--   'active'  — a message a guest can read right now was displaced. This is the
--               only case 1ae's sheet exists for.
--   'hidden'  — a valid, unexpired message that was switched off. It is still the
--               thing being replaced, so it is snapshotted **with its own
--               `is_visible = false`**, and a restore puts it back switched off.
--   'expired' — a message whose expiry has passed. No guest could see it, so it is
--               not a public conflict; it is snapshotted faithfully all the same.
--   'none'    — there was no message at all. Replacing "nothing" is allowed and is
--               not pretended to be a conflict; the snapshot records the empty
--               state, so Fortryd can put the emptiness back.
--
-- This function decides none of that — it reports it. Whether a sheet is shown, and
-- which of 1ae's two buttons is offered, is 8C-3's.
--
-- `is_visible` IS NOT A PARAMETER
--
-- 1ae: *"Den nye besked går live."* A replacement that did not go live would leave
-- the hjemmeside showing neither message, which is not one of the two outcomes the
-- frame draws. So the column is set to `true` by this function, exactly as
-- `publish_announcement()` sets it, and there is no argument by which a caller
-- could ask for anything else.

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
begin
  -- The payload is judged before anything is read, so a request carrying a
  -- replacement this system would not accept cannot even learn whether an
  -- announcement exists. These are 1ac's standing rules — "Kort besked",
  -- "**Udløb er påkrævet**", the link rule of §8 — applied to a replacement rather
  -- than to a merge, and they are the same rules `publish_announcement()` applies
  -- in the same order.
  if p_message is null or btrim(p_message) = '' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'message');
  end if;

  if length(p_message) > 90 then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'message_length');
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'expires_at');
  end if;

  -- The closed source vocabulary is the table's own CHECK, restated here so a
  -- refusal is a status rather than a constraint violation. Phase 7 left
  -- 'opening_hours' deliberately unused; this is the function that may write it,
  -- and it may write it only because a *server-side* caller passed it.
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

  -- An external address has no name of its own, so `resolveAnnouncementLink()`
  -- renders no anchor at all without one. A replacement that silently dropped its
  -- link would be a replacement nobody could tell had gone wrong.
  if p_link_type = 'url' and (p_link_label is null or btrim(p_link_label) = '') then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'link_label');
  end if;

  -- The singleton locates itself (§4). There is deliberately no id parameter.
  select * into v_row from public.announcement t limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  v_id := v_row.id;

  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  -- What is about to be displaced, decided from the row the *server* read — never
  -- from anything the caller claimed was there.
  v_replaced := case
    when v_row.message is null or btrim(v_row.message) = ''            then 'none'
    when v_row.expires_at is null or v_row.expires_at <= now()         then 'expired'
    when not v_row.is_visible                                          then 'hidden'
    else 'active'
  end;

  v_previous := public.announcement_snapshot(v_row);

  -- Belt and braces: the snapshot is built from columns the table's own CHECKs
  -- constrain, so this cannot fail. It is stated anyway, because a `previous` the
  -- restore would refuse is a replacement with no way back, and that must be
  -- impossible rather than merely unlikely.
  if not public.is_valid_announcement_snapshot(v_previous) then
    return jsonb_build_object('status', 'invalid_snapshot');
  end if;

  -- Ten columns, named. `draft` is not one of them, so a pending manual
  -- announcement survives a replacement byte for byte. Neither is `id`,
  -- `created_at` nor `is_singleton`. The version check is repeated inside the
  -- statement, so the decision to write and the write itself cannot come apart.
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

  if not found then
    -- The pre-check passed, so either RLS refused the write or another session got
    -- there first. The probe tells them apart, so the person is told which happened.
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
  'Replaces the published announcement with another already-validated one, stashes the current published state in previous, stamps replaced_at, makes the replacement visible and audits it - one transaction (design 1ae, technical plan section 6). Takes typed scalars, never a json document; never touches draft; keeps exactly one level of previous.';


-- ===========================================================================
-- 4. restore_announcement — the ~10 s Fortryd behind 1ae
-- ===========================================================================
--
-- 1ae: *"Grøn besked med **Fortryd** i 10 sekunder sætter den gamle tilbage."*
--
-- §6: *"Undo is not server-held state. The change is already live; undo is simply a
-- second authorized write."* The ten seconds are a message's lifetime, not a
-- permission window: this call is guarded, validated, concurrency-checked and
-- audited on exactly the same terms as the replacement was, whether it arrives at
-- second one or from a stale tab an hour later.
--
-- The one thing that *is* server-held is the previous announcement itself, and that
-- is the whole point of `previous jsonb`: the browser does not send the old message
-- back, and there is no parameter by which it could. A caller says only "put back
-- what you stashed, as of this version".
--
--   status = 'restored'          the previous announcement is back; `showable` says
--                                whether a guest can actually read it
--          | 'nothing_to_restore' `previous` is null — nothing was replaced, or a
--                                restore already happened. Nothing written, nothing
--                                logged.
--          | 'invalid_snapshot'  `previous` is not a snapshot this system wrote. The
--                                value is **left in place**; nothing is written and
--                                nothing is logged.
--          | 'not_found' | 'conflict' | 'forbidden' — as everywhere else.
--
-- `previous` and `replaced_at` are cleared in the same statement that restores the
-- content, so "there is something to undo" and "the undo has happened" are one fact
-- in one row rather than two that could disagree. A second Fortryd is
-- `nothing_to_restore`, which is a refusal rather than a second restore — one level,
-- no stack.

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
    -- Refused safely: no write, no audit row, and the malformed value is not
    -- discarded. Whatever put it there is a bug worth being able to look at, and a
    -- restore is not the place to tidy away evidence.
    return jsonb_build_object('status', 'invalid_snapshot');
  end if;

  v_before := public.announcement_snapshot(v_row);

  -- The snapshot's own content, link, expiry, visibility and source — exactly as it
  -- was stored. **Nothing here consults `now()`**: an expiry that passed while
  -- Fortryd was on offer is restored as it stands, and the reply says whether the
  -- result is one a guest can read. `draft` is not named, so a pending manual
  -- announcement is byte-identical after this too.
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

  if not found then
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
    -- The anonymous policy's own three conditions, so the administration can say
    -- what actually happened rather than assume a restore is always visible.
    'showable',   (v_row.is_visible
                   and v_row.message is not null
                   and v_row.expires_at is not null
                   and v_row.expires_at > now()),
    'before',     v_before,
    'after',      v_after);
end;
$fn$;

comment on function public.restore_announcement(timestamptz) is
  'Puts back the announcement stashed in previous, clears previous and replaced_at, and audits it - one transaction (design 1ae, technical plan section 6). Reads the snapshot from the database; the browser sends no content. Never extends an expiry to make itself succeed, and never touches draft.';


-- ===========================================================================
-- 5. Privileges
-- ===========================================================================
--
-- `authenticated` only, exactly as phases 4, 5C, 6A, 6B, 7A and 7B granted theirs.
-- `anon` is revoked explicitly rather than left to the default, so the grant reads
-- as an intention rather than as an absence. An anonymous caller therefore meets
-- `42501` at the function, before RLS is ever consulted.

revoke all on function public.announcement_snapshot(public.announcement)         from public, anon;
revoke all on function public.is_valid_announcement_snapshot(jsonb)              from public, anon;
revoke all on function public.replace_announcement(text, text, text, text, text, timestamptz, text, timestamptz) from public, anon;
revoke all on function public.restore_announcement(timestamptz)                  from public, anon;

grant execute on function public.announcement_snapshot(public.announcement)      to authenticated;
grant execute on function public.is_valid_announcement_snapshot(jsonb)           to authenticated;
grant execute on function public.replace_announcement(text, text, text, text, text, timestamptz, text, timestamptz) to authenticated;
grant execute on function public.restore_announcement(timestamptz)               to authenticated;
