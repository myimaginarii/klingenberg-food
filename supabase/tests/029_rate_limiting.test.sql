-- Klingenberg Food — pgTAP: application rate limiting (technical plan §8, §15
-- phase 13B, §0ai; migration 20260905120000).
--
-- From real anonymous, Staff and Owner JWTs, this suite pins:
--
--   1. privileges — the two tables admit no browser role at all; the two doors are
--      EXECUTE for `anon` and `authenticated` only; the resolver is nobody's;
--      every function pins `search_path`;
--   2. the closed vocabulary — an unknown scope, an actor scope without a session,
--      a client scope with one, and a malformed client subject are each refused
--      with the errcode the application maps;
--   3. threshold — hits up to the limit are allowed with a falling `remaining`, the
--      next is `limited` with a retry inside the window, `peek` agrees without
--      counting, and another subject is untouched;
--   4. the actor subject — a Staff call is counted against the Staff uuid whatever
--      subject it passes, an Owner's counter is its own, and no browser role can
--      read, reset, insert or edit a bucket or a tier;
--   5. window reset — a bucket whose window has passed is no longer counted;
--   6. growth — a bucket older than two hours is pruned by the next new bucket, a
--      recent one is kept;
--   7. concurrency — through two REAL sessions (dblink): a second session's
--      increment waits on the first's row lock and then sees its count, so two
--      callers at the threshold cannot both pass (run in its own section, because
--      dblink sessions commit for real and this file rolls back);
--   8. privacy — nothing in the counters looks like an address or an e-mail;
--   9. regression — refusing is not mutating: the content tables and the audit log
--      are byte-identical afterwards.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 002–028.

begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(76);

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

-- Client subjects: 64 hex characters, as the application derives them.
select set_config('test.subject_a', repeat('ab', 32), true);
select set_config('test.subject_b', repeat('cd', 32), true);
select set_config('test.subject_c', repeat('ef', 32), true);

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

create function pg_temp.become_owner() returns void language sql as $fn$
  select pg_temp.become(current_setting('test.owner_uid'), 'owner@example.test');
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

-- Start from empty counters. This file rolls back, so nothing committed is lost;
-- inside the transaction the assertions below meet no bucket a previous run or a
-- local sign-in left behind.
delete from public.rate_limit_buckets;


-- ===========================================================================
-- 7. Concurrency — FIRST, because dblink sessions commit for real
-- ===========================================================================
-- Two sessions, both anonymous, both counting `auth:reset` (limit 5) against one
-- subject. A takes four hits inside an open transaction and holds the row lock; B
-- sends its hit and blocks on that lock; A commits; B's answer must then be the
-- fifth hit (`remaining` 0) — a lost update would have made it the first. Session X
-- sets up and cleans up; nothing here survives the section.

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

/* The statements that make a session anonymous inside its transaction. */
create function pg_temp.as_anon_sql() returns text language sql as $fn$
  select $q$ select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon; $q$;
$fn$;

-- X: nothing of an interrupted earlier run may remain for the race subject.
select is(
  pg_temp.in_session('x', format($q$ delete from public.rate_limit_buckets where subject = %L $q$,
    current_setting('test.subject_c'))),
  '00000',
  'session X starts the race from an empty bucket');

-- A: four hits, uncommitted.
select is(pg_temp.in_session('a', 'begin'), '00000', 'A begins');
select is(pg_temp.in_session('a', pg_temp.as_anon_sql()), '00000', 'A is anonymous');
select is(
  pg_temp.from_session('a', format($q$
    select string_agg(r ->> 'remaining', ',' order by i)
      from (select i, public.consume_rate_limit('auth:reset', %L) as r from generate_series(1, 4) i) s $q$,
    current_setting('test.subject_c'))),
  '4,3,2,1',
  'A counts four hits against the subject and holds the row lock');

-- B: one hit, sent asynchronously because it will block on A's row.
select is(pg_temp.in_session('b', 'begin'), '00000', 'B begins');
select is(pg_temp.in_session('b', pg_temp.as_anon_sql()), '00000', 'B is anonymous');
select is(
  extensions.dblink_send_query('b',
    format($q$ select (public.consume_rate_limit('auth:reset', %L)) ->> 'remaining' $q$,
      current_setting('test.subject_c'))),
  1,
  'B sends its hit');

select pg_sleep(0.5);
select is(extensions.dblink_is_busy('b'), 1, 'B is blocked on the bucket row while A holds it');

