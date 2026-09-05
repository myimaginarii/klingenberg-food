-- Klingenberg Food — phase 13B closure: the sign-in reservation.
--
-- Technical plan section 8 ("Credential stuffing"), section 0ai (the closure pass).
--
-- WHAT WAS WRONG
--
-- Phase 13B's sign-in path asked `peek_rate_limit()` for both client-keyed counters
-- BEFORE the Auth server was contacted and called `consume_rate_limit()` only when
-- the Auth server refused — so that a successful sign-in never counted. The gap
-- between the two calls is the whole duration of an Auth request (a bcrypt check;
-- tens of milliseconds at least). Every attempt that arrives inside that gap reads
-- the OLD count: with one allowance left, eight simultaneous wrong passwords all
-- passed the peek, all eight reached the Auth server, and the bucket ended at
-- seventeen. Measured on 2026-09-05 against the local stack; the threshold was a
-- promise the two-step shape could not keep under concurrency.
--
-- WHAT THIS MIGRATION ADDS
--
--   * `reserve_sign_in_attempt(client, account)` — ONE statement's worth of
--     decision under the row locks: both buckets of the current window are locked
--     in a fixed order, both counts are read under those locks, and either BOTH are
--     incremented (allowed) or NEITHER is (limited). A caller that is limited holds
--     no reservation and has moved nothing — so a run refused per client cannot
--     also push the account backstop towards a lock-out, which is exactly what the
--     peek preserved and a naive consume-first would have lost. Concurrent callers
--     serialise on the per-client row: once the tier's last allowance is reserved,
--     every later caller — however simultaneous — reads the reserved count and is
--     refused before any Auth request is made.
--
--   * `release_sign_in_attempt(client, account)` — the refund for an attempt that
--     turned out NOT to be a failure: a sign-in the Auth server accepted, or one it
--     could not answer at all (an outage). Each of the two buckets is lowered by
--     exactly one, never below zero, in the same lock order. It is not a reset: it
--     cannot erase another attempt's failure (one call, one hit), it cannot be told
--     a count, and it accepts only the two sign-in scopes, which are named inside
--     the function rather than by the caller.
--
-- The generic doors of migration `20260905120000` are untouched: every signed-in
-- Server Action still counts through `consume_rate_limit()`, the password-reset
-- request still consumes before it sends, and `peek_rate_limit()` remains as the
-- read door. Only the sign-in path changes what it calls.
--
-- SECURITY DEFINER, AND WHY (brief §13)
--
-- Both functions move rows the browser roles cannot touch, so they are definer
-- functions with this repository's guards: `search_path` pinned to nothing, no
-- identifier interpolated, EXECUTE revoked from PUBLIC. They are granted to `anon`
-- ONLY — the sign-in path has no session by definition, and `rate_limit_resolve()`
-- refuses a client-keyed subject from any caller that has one. What a caller can do
-- through PostgREST is what the application does: reserve or release ONE attempt
-- for a subject it can name — and a subject is an HMAC under the server-side secret
-- (`lib/rate-limit/subject.ts`), which is why that secret is now required on a
-- hosted deployment (`lib/env/server.ts`): nobody outside the server can compute
-- anybody's subject, their own included. The service role is not involved.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * No new table, no new column, no new scope: the two functions read the tiers
--     of `auth:signin` and `auth:signin-account` from `rate_limit_scopes` as before.
--   * No grant to `authenticated`: a caller with a session has no sign-in attempt
--     to reserve.
--   * No generic decrement: the release names its two scopes itself, lowers by one,
--     and stops at zero.


-- ---------------------------------------------------------------------------
-- 1. reserve_sign_in_attempt() — both counters, all or nothing, under the locks
-- ---------------------------------------------------------------------------

