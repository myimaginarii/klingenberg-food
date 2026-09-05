-- Klingenberg Food — pgTAP: the sign-in reservation (technical plan §8, §0ai —
-- the phase-13B closure; migration 20260905180000).
--
-- From real anonymous, Staff and Owner JWTs, this suite pins:
--
--   1. privileges — the two doors are EXECUTE for `anon` only (not `authenticated`,
--      not PUBLIC), SECURITY DEFINER with `search_path` pinned to nothing;
--   2. the closed vocabulary — a malformed subject on either side is refused with
--      the errcode the application maps, and a caller with a session is refused;
--   3. threshold, all or nothing — hits up to the per-client tier are allowed with
--      a falling `remaining`, the next is `limited` with a retry inside the window,
--      and a refusal moves NEITHER counter: a run refused per client leaves the
--      account backstop exactly where it was, and a full account backstop refuses
--      without touching a fresh client's bucket;
--   4. release — one hit back from each bucket and no more; a subject never seen
--      gets no row; another subject is untouched; a bucket at zero stays at zero
--      (and the table's check constraint refuses a negative count regardless);
--   5. window reset — an old window's bucket is neither counted nor released;
--   6. growth — the reservation prunes like the generic door;
--   7. concurrency — through two REAL sessions (dblink): with one allowance left,
--      A reserves it inside an open transaction and holds the row lock; B's
--      reservation waits on that lock and, after A commits, is LIMITED — the
--      property the peek/consume shape could not give (run first, because dblink
--      sessions commit for real);
--   8. abuse — no browser role can raise, lower, insert or delete a bucket
--      directly, and a caller with a session cannot reach either door;
--   9. regression — reserving and releasing is not mutating: the content tables and
--      the audit log are byte-identical afterwards.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 002–029.

begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(81);

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);

-- Client subjects: 64 hex characters, as the application derives them. `a`/`b` are
-- the client/account pair of the threshold story, `e` a fresh client, `h` a bystander,
-- `c`/`d` the race pair (committed for real by the dblink sessions).
select set_config('test.subject_a', repeat('ab', 32), true);
select set_config('test.subject_b', repeat('cd', 32), true);
select set_config('test.subject_e', repeat('e1', 32), true);
select set_config('test.subject_h', repeat('0f', 32), true);
select set_config('test.subject_c', repeat('c0', 32), true);
select set_config('test.subject_d', repeat('d0', 32), true);

create function pg_temp.become(uid text, email text)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'email', email)::text, true);
  execute 'set local role authenticated';
end;
$fn$;

create function pg_temp.become_staff() returns void language sql as $fn$
  select pg_temp.become(current_setting('test.staff_uid'), 'staff@example.test');
$fn$;

create function pg_temp.become_anon() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$fn$;

create function pg_temp.become_superuser() returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

/* A snapshot of everything the limiter must not touch. */
create function pg_temp.content_state() returns text language sql as $fn$
  select md5(coalesce(string_agg(t, E'\n' order by t), ''))
  from (
    select 'dish:' || row_to_json(d)::text as t from public.dishes d
    union all select 'news:' || row_to_json(n)::text from public.news n
    union all select 'ann:' || row_to_json(a)::text from public.announcement a
    union all select 'profile:' || row_to_json(p)::text from public.profiles p
    union all select 'audit:' || row_to_json(l)::text from public.audit_log l
  ) s;
$fn$;

select set_config('test.content_before', pg_temp.content_state(), true);

/* The current window of a scope, as the functions compute it. */
create function pg_temp.window_of(p_scope text) returns timestamptz language sql as $fn$
  select to_timestamp(floor(extract(epoch from now()) / s.window_seconds) * s.window_seconds)
    from public.rate_limit_scopes s where s.scope = p_scope;
$fn$;

/* The hits of one bucket in the current window, or -1 when there is no row. */
create function pg_temp.hits_of(p_scope text, p_subject text) returns integer language sql as $fn$
  select coalesce(
    (select b.hits from public.rate_limit_buckets b
      where b.scope = p_scope and b.subject = p_subject and b.window_start = pg_temp.window_of(p_scope)),
    -1);
$fn$;

-- Start from empty counters. This file rolls back, so nothing committed is lost.
delete from public.rate_limit_buckets;