select is(pg_temp.in_session('a', 'commit'), '00000', 'A commits its four hits');

select is(
  (select v from extensions.dblink_get_result('b') as t(v text)),
  '0',
  'B then counts the FIFTH hit: its increment ran after A''s commit and saw A''s count');
select pg_temp.drain('b');
select is(pg_temp.in_session('b', 'commit'), '00000', 'B commits');

-- B's session is autocommit again, with no JWT: to the resolver that is a caller
-- without a session, which is what a client scope requires.
select is(
  pg_temp.from_session('b', format($q$
    select (public.consume_rate_limit('auth:reset', %L)) ->> 'status' $q$, current_setting('test.subject_c'))),
  'limited',
  'the sixth hit, from B, is limited — no caller got a count of its own');

select is(
  pg_temp.from_session('x', format($q$
    select hits::text from public.rate_limit_buckets where scope = 'auth:reset' and subject = %L $q$,
    current_setting('test.subject_c'))),
  '6',
  'one bucket holds all six hits');

-- Tear down what the sessions committed.
select is(
  pg_temp.in_session('x', format($q$ delete from public.rate_limit_buckets where subject = %L $q$,
    current_setting('test.subject_c'))),
  '00000',
  'session X removes the race bucket');
select is(
  pg_temp.from_session('x', format($q$
    select count(*)::text from public.rate_limit_buckets where subject = %L $q$, current_setting('test.subject_c'))),
  '0',
  'nothing of the race survives');

select lives_ok($$ select extensions.dblink_disconnect('a') $$, 'A disconnects');
select lives_ok($$ select extensions.dblink_disconnect('b') $$, 'B disconnects');
select lives_ok($$ select extensions.dblink_disconnect('x') $$, 'X disconnects');


-- ===========================================================================
-- 1. Privileges
-- ===========================================================================

select pg_temp.become_superuser();

select is_empty(
  $$ select grantee || ':' || table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('rate_limit_buckets', 'rate_limit_scopes')
        and grantee in ('anon', 'authenticated', 'public') $$,
  'no browser role holds any privilege on the two limiter tables');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.rate_limit_buckets'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.rate_limit_scopes'::regclass),
  'row level security is enabled on both tables, so a stray grant would still admit no row');

select is(
  (select string_agg(grantee, ',' order by grantee)
     from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'consume_rate_limit'
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'anon,authenticated',
  'consume_rate_limit() is EXECUTE for anon and authenticated, not PUBLIC');

select is(
  (select string_agg(grantee, ',' order by grantee)
     from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'peek_rate_limit'
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'anon,authenticated',
  'peek_rate_limit() is EXECUTE for anon and authenticated, not PUBLIC');

select is_empty(
  $$ select grantee from information_schema.routine_privileges
      where specific_schema = 'public' and routine_name = 'rate_limit_resolve'
        and grantee in ('anon', 'authenticated', 'PUBLIC') $$,
  'rate_limit_resolve() is nobody''s to call but the two doors');

select is(
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('consume_rate_limit', 'peek_rate_limit', 'rate_limit_resolve')
      and p.prosecdef
      and 'search_path=""' = any (p.proconfig)),
  3::bigint,
  'all three functions are SECURITY DEFINER with search_path pinned to nothing');


-- ===========================================================================
-- 2. The closed vocabulary, from an anonymous session
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  $$ select public.consume_rate_limit('content:save:extra', repeat('ab', 32)) $$,
  '22023', 'Unknown rate-limit scope.',
  'anon: an unknown scope is refused');

select throws_ok(
  $$ select public.consume_rate_limit('content:save') $$,
  '42501', 'An actor-keyed rate limit needs a session.',
  'anon: an actor scope needs a session');