create or replace function public.reserve_sign_in_attempt(
  p_client_subject  text,
  p_account_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c                record;  -- the per-client tier, resolved
  a                record;  -- the per-account tier, resolved
  v_client_window  timestamptz;
  v_account_window timestamptz;
  v_client_hits    integer;
  v_account_hits   integer;
  v_now            timestamptz := pg_catalog.now();
begin
  -- The same grammar as the generic doors: a known scope, no session, a 64-hex key.
  select * into c from public.rate_limit_resolve('auth:signin', p_client_subject);
  select * into a from public.rate_limit_resolve('auth:signin-account', p_account_subject);

  v_client_window := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / c.o_window_seconds) * c.o_window_seconds);
  v_account_window := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / a.o_window_seconds) * a.o_window_seconds);

  -- Both rows exist before they are locked, so that two first callers of a window
  -- meet the same row rather than each inserting its own view of it. A row that
  -- already exists is left exactly as it is.
  insert into public.rate_limit_buckets (scope, subject, window_start, hits)
  values ('auth:signin', c.o_subject, v_client_window, 0)
  on conflict (scope, subject, window_start) do nothing;

  insert into public.rate_limit_buckets (scope, subject, window_start, hits)
  values ('auth:signin-account', a.o_subject, v_account_window, 0)
  on conflict (scope, subject, window_start) do nothing;

  -- The locks, in one fixed order for every caller: the client row, then the
  -- account row. A second caller for the same client waits here until the first
  -- has committed its reservation, and then reads the reserved count.
  select b.hits into v_client_hits
    from public.rate_limit_buckets b
   where b.scope = 'auth:signin' and b.subject = c.o_subject and b.window_start = v_client_window
     for update;

  select b.hits into v_account_hits
    from public.rate_limit_buckets b
   where b.scope = 'auth:signin-account' and b.subject = a.o_subject and b.window_start = v_account_window
     for update;

  -- Limited: NEITHER counter moves. The retry is the client's window when the
  -- client tier is the one that is full, else the account's.
  if v_client_hits >= c.o_max_hits then
    return jsonb_build_object(
      'status', 'limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        (v_client_window + make_interval(secs => c.o_window_seconds) - v_now)))::integer));
  end if;

  if v_account_hits >= a.o_max_hits then
    return jsonb_build_object(
      'status', 'limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        (v_account_window + make_interval(secs => a.o_window_seconds) - v_now)))::integer));
  end if;

  -- Allowed: BOTH counters move, under the locks taken above.
  update public.rate_limit_buckets
     set hits = hits + 1
   where scope = 'auth:signin' and subject = c.o_subject and window_start = v_client_window;

  update public.rate_limit_buckets
     set hits = hits + 1
   where scope = 'auth:signin-account' and subject = a.o_subject and window_start = v_account_window;

  -- A fresh bucket is the moment to forget the old ones — the same rule, the same
  -- horizon, as the generic door.
  if v_client_hits = 0 or v_account_hits = 0 then
    delete from public.rate_limit_buckets
     where window_start < v_now - interval '2 hours';
  end if;

  return jsonb_build_object(
    'status', 'allowed',
    'remaining', least(c.o_max_hits - v_client_hits - 1, a.o_max_hits - v_account_hits - 1)
  );
end;
$fn$;

comment on function public.reserve_sign_in_attempt(text, text) is
  'Reserves one sign-in attempt against BOTH client-keyed sign-in counters, all or nothing, under the row locks (phase 13B closure): a limited caller has moved nothing; an allowed caller holds one hit in each bucket until release_sign_in_attempt() or the window''s end.';

revoke all on function public.reserve_sign_in_attempt(text, text) from public, authenticated;
grant execute on function public.reserve_sign_in_attempt(text, text) to anon;


-- ---------------------------------------------------------------------------
-- 2. release_sign_in_attempt() — one reservation back, never below zero
-- ---------------------------------------------------------------------------

create or replace function public.release_sign_in_attempt(
  p_client_subject  text,
  p_account_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c                record;
  a                record;
  v_client_window  timestamptz;
  v_account_window timestamptz;
  v_released       integer := 0;
  v_now            timestamptz := pg_catalog.now();
begin
  select * into c from public.rate_limit_resolve('auth:signin', p_client_subject);
  select * into a from public.rate_limit_resolve('auth:signin-account', p_account_subject);

  v_client_window := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / c.o_window_seconds) * c.o_window_seconds);
  v_account_window := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / a.o_window_seconds) * a.o_window_seconds);

  -- One hit back from each bucket of the CURRENT window, and only where there is
  -- one to give back: a bucket at zero, or a window that has ended since the
  -- reservation, stays as it is (the check constraint would refuse a negative
  -- count anyway). Same lock order as the reservation.
  update public.rate_limit_buckets
     set hits = hits - 1
   where scope = 'auth:signin' and subject = c.o_subject and window_start = v_client_window
     and hits > 0;
  if found then v_released := v_released + 1; end if;

  update public.rate_limit_buckets
     set hits = hits - 1
   where scope = 'auth:signin-account' and subject = a.o_subject and window_start = v_account_window
     and hits > 0;
  if found then v_released := v_released + 1; end if;

  return jsonb_build_object('released', v_released);
end;
$fn$;

comment on function public.release_sign_in_attempt(text, text) is
  'Gives ONE reserved sign-in attempt back — one hit off each of the two sign-in buckets of the current window, never below zero (phase 13B closure). Called after a sign-in the Auth server accepted or could not answer; never a reset.';

revoke all on function public.release_sign_in_attempt(text, text) from public, authenticated;
grant execute on function public.release_sign_in_attempt(text, text) to anon;