-- ===========================================================================
-- 7. Concurrency — FIRST, because dblink sessions commit for real
-- ===========================================================================
-- The per-client tier is 10. Session X puts the race client at 9 (one allowance
-- left) and commits. A reserves inside an open transaction: allowed, remaining 0,
-- and it holds the client row's lock. B sends its reservation and blocks on that
-- lock. A commits. B's answer must then be LIMITED — under the old peek/consume
-- shape both would have read 9 and both would have gone on to the Auth server.

select set_config('test.conn',
  format('host=%s dbname=postgres user=postgres password=postgres', inet_server_addr()), true);

select lives_ok($$ select extensions.dblink_connect('x', current_setting('test.conn')) $$, 'session X connects');
select lives_ok($$ select extensions.dblink_connect('a', current_setting('test.conn')) $$, 'session A connects');
select lives_ok($$ select extensions.dblink_connect('b', current_setting('test.conn')) $$, 'session B connects');

create function pg_temp.in_session(p_conn text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform extensions.dblink_exec(p_conn, p_sql);
  return '00000';
exception when others then
  return sqlstate;
end;
$fn$;

create function pg_temp.from_session(p_conn text, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  select t.v into v from extensions.dblink(p_conn, p_sql) as t(v text);
  return v;
end;
$fn$;

create function pg_temp.drain(p_conn text) returns void
language plpgsql as $fn$
declare n integer;
begin
  loop
    select count(*) into n from extensions.dblink_get_result(p_conn) as t(v text);
    exit when n = 0;
  end loop;
end;
$fn$;

create function pg_temp.as_anon_sql() returns text language sql as $fn$
  select $q$ select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon; $q$;
$fn$;

create function pg_temp.race_sql(p_fn text) returns text language sql as $fn$
  select format($q$ select (public.%I(%L, %L)) ->> 'status' $q$,
    p_fn, current_setting('test.subject_c'), current_setting('test.subject_d'));
$fn$;

-- X: nothing of an interrupted earlier run may remain for the race pair, and the
-- race client starts with one allowance left.
select is(
  pg_temp.in_session('x', format($q$ delete from public.rate_limit_buckets where subject in (%L, %L) $q$,
    current_setting('test.subject_c'), current_setting('test.subject_d'))),
  '00000',
  'session X starts the race from empty buckets');
select is(
  pg_temp.in_session('x', format($q$
    insert into public.rate_limit_buckets (scope, subject, window_start, hits)
    values ('auth:signin', %L,
      to_timestamp(floor(extract(epoch from now()) / 900) * 900), 9) $q$,
    current_setting('test.subject_c'))),
  '00000',
  'session X puts the race client at nine of ten');

-- A: the last allowance, uncommitted.
select is(pg_temp.in_session('a', 'begin'), '00000', 'A begins');
select is(pg_temp.in_session('a', pg_temp.as_anon_sql()), '00000', 'A is anonymous');
select is(
  pg_temp.from_session('a', format($q$
    select (public.reserve_sign_in_attempt(%L, %L)) ->> 'remaining' $q$,
    current_setting('test.subject_c'), current_setting('test.subject_d'))),
  '0',
  'A reserves the last allowance and holds the client row''s lock');

-- B: sent asynchronously because it will block on A's row.
select is(pg_temp.in_session('b', 'begin'), '00000', 'B begins');
select is(pg_temp.in_session('b', pg_temp.as_anon_sql()), '00000', 'B is anonymous');
select is(
  extensions.dblink_send_query('b', pg_temp.race_sql('reserve_sign_in_attempt')),
  1,
  'B sends its reservation');

select pg_sleep(0.5);
select is(extensions.dblink_is_busy('b'), 1, 'B is blocked on the client row while A holds it');

select is(pg_temp.in_session('a', 'commit'), '00000', 'A commits its reservation');

select is(
  (select v from extensions.dblink_get_result('b') as t(v text)),
  'limited',
  'B is then LIMITED: its decision ran after A''s commit and saw the reserved count');
select pg_temp.drain('b');
select is(pg_temp.in_session('b', 'commit'), '00000', 'B commits');

select is(
  pg_temp.from_session('x', format($q$
    select hits::text from public.rate_limit_buckets where scope = 'auth:signin' and subject = %L $q$,
    current_setting('test.subject_c'))),
  '10',
  'the client bucket holds exactly the tier — B''s refusal added nothing');
select is(
  pg_temp.from_session('x', format($q$
    select hits::text from public.rate_limit_buckets where scope = 'auth:signin-account' and subject = %L $q$,
    current_setting('test.subject_d'))),
  '1',
  'the account bucket holds A''s reservation only — B''s refusal added nothing there either');

-- B, autocommit and anonymous by omission (no JWT), releases A's reservation —
-- the shape of a sign-in the Auth server accepted — and is then allowed once more.
select is(
  pg_temp.from_session('b', format($q$
    select (public.release_sign_in_attempt(%L, %L)) ->> 'released' $q$,
    current_setting('test.subject_c'), current_setting('test.subject_d'))),
  '2',
  'a release gives one hit back from each bucket');
select is(
  pg_temp.from_session('x', format($q$
    select hits::text from public.rate_limit_buckets where scope = 'auth:signin' and subject = %L $q$,
    current_setting('test.subject_c'))),
  '9',
  'the client bucket is back at nine');
select is(pg_temp.from_session('b', pg_temp.race_sql('reserve_sign_in_attempt')), 'allowed',
  'and the allowance can be reserved again');
select is(pg_temp.from_session('b', pg_temp.race_sql('reserve_sign_in_attempt')), 'limited',
  'but only once');

-- Tear down what the sessions committed.
select is(
  pg_temp.in_session('x', format($q$ delete from public.rate_limit_buckets where subject in (%L, %L) $q$,
    current_setting('test.subject_c'), current_setting('test.subject_d'))),
  '00000',
  'session X removes the race buckets');
select is(
  pg_temp.from_session('x', format($q$
    select count(*)::text from public.rate_limit_buckets where subject in (%L, %L) $q$,
    current_setting('test.subject_c'), current_setting('test.subject_d'))),
  '0',
  'nothing of the race survives');

select lives_ok($$ select extensions.dblink_disconnect('a') $$, 'A disconnects');
select lives_ok($$ select extensions.dblink_disconnect('b') $$, 'B disconnects');
select lives_ok($$ select extensions.dblink_disconnect('x') $$, 'X disconnects');


-- ===========================================================================
-- 1. Privileges
-- ===========================================================================

select pg_temp.become_superuser();

select is(
  (select string_agg(grantee, ',' order by grantee)
     from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'reserve_sign_in_attempt'
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'anon',
  'reserve_sign_in_attempt() is EXECUTE for anon only — not authenticated, not PUBLIC');

select is(
  (select string_agg(grantee, ',' order by grantee)
     from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'release_sign_in_attempt'
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'anon',
  'release_sign_in_attempt() is EXECUTE for anon only — not authenticated, not PUBLIC');

select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('reserve_sign_in_attempt', 'release_sign_in_attempt')
      and p.prosecdef
      and 'search_path=""' = any (p.proconfig)),
  2::bigint,
  'both doors are SECURITY DEFINER with search_path pinned to nothing');

select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('reserve_sign_in_attempt', 'release_sign_in_attempt')),
  2::bigint,
  'each door exists exactly once — no overload a caller could pick');