select throws_ok(
  $$ select public.consume_rate_limit('auth:signin', 'not-a-subject') $$,
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: a client subject must be the derived 64-hex key');

select throws_ok(
  $$ select public.consume_rate_limit('auth:signin') $$,
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: a client scope without a subject is refused');

select throws_ok(
  $$ select public.peek_rate_limit('auth:signin', 'ABCDEF') $$,
  '22023', 'A client-keyed rate limit needs a derived subject.',
  'anon: peek applies the same grammar');

select throws_ok(
  $$ select public.rate_limit_resolve('auth:signin', repeat('ab', 32)) $$,
  '42501', null,
  'anon: the resolver cannot be called directly');

select throws_ok($$ select * from public.rate_limit_buckets $$, '42501', null, 'anon cannot read the counters');
select throws_ok($$ select * from public.rate_limit_scopes $$, '42501', null, 'anon cannot read the tiers');
select throws_ok(
  $$ insert into public.rate_limit_buckets (scope, subject, window_start, hits) values ('auth:signin', repeat('ab', 32), now(), 0) $$,
  '42501', null, 'anon cannot insert a bucket');
select throws_ok(
  $$ delete from public.rate_limit_buckets $$,
  '42501', null, 'anon cannot delete a bucket');


-- ===========================================================================
-- 3. Threshold, refusal, peek, and another subject
-- ===========================================================================
-- `auth:reset` allows 5 per 900 s.

select is(
  (select string_agg((r ->> 'status') || ':' || (r ->> 'remaining'), ',' order by i)
     from (select i, public.consume_rate_limit('auth:reset', current_setting('test.subject_a')) as r
             from generate_series(1, 5) i) s),
  'allowed:4,allowed:3,allowed:2,allowed:1,allowed:0',
  'five hits are allowed, with remaining counting down to zero');

select is(
  (public.consume_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'status',
  'limited',
  'the sixth hit is limited');

-- Read once into a setting: BETWEEN evaluates a volatile expression twice.
select set_config('test.retry',
  (public.consume_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'retry_after_seconds', true);
select ok(
  current_setting('test.retry')::integer between 1 and 900,
  'retry_after_seconds is inside the window');

select is(
  (public.peek_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'status',
  'limited',
  'peek agrees the subject is limited');

select is(
  (public.peek_rate_limit('auth:reset', current_setting('test.subject_b'))) ->> 'remaining',
  '5',
  'peek on an untouched subject shows the whole allowance — and counted nothing');

select is(
  (public.consume_rate_limit('auth:reset', current_setting('test.subject_b'))) ->> 'remaining',
  '4',
  'another subject is unaffected by the first one''s refusal');

select is(
  (public.peek_rate_limit('auth:reset', current_setting('test.subject_b'))) ->> 'remaining',
  '4',
  'peek reports the count without moving it');

select pg_temp.become_superuser();
select is(
  (select hits from public.rate_limit_buckets
    where scope = 'auth:reset' and subject = current_setting('test.subject_a')),
  7,
  'refused hits are still counted (five allowed, two refused), in one bucket');
select is(
  (select count(*) from public.rate_limit_buckets where scope = 'auth:reset'),
  2::bigint,
  'two subjects, two buckets');


-- ===========================================================================
-- 4. The actor subject — Staff and Owner
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (public.consume_rate_limit('content:save')) ->> 'remaining',
  '299',
  'staff: a content save is counted against the actor (300 per window)');

select is(
  (public.consume_rate_limit('content:save', current_setting('test.subject_a'))) ->> 'remaining',
  '298',
  'staff: a subject passed with an actor scope is ignored — the same counter moves');

select throws_ok(
  $$ select public.consume_rate_limit('auth:signin', repeat('ab', 32)) $$,
  '42501', 'A client-keyed rate limit is for callers without a session.',
  'staff: a client scope is refused for a caller with a session');

select throws_ok($$ select * from public.rate_limit_buckets $$, '42501', null, 'staff cannot read the counters');
select throws_ok($$ select * from public.rate_limit_scopes $$, '42501', null, 'staff cannot read the tiers');
select throws_ok(
  $$ update public.rate_limit_buckets set hits = 0 $$,
  '42501', null, 'staff cannot reset a counter');
select throws_ok(
  $$ update public.rate_limit_scopes set max_hits = 100000 where scope = 'content:save' $$,
  '42501', null, 'staff cannot raise a limit');
select throws_ok(
  $$ delete from public.rate_limit_buckets $$,
  '42501', null, 'staff cannot delete a counter');

select pg_temp.become_owner();

select is(
  (public.consume_rate_limit('content:save')) ->> 'remaining',
  '299',
  'owner: the counter is the owner''s own, untouched by the staff hits');

select throws_ok($$ select * from public.rate_limit_buckets $$, '42501', null, 'owner cannot read the counters either');
select throws_ok(
  $$ update public.rate_limit_buckets set hits = 0 $$,
  '42501', null, 'owner cannot reset a counter');
select throws_ok(
  $$ update public.rate_limit_scopes set max_hits = 100000 where scope = 'accounts:invite' $$,
  '42501', null, 'owner cannot raise a limit');
select throws_ok(
  $$ insert into public.rate_limit_scopes (scope, keyed_by, max_hits, window_seconds) values ('x:y', 'actor', 1, 1) $$,
  '42501', null, 'owner cannot add a scope');

select pg_temp.become_superuser();

select is(
  (select hits from public.rate_limit_buckets
    where scope = 'content:save' and subject = current_setting('test.staff_uid')),
  2,
  'the staff bucket''s subject is the staff uuid, not the subject that was passed');
select is(
  (select hits from public.rate_limit_buckets
    where scope = 'content:save' and subject = current_setting('test.owner_uid')),
  1,
  'the owner bucket''s subject is the owner uuid');

-- Account administration, the tightest tier.
select pg_temp.become_owner();
select is(
  (select string_agg(r ->> 'status', ',' order by i)
     from (select i, public.consume_rate_limit('accounts:invite') as r from generate_series(1, 16) i) s),
  repeat('allowed,', 15) || 'limited',
  'owner: the sixteenth invitation in an hour is limited');
select ok(
  ((public.peek_rate_limit('accounts:invite')) ->> 'retry_after_seconds')::integer between 1 and 3600,
  'and the retry is inside the hour');


-- ===========================================================================
-- 5. Window reset
-- ===========================================================================
-- A bucket whose window has ended is not this window's: the next hit starts afresh.

select pg_temp.become_superuser();
update public.rate_limit_buckets
   set window_start = window_start - interval '900 seconds'
 where scope = 'auth:reset' and subject = current_setting('test.subject_a');

select pg_temp.become_anon();
select is(
  (public.peek_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'remaining',
  '5',
  'after the window, peek shows the whole allowance again');
select is(
  (public.consume_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'remaining',
  '4',
  'and the next hit is the first of a new window');

select pg_temp.become_superuser();
select is(
  (select count(*) from public.rate_limit_buckets
    where scope = 'auth:reset' and subject = current_setting('test.subject_a')),
  2::bigint,
  'the old window and the new one are two buckets');


-- ===========================================================================
-- 6. Growth — old buckets are pruned by the next new bucket
-- ===========================================================================

insert into public.rate_limit_buckets (scope, subject, window_start, hits) values
  ('content:save', 'old-bucket', now() - interval '3 hours', 50),
  ('content:save', 'recent-bucket', now() - interval '1 hour', 50);

select is(
  (select count(*) from public.rate_limit_buckets where subject in ('old-bucket', 'recent-bucket')),
  2::bigint,
  'two fixture buckets: one three hours old, one an hour old');

-- A hit on an existing bucket prunes nothing.
select pg_temp.become_anon();
select is(
  (public.consume_rate_limit('auth:reset', current_setting('test.subject_a'))) ->> 'status',
  'allowed',
  'a hit on an existing bucket');
select pg_temp.become_superuser();
select is(
  (select count(*) from public.rate_limit_buckets where subject in ('old-bucket', 'recent-bucket')),
  2::bigint,
  'moves nothing else');

-- A hit that creates a new bucket prunes the three-hour-old one and keeps the hour-old one.
select pg_temp.become_anon();
select is(
  (public.consume_rate_limit('auth:signin', current_setting('test.subject_b'))) ->> 'remaining',
  '9',
  'a hit that creates a new bucket');
select pg_temp.become_superuser();
select is(
  (select string_agg(subject, ',' order by subject)
     from public.rate_limit_buckets where subject in ('old-bucket', 'recent-bucket')),
  'recent-bucket',
  'prunes the bucket older than two hours and keeps the recent one');
select is(
  (select count(*) from public.rate_limit_buckets where window_start < now() - interval '2 hours'),
  0::bigint,
  'nothing older than two hours remains anywhere');


-- ===========================================================================
-- 8. Privacy — the counters hold keys and uuids, never an address
-- ===========================================================================

select is_empty(
  $$ select subject from public.rate_limit_buckets
      where subject ~ '@'
         or subject ~ '^\d{1,3}(\.\d{1,3}){3}$'
         or subject ~ ':.*:' $$,
  'no bucket subject looks like an e-mail address, an IPv4 address or an IPv6 address');

select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'rate_limit_buckets'
        and column_name not in ('scope', 'subject', 'window_start', 'hits') $$,
  'the bucket table has exactly four columns — nothing about the request is stored');


-- ===========================================================================
-- 9. Regression — refusing is not mutating
-- ===========================================================================

select is(
  pg_temp.content_state(),
  current_setting('test.content_before'),
  'dishes, news, the announcement, profiles and the audit log are byte-identical');

select * from finish();
rollback;