-- ===========================================================================
-- 2. The closed vocabulary, from an anonymous session
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  format($$ select public.reserve_sign_in_attempt('plain-address', %L) $$, current_setting('test.subject_b')),
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: a malformed client subject is refused');

select throws_ok(
  format($$ select public.reserve_sign_in_attempt(%L, 'someone@example.test') $$, current_setting('test.subject_a')),
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: a malformed account subject is refused');

select throws_ok(
  format($$ select public.reserve_sign_in_attempt(%L, null) $$, current_setting('test.subject_a')),
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: a null account subject is refused');

select throws_ok(
  format($$ select public.release_sign_in_attempt('ABCDEF', %L) $$, current_setting('test.subject_b')),
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: the release applies the same grammar');

select pg_temp.become_superuser();
select is(
  (select count(*) from public.rate_limit_buckets),
  0::bigint,
  'a refused call created no bucket');


-- ===========================================================================
-- 3. Threshold, all or nothing
-- ===========================================================================
-- `auth:signin` allows 10 per 900 s, `auth:signin-account` 30 per 900 s.

select pg_temp.become_anon();

select is(
  (select string_agg((r ->> 'status') || ':' || (r ->> 'remaining'), ',' order by i)
     from (select i, public.reserve_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b')) as r
             from generate_series(1, 10) i) s),
  'allowed:9,allowed:8,allowed:7,allowed:6,allowed:5,allowed:4,allowed:3,allowed:2,allowed:1,allowed:0',
  'ten reservations are allowed, remaining counting down the tighter tier to zero');

select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'status',
  'limited',
  'the eleventh is limited');

-- Read once into a setting: BETWEEN evaluates a volatile expression twice.
select set_config('test.retry',
  (public.reserve_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'retry_after_seconds', true);
select ok(
  current_setting('test.retry')::integer between 1 and 900,
  'retry_after_seconds is inside the window');

select is(
  (public.peek_rate_limit('auth:signin', current_setting('test.subject_a'))) ->> 'status',
  'limited',
  'the read door agrees the client is limited');

select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_a')), 10,
  'the client bucket holds exactly the tier: the two refusals added nothing');
select is(pg_temp.hits_of('auth:signin-account', current_setting('test.subject_b')), 10,
  'the account bucket holds the ten reservations and NOT the two refusals — a refused run cannot push the backstop');

-- A full account backstop refuses a fresh client without touching its bucket.
update public.rate_limit_buckets set hits = 30
 where scope = 'auth:signin-account' and subject = current_setting('test.subject_b');

select pg_temp.become_anon();
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_e'), current_setting('test.subject_b'))) ->> 'status',
  'limited',
  'a fresh client at a full account is limited');
select set_config('test.retry',
  (public.reserve_sign_in_attempt(current_setting('test.subject_e'), current_setting('test.subject_b'))) ->> 'retry_after_seconds', true);
select ok(
  current_setting('test.retry')::integer between 1 and 900,
  'with a retry inside the account window');

select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_e')), 0,
  'and the fresh client''s bucket stays at zero — neither counter moved');
select is(pg_temp.hits_of('auth:signin-account', current_setting('test.subject_b')), 30,
  'the full account bucket did not grow past its tier');

-- Another client at another account is untouched by all of it.
select pg_temp.become_anon();
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_h'), current_setting('test.subject_h'))) ->> 'remaining',
  '9',
  'a bystander pair has its whole allowance');
select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_h')), 1, 'bystander client at one');
select is(pg_temp.hits_of('auth:signin-account', current_setting('test.subject_h')), 1, 'bystander account at one');


-- ===========================================================================
-- 4. Release — one back, never below zero, nobody else's
-- ===========================================================================

select pg_temp.become_anon();

select is(
  (public.release_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'released',
  '2',
  'a release gives one hit back from each of the two buckets');

select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_a')), 9, 'client: ten became nine');
select is(pg_temp.hits_of('auth:signin-account', current_setting('test.subject_b')), 29, 'account: thirty became twenty-nine');
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_h')), 1, 'the bystander client is untouched');
select is(pg_temp.hits_of('auth:signin-account', current_setting('test.subject_h')), 1, 'the bystander account is untouched');

select pg_temp.become_anon();
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'status',
  'allowed',
  'the released allowance can be reserved again');
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'status',
  'limited',
  'but only once — a release is one hit, not a reset');

-- A subject never seen: nothing to give back, and no row is created for it.
select is(
  (public.release_sign_in_attempt(current_setting('test.subject_c'), current_setting('test.subject_d'))) ->> 'released',
  '0',
  'a release for a pair with no bucket gives nothing back');
select pg_temp.become_superuser();
select is(
  (select count(*) from public.rate_limit_buckets
    where subject in (current_setting('test.subject_c'), current_setting('test.subject_d'))),
  0::bigint,
  'and creates no bucket');

-- A bucket at zero stays at zero: the release stops there.
update public.rate_limit_buckets set hits = 0
 where scope = 'auth:signin' and subject = current_setting('test.subject_a');

select pg_temp.become_anon();
select is(
  (public.release_sign_in_attempt(current_setting('test.subject_a'), current_setting('test.subject_b'))) ->> 'released',
  '1',
  'with the client bucket at zero, only the account bucket gives one back');
select is(
  (public.release_sign_in_attempt(current_setting('test.subject_e'), current_setting('test.subject_e'))) ->> 'released',
  '0',
  'a client bucket at zero and an account with no bucket: nothing back');

select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_a')), 0, 'the client bucket is still zero, not negative');
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_e')), 0, 'the fresh client bucket is still zero');
select throws_ok(
  format($$ update public.rate_limit_buckets set hits = -1 where scope = 'auth:signin' and subject = %L $$,
    current_setting('test.subject_a')),
  '23514', null,
  'the table itself refuses a negative count');


-- ===========================================================================
-- 5. Window reset — an old window is neither counted nor released
-- ===========================================================================

update public.rate_limit_buckets
   set window_start = window_start - interval '900 seconds'
 where subject in (current_setting('test.subject_h'));

select pg_temp.become_anon();
select is(
  (public.release_sign_in_attempt(current_setting('test.subject_h'), current_setting('test.subject_h'))) ->> 'released',
  '0',
  'a release finds nothing in the current window when the buckets are last window''s');
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_h'), current_setting('test.subject_h'))) ->> 'remaining',
  '9',
  'a reservation starts the new window with the whole allowance');

select pg_temp.become_superuser();
select is(
  (select string_agg(hits::text, ',' order by window_start)
     from public.rate_limit_buckets where scope = 'auth:signin' and subject = current_setting('test.subject_h')),
  '1,1',
  'the old window''s bucket kept its count; the new window has its own');


-- ===========================================================================
-- 6. Growth — the reservation prunes like the generic door
-- ===========================================================================

insert into public.rate_limit_buckets (scope, subject, window_start, hits) values
  ('content:save', 'old-bucket', now() - interval '3 hours', 50),
  ('content:save', 'recent-bucket', now() - interval '1 hour', 50);

-- A reservation on buckets that already have hits prunes nothing.
select pg_temp.become_anon();
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_h'), current_setting('test.subject_h'))) ->> 'status',
  'allowed',
  'a reservation on existing, non-empty buckets');
select pg_temp.become_superuser();
select is(
  (select count(*) from public.rate_limit_buckets where subject in ('old-bucket', 'recent-bucket')),
  2::bigint,
  'moves nothing else');

-- A reservation that starts a fresh bucket prunes the three-hour-old one.
select pg_temp.become_anon();
select is(
  (public.reserve_sign_in_attempt(current_setting('test.subject_c'), current_setting('test.subject_d'))) ->> 'remaining',
  '9',
  'a reservation that creates fresh buckets');
select pg_temp.become_superuser();
select is(
  (select string_agg(subject, ',' order by subject)
     from public.rate_limit_buckets where subject in ('old-bucket', 'recent-bucket')),
  'recent-bucket',
  'prunes the bucket older than two hours and keeps the recent one');


-- ===========================================================================
-- 8. Abuse — no browser role can move a counter but through the doors
-- ===========================================================================

select pg_temp.become_anon();
select throws_ok(
  $$ update public.rate_limit_buckets set hits = 0 $$,
  '42501', null, 'anon cannot lower a counter directly');
select throws_ok(
  $$ update public.rate_limit_buckets set hits = hits + 1 $$,
  '42501', null, 'anon cannot raise a counter directly');
select throws_ok(
  $$ delete from public.rate_limit_buckets $$,
  '42501', null, 'anon cannot delete a counter');
select throws_ok(
  $$ select * from public.rate_limit_buckets $$,
  '42501', null, 'anon cannot read the counters to learn a subject');

select pg_temp.become_staff();
select throws_ok(
  format($$ select public.reserve_sign_in_attempt(%L, %L) $$, current_setting('test.subject_a'), current_setting('test.subject_b')),
  '42501', null,
  'staff: a caller with a session cannot reserve a sign-in attempt');
select throws_ok(
  format($$ select public.release_sign_in_attempt(%L, %L) $$, current_setting('test.subject_a'), current_setting('test.subject_b')),
  '42501', null,
  'staff: a caller with a session cannot release one');
select throws_ok(
  $$ update public.rate_limit_buckets set hits = 0 $$,
  '42501', null, 'staff cannot reset a counter');
select throws_ok(
  $$ select * from public.rate_limit_buckets $$,
  '42501', null, 'staff cannot read the counters');

select pg_temp.become_superuser();
select is(pg_temp.hits_of('auth:signin', current_setting('test.subject_a')), 0,
  'none of the refused calls moved the client bucket');


-- ===========================================================================
-- 9. Regression — reserving and releasing is not mutating
-- ===========================================================================

select is_empty(
  $$ select subject from public.rate_limit_buckets
      where subject ~ '@'
         or subject ~ '^\d{1,3}(\.\d{1,3}){3}$'
         or subject ~ ':.*:' $$,
  'no bucket subject looks like an e-mail address, an IPv4 address or an IPv6 address');

select is(
  pg_temp.content_state(),
  current_setting('test.content_before'),
  'dishes, news, the announcement, profiles and the audit log are byte-identical');

select * from finish();
rollback;
