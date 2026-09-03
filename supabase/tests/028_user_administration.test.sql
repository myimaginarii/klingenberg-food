-- Klingenberg Food — pgTAP: user administration (technical plan §4, §5 decision 11,
-- §8, §9, §15 phase 11C; migration 20260903120000).
--
-- From real Owner, Staff and anonymous JWTs, this suite pins:
--
--   1. Staff — cannot create a profile, promote themselves or anybody, deactivate or
--      reactivate, list the accounts, or move a protected column directly;
--   2. anonymous — no account write, no read, no transition;
--   3. Owner — the three transitions do what they say: a profile behind an invited
--      Auth identity (and `exists` / `no_auth_user` / `invalid` as results, not
--      exceptions), a role change, a deactivation and a reactivation that keeps the
--      role — each version-checked, each audited exactly once, a stale or refused
--      call audited never;
--   4. the last active owner — cannot be demoted or deactivated through the
--      transitions (`last_owner`), while a second active owner unblocks both;
--   5. existing-token semantics — after a transition, `is_staff()` / `is_owner()`
--      answer from the *current* row for the affected JWT: a deactivated Staff
--      member's write is zero rows, a promoted one reads the audit log, a demoted
--      one no longer does;
--   6. the direct bypass — a raw INSERT, a raw UPDATE of `role` or `disabled_at`,
--      and a raw DELETE are refused for Staff *and* Owner (42501); a raw UPDATE of
--      `name` by the Owner still works, as phase 1 pinned;
--   7. the two races — through two REAL database sessions (dblink), not a
--      single-session simulation: two direct demotions of two owners, and a
--      transition racing a self-deactivation, each end with exactly one owner
--      (run first in the file, see below);
--   8. session revocation — deactivating removes the person's auth.sessions rows
--      (their refresh tokens cascade) in the same transaction; reactivating brings
--      none back; the helper refuses every direct call, Owner included;
--   9. audit hygiene — no secret-shaped key in any account audit row;
--  10. regression — the content tables are byte-identical afterwards.
--
-- THE RACE SECTION COMMITS. dblink sessions are separate connections, so what they
-- write is committed for real and survives this file's ROLLBACK. The section creates
-- its own second owner, runs both races, and removes what it created; each step is
-- asserted, and the last assertion proves the seeded owner is back exactly as found.
-- Should the section be interrupted half-way, `npm run db:users` restores the seeded
-- identities (it upserts the role and clears `disabled_at`).
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 002–027.

begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(153);

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'the fixture starts with exactly one active owner');

delete from public.audit_log;

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

-- ---------------------------------------------------------------------------
-- Fixtures: two more Auth identities, in this transaction only
-- ---------------------------------------------------------------------------
-- GoTrue never sees these rows; they exist so that "an Auth user without a profile"
-- and "a third staff member" can be exercised, and they roll back with the file.

select set_config('test.third_uid', gen_random_uuid()::text, true);
select set_config('test.orphan_uid', gen_random_uuid()::text, true);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
) values
  (current_setting('test.third_uid')::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'third@example.test', '', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', false, false),
  (current_setting('test.orphan_uid')::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'orphan@example.test', '', null, now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', false, false);

-- The third identity gets a Staff profile as the superuser (the guard steps aside).
insert into public.profiles (user_id, name, role)
values (current_setting('test.third_uid')::uuid, 'Tredje Medarbejder', 'staff');

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

create function pg_temp.become_third() returns void language sql as $fn$
  select pg_temp.become(current_setting('test.third_uid'), 'third@example.test');
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

/* How many rows a statement actually moved, as the current role (a denied UPDATE
   under RLS reports zero rows, it does not raise). Plain SECURITY INVOKER. */
create function pg_temp.rows_moved(p_sql text) returns integer
language plpgsql security invoker as $fn$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$fn$;

/* The version token of a profile, read as the superuser. */
create function pg_temp.version_of(p_uid uuid) returns timestamptz
language sql security definer as $fn$
  select updated_at from public.profiles where user_id = p_uid;
$fn$;

create function pg_temp.role_of(p_uid uuid) returns text
language sql security definer as $fn$
  select role from public.profiles where user_id = p_uid;
$fn$;

create function pg_temp.disabled_of(p_uid uuid) returns timestamptz
language sql security definer as $fn$
  select disabled_at from public.profiles where user_id = p_uid;
$fn$;

create function pg_temp.audit_count(p_action text) returns bigint
language sql security definer as $fn$
  select count(*) from public.audit_log where entity = 'profile' and action = p_action;
$fn$;

create function pg_temp.audit_total() returns bigint
language sql security definer as $fn$
  select count(*) from public.audit_log;
$fn$;

create function pg_temp.content_state() returns text
language sql security definer as $fn$
  select md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
    from (
      select 'dishes' as k, jsonb_agg(d order by d.id) as t from public.dishes d
      union all select 'categories', jsonb_agg(c order by c.id) from public.menu_categories c
      union all select 'news', jsonb_agg(n order by n.id) from public.news n
      union all select 'pages', jsonb_agg(p order by p.key) from public.pages p
      union all select 'contact', jsonb_agg(s) from public.site_contact s
      union all select 'hours', jsonb_agg(h) from public.opening_hours h
      union all select 'announcement', jsonb_agg(a) from public.announcement a
    ) parts;
$fn$;

-- ===========================================================================
-- 1. The two races — two real sessions, FIRST, before this session holds any lock
-- ===========================================================================
-- Everything in this section commits (see the header). It runs before any other
-- section because every transition below takes the invariant lock and the row lock
-- of the account it moves, and holds both until this file's ROLLBACK — a race run
-- later would wait on this very session, forever. Session X sets up and tears
-- down; sessions A and B race. `race_uid` is a fresh Auth identity created — and
-- deleted again — outside this transaction.

select pg_temp.become_superuser();

select set_config('test.race_uid', gen_random_uuid()::text, true);
select set_config('test.conn',
  format('host=%s dbname=postgres user=postgres password=postgres', inet_server_addr()), true);

select lives_ok(
  $$ select extensions.dblink_connect('x', current_setting('test.conn')) $$,
  'session X connects');
select lives_ok(
  $$ select extensions.dblink_connect('a', current_setting('test.conn')) $$,
  'session A connects');
select lives_ok(
  $$ select extensions.dblink_connect('b', current_setting('test.conn')) $$,
  'session B connects');

/* Run one statement in a named session and report its SQLSTATE ('00000' on success). */
create function pg_temp.in_session(p_conn text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform extensions.dblink_exec(p_conn, p_sql);
  return '00000';
exception when others then
  -- dblink reports the remote error with the remote SQLSTATE.
  return sqlstate;
end;
$fn$;

/* One value from a named session. */
create function pg_temp.from_session(p_conn text, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  select t.v into v from extensions.dblink(p_conn, p_sql) as t(v text);
  return v;
end;
$fn$;

-- Session X: a second active owner, committed.
select is(
  pg_temp.in_session('x', format($q$
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous)
    values (%L, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'race@example.test', '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, false);
    insert into public.profiles (user_id, name, role) values (%L, 'Kapløb Ejer', 'owner');
  $q$, current_setting('test.race_uid'), current_setting('test.race_uid'))),
  '00000',
  'session X commits a second active owner');

select is(
  pg_temp.from_session('x', $$ select count(*)::text from public.profiles where role = 'owner' and disabled_at is null $$),
  '2',
  'two active owners are committed');

-- 1a. Two DIRECT demotions, one per session, interleaved: both pass their statement
-- (the WHEN-queued trigger is deferred), the first commit passes, the second commit
-- must fail — because its count waits for the invariant lock and then sees the first.
select is(pg_temp.in_session('a', 'begin'), '00000', 'A begins');
select is(pg_temp.in_session('b', 'begin'), '00000', 'B begins');
select is(
  pg_temp.in_session('a', format($q$ update public.profiles set role = 'staff' where user_id = %L $q$,
    current_setting('test.owner_uid'))),
  '00000',
  'A demotes the seeded owner (statement accepted, check deferred)');
select is(
  pg_temp.in_session('b', format($q$ update public.profiles set role = 'staff' where user_id = %L $q$,
    current_setting('test.race_uid'))),
  '00000',
  'B demotes the second owner (statement accepted, check deferred)');
select is(pg_temp.in_session('a', 'commit'), '00000', 'A commits: one owner remains as far as A can see');
select is(pg_temp.in_session('b', 'commit'), '23514',
  'B''s commit is refused: under the lock its count sees A''s commit, and zero owners is not allowed');
select is(
  pg_temp.from_session('x', $$ select count(*)::text from public.profiles where role = 'owner' and disabled_at is null $$),
  '1',
  'exactly one active owner survived the direct race');
select is(
  pg_temp.from_session('x', format($q$ select role from public.profiles where user_id = %L $q$, current_setting('test.race_uid'))),
  'owner',
  'and it is the one whose transaction was refused');

-- Restore two owners for the second race.
select is(
  pg_temp.in_session('x', format($q$ update public.profiles set role = 'owner' where user_id = %L $q$,
    current_setting('test.owner_uid'))),
  '00000',
  'session X restores the seeded owner');

-- 1b. Two concurrent TRANSITIONS from the seeded owner's JWT in two sessions — two
-- tabs: one demotes the second owner, the other deactivates the seeded owner. The
-- transition takes the lock first, so B blocks inside set_account_active() until A
-- commits, and then answers last_owner — a result, not a commit-time failure. (A
-- *mutual* demotion — each owner demoting the other — ends the same way one step
-- earlier: after A commits, B's actor is no longer an owner, so RLS shows B no row
-- and it answers not_found; either way exactly one owner remains.)
create function pg_temp.as_owner_sql(p_uid text, p_email text) returns text
language sql as $fn$
  select format($q$
    select set_config('request.jwt.claims', %L, true);
    set local role authenticated;
  $q$, json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email)::text);
$fn$;

/* Consume every remaining result set of an asynchronous query. */
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

select is(pg_temp.in_session('a', 'begin'), '00000', 'A begins again');
select is(pg_temp.in_session('b', 'begin'), '00000', 'B begins again');
select is(
  pg_temp.in_session('a', pg_temp.as_owner_sql(current_setting('test.owner_uid'), 'owner@example.test')),
  '00000', 'A is the seeded owner');
select is(
  pg_temp.in_session('b', pg_temp.as_owner_sql(current_setting('test.owner_uid'), 'owner@example.test')),
  '00000', 'B is the seeded owner, in a second session');

-- A: demote the second owner through the transition (holds the lock until commit).
select is(
  pg_temp.from_session('a',
    format($q$ select (public.set_account_role(%L, 'staff',
         (select updated_at from public.profiles where user_id = %L))) ->> 'status' $q$,
         current_setting('test.race_uid'), current_setting('test.race_uid'))),
  'updated',
  'A demotes the second owner through the transition and holds the lock');

-- B: deactivate the seeded owner (self) — sent asynchronously, because it will block.
select is(
  extensions.dblink_send_query('b',
    format($q$ select (public.set_account_active(%L, false,
         (select updated_at from public.profiles where user_id = %L))) ->> 'status' $q$,
         current_setting('test.owner_uid'), current_setting('test.owner_uid'))),
  1,
  'B sends the self-deactivation of the seeded owner');

select pg_sleep(0.5);
select is(extensions.dblink_is_busy('b'), 1, 'B is blocked on the invariant lock while A holds it');

select is(pg_temp.in_session('a', 'commit'), '00000', 'A commits its demotion');

select is(
  (select v from extensions.dblink_get_result('b') as t(v text)),
  'last_owner',
  'B then answers last_owner: its count ran after A''s commit');
select pg_temp.drain('b');
select is(pg_temp.in_session('b', 'commit'), '00000', 'B commits nothing');

select is(
  pg_temp.from_session('x', $$ select count(*)::text from public.profiles where role = 'owner' and disabled_at is null $$),
  '1',
  'exactly one active owner survived the transition race');
select is(
  pg_temp.from_session('x', format($q$ select role || '/' || coalesce(disabled_at::text, 'active')
    from public.profiles where user_id = %L $q$, current_setting('test.owner_uid'))),
  'owner/active',
  'and it is the seeded owner, still active');
select is(
  pg_temp.from_session('x', format($q$ select count(*)::text from public.audit_log
    where entity = 'profile' and action = 'role' and entity_id = %L $q$, current_setting('test.race_uid'))),
  '1',
  'the race wrote exactly one role audit row — A''s');
select is(
  pg_temp.from_session('x', format($q$ select count(*)::text from public.audit_log
    where entity = 'profile' and action = 'deactivate' and entity_id = %L $q$, current_setting('test.owner_uid'))),
  '0',
  'and B''s refusal wrote none');

-- Tear down what the races committed: the race identity (its profile cascades; the
-- seeded owner is active, so the invariant holds) and A's committed audit row.
select is(
  pg_temp.in_session('x', format($q$
    delete from public.audit_log where entity_id = %L;
    delete from auth.users where id = %L;
  $q$, current_setting('test.race_uid'), current_setting('test.race_uid'))),
  '00000',
  'session X removes the race identity');

select is(
  pg_temp.from_session('x', $$ select count(*)::text from public.profiles $$),
  '2',
  'the committed profiles are the two seeded identities again');
select is(
  pg_temp.from_session('x', format($q$ select role || '/' || coalesce(disabled_at::text, 'active')
    from public.profiles where user_id = %L $q$, current_setting('test.owner_uid'))),
  'owner/active',
  'the seeded owner is exactly as found');

select lives_ok($$ select extensions.dblink_disconnect('a') $$, 'A disconnects');
select lives_ok($$ select extensions.dblink_disconnect('b') $$, 'B disconnects');
select lives_ok($$ select extensions.dblink_disconnect('x') $$, 'X disconnects');



select set_config('test.content_before', pg_temp.content_state(), true);
select set_config('test.owner_version', pg_temp.version_of(current_setting('test.owner_uid')::uuid)::text, true);
select set_config('test.staff_version', pg_temp.version_of(current_setting('test.staff_uid')::uuid)::text, true);
select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);


-- ===========================================================================
-- 2. Staff: no account administration at all
-- ===========================================================================

select pg_temp.become_staff();

select throws_ok(
  $$ select public.create_account_profile(current_setting('test.orphan_uid')::uuid, 'Selvudnævnt', 'owner') $$,
  '42501', null,
  'staff cannot create an account through the transition');

select throws_ok(
  $$ select public.set_account_role(current_setting('test.staff_uid')::uuid, 'owner',
       current_setting('test.staff_version')::timestamptz) $$,
  '42501', null,
  'staff cannot promote themselves through the transition');

select throws_ok(
  $$ select public.set_account_role(current_setting('test.third_uid')::uuid, 'owner',
       current_setting('test.third_version')::timestamptz) $$,
  '42501', null,
  'staff cannot promote another account through the transition');

select throws_ok(
  $$ select public.set_account_active(current_setting('test.third_uid')::uuid, false,
       current_setting('test.third_version')::timestamptz) $$,
  '42501', null,
  'staff cannot deactivate an account through the transition');

select throws_ok(
  $$ select public.set_account_active(current_setting('test.third_uid')::uuid, true,
       current_setting('test.third_version')::timestamptz) $$,
  '42501', null,
  'staff cannot reactivate an account through the transition');

select throws_ok(
  $$ select * from public.list_accounts() $$,
  '42501', null,
  'staff cannot list the accounts');

-- Direct writes: RLS admits no row to Staff, so an UPDATE moves nothing; INSERT and
-- DELETE are refused outright (policy, and — for DELETE — no privilege at all).
select is(
  pg_temp.rows_moved($$ update public.profiles set role = 'owner'
    where user_id = current_setting('test.staff_uid')::uuid $$),
  0,
  'a direct self-promotion by staff moves zero rows');

select is(
  pg_temp.rows_moved($$ update public.profiles set disabled_at = now()
    where user_id = current_setting('test.third_uid')::uuid $$),
  0,
  'a direct deactivation by staff moves zero rows');

select is(
  pg_temp.rows_moved($$ update public.profiles set disabled_at = null
    where user_id = current_setting('test.staff_uid')::uuid $$),
  0,
  'a direct reactivation by staff moves zero rows');

select throws_ok(
  $$ insert into public.profiles (user_id, name, role)
     values (current_setting('test.orphan_uid')::uuid, 'Selvudnævnt', 'owner') $$,
  '42501', null,
  'a direct INSERT by staff is refused');

select throws_ok(
  $$ delete from public.profiles where user_id = current_setting('test.owner_uid')::uuid $$,
  '42501', null,
  'a direct DELETE by staff is refused — the privilege no longer exists');

select throws_ok(
  $$ update public.profiles set updated_by = current_setting('test.staff_uid')::uuid
     where user_id = current_setting('test.staff_uid')::uuid $$,
  '42501', null,
  'updated_by is not in the UPDATE grant');

select is(pg_temp.role_of(current_setting('test.staff_uid')::uuid), 'staff', 'staff is still staff');
select is(pg_temp.audit_total(), 0::bigint, 'no refused Staff attempt wrote an audit row');


-- ===========================================================================
-- 3. Anonymous: nothing
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  $$ select public.create_account_profile(current_setting('test.orphan_uid')::uuid, 'Anon', 'owner') $$,
  '42501', null, 'anon cannot call create_account_profile()');
select throws_ok(
  $$ select public.set_account_role(current_setting('test.staff_uid')::uuid, 'owner', now()) $$,
  '42501', null, 'anon cannot call set_account_role()');
select throws_ok(
  $$ select public.set_account_active(current_setting('test.staff_uid')::uuid, false, now()) $$,
  '42501', null, 'anon cannot call set_account_active()');
select throws_ok(
  $$ select * from public.list_accounts() $$,
  '42501', null, 'anon cannot call list_accounts()');
select throws_ok(
  $$ update public.profiles set role = 'owner' $$,
  '42501', null, 'anon cannot update profiles');
select throws_ok(
  $$ select user_id from public.profiles $$,
  '42501', null, 'anon cannot read profiles');


-- ===========================================================================
-- 4. Owner: the read model, and the direct bypass closed
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select count(*) from public.list_accounts()),
  3::bigint,
  'the owner lists every account');

select is(
  (select email from public.list_accounts() where user_id = current_setting('test.third_uid')::uuid),
  'third@example.test',
  'the read model carries the Auth e-mail');

select is(
  (select array_agg(role order by role) from public.list_accounts()),
  array['owner', 'staff', 'staff'],
  'the read model carries the profile role');

select is(
  (select user_id from public.list_accounts() limit 1),
  current_setting('test.owner_uid')::uuid,
  'active owners are listed first');

-- The guard: the Owner holds UPDATE on role and disabled_at, and is still refused
-- unless the statement came from a transition.
select throws_ok(
  $$ update public.profiles set role = 'owner'
     where user_id = current_setting('test.staff_uid')::uuid $$,
  '42501', null,
  'a direct promotion by the owner is refused by the guard');

select throws_ok(
  $$ update public.profiles set disabled_at = now()
     where user_id = current_setting('test.staff_uid')::uuid $$,
  '42501', null,
  'a direct deactivation by the owner is refused by the guard');

select throws_ok(
  $$ update public.profiles set role = 'staff', name = 'Omdøbt'
     where user_id = current_setting('test.owner_uid')::uuid $$,
  '42501', null,
  'a statement moving the role beside a name is refused as a whole');

select throws_ok(
  $$ insert into public.profiles (user_id, name, role)
     values (current_setting('test.orphan_uid')::uuid, 'Direkte', 'staff') $$,
  '42501', null,
  'a direct INSERT by the owner is refused by the guard');

select throws_ok(
  $$ delete from public.profiles where user_id = current_setting('test.third_uid')::uuid $$,
  '42501', null,
  'a direct DELETE by the owner is refused — deactivate, never delete');

select throws_ok(
  $$ update public.profiles set created_at = now()
     where user_id = current_setting('test.third_uid')::uuid $$,
  '42501', null,
  'created_at is not in the UPDATE grant');

-- A statement that names the column but does not move it is not a write of it.
select is(
  pg_temp.rows_moved($$ update public.profiles set role = role
    where user_id = current_setting('test.third_uid')::uuid $$),
  1,
  'an UPDATE that leaves the role as it is passes the guard');

-- The one direct write phase 1 pinned for the Owner stays open.
select is(
  pg_temp.rows_moved($$ update public.profiles set name = 'Tredje Omdøbt'
    where user_id = current_setting('test.third_uid')::uuid $$),
  1,
  'the owner can still rename an account directly (003)');

select is(pg_temp.role_of(current_setting('test.staff_uid')::uuid), 'staff', 'nothing moved the staff role');
select is(pg_temp.disabled_of(current_setting('test.staff_uid')::uuid), null, 'nothing deactivated staff');
select is(pg_temp.audit_total(), 0::bigint, 'no refused Owner attempt wrote an audit row');

-- The third row's version moved with the rename; re-read it for the transitions below.
select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);


-- ===========================================================================
-- 5. Owner: create_account_profile()
-- ===========================================================================

select is(
  (select public.create_account_profile(current_setting('test.orphan_uid')::uuid, 'Inviteret Person', 'staff')) ->> 'status',
  'created',
  'the profile behind an invited Auth identity is created');

select is(
  pg_temp.role_of(current_setting('test.orphan_uid')::uuid), 'staff',
  'with the requested role');

select is(
  (select public.create_account_profile(current_setting('test.orphan_uid')::uuid, 'Igen', 'owner')) ->> 'status',
  'exists',
  'a second creation for the same identity is exists, and changes nothing');

select is(
  pg_temp.role_of(current_setting('test.orphan_uid')::uuid), 'staff',
  'the existing profile kept its role');

select is(
  (select public.create_account_profile(gen_random_uuid(), 'Ingen', 'staff')) ->> 'status',
  'no_auth_user',
  'an id naming no Auth user is no_auth_user, never a row');

select is(
  (select public.create_account_profile(current_setting('test.orphan_uid')::uuid, '', 'staff')) ->> 'status',
  'exists',
  'existence is answered before the name is checked');

select throws_ok(
  $$ select public.create_account_profile(current_setting('test.orphan_uid')::uuid, 'X', 'admin') $$,
  '22023', null,
  'a role outside the vocabulary is refused');

select is(pg_temp.audit_count('invite'), 1::bigint, 'exactly one invite audit row');
select is(
  (select after from public.audit_log where action = 'invite'),
  '{"name": "Inviteret Person", "role": "staff", "disabled_at": null}'::jsonb,
  'the invite audit row records name, role and state');
select is(
  (select actor_id from public.audit_log where action = 'invite'),
  current_setting('test.owner_uid')::uuid,
  'the invite audit row is attributed to the owner from the JWT');
select is(
  (select entity_id from public.audit_log where action = 'invite'),
  current_setting('test.orphan_uid')::uuid,
  'and names the invited identity');

-- A name the CHECK refuses is `invalid`, not an exception (a fresh identity).
select pg_temp.become_superuser();
select set_config('test.blank_uid', gen_random_uuid()::text, true);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
) values
  (current_setting('test.blank_uid')::uuid, '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'blank@example.test', '', null, now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', false, false);
select pg_temp.become_owner();

select is(
  (select public.create_account_profile(current_setting('test.blank_uid')::uuid, '   ', 'staff')) ->> 'status',
  'invalid',
  'a blank name is invalid, and no row exists');
select is(pg_temp.role_of(current_setting('test.blank_uid')::uuid), null, 'no profile was created for the blank name');
select is(pg_temp.audit_count('invite'), 1::bigint, 'the refused creation audited nothing');


-- ===========================================================================
-- 6. Owner: set_account_role()
-- ===========================================================================

select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'owner',
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated',
  'the owner promotes a staff member');

select is(pg_temp.role_of(current_setting('test.third_uid')::uuid), 'owner', 'the promotion took effect');
select is(pg_temp.audit_count('role'), 1::bigint, 'exactly one role audit row');
select is(
  (select before || after from public.audit_log where action = 'role'),
  '{"role": "owner", "disabled_at": null}'::jsonb,
  'the role audit row holds the new role in after');
select is(
  (select before ->> 'role' from public.audit_log where action = 'role'),
  'staff',
  'and the old role in before');

-- Stale: a version the row no longer has. (`now()` is constant within a transaction,
-- so the touch stamp cannot move inside this file — the older token is stated.)
select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'staff',
     current_setting('test.third_version')::timestamptz - interval '1 minute')) ->> 'status',
  'stale',
  'a stale version token is stale');
select is(pg_temp.role_of(current_setting('test.third_uid')::uuid), 'owner', 'a stale call moved nothing');

select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'owner',
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'unchanged',
  'the same role again is unchanged');

select is(
  (select public.set_account_role(gen_random_uuid(), 'owner', now())) ->> 'status',
  'not_found',
  'an unknown account is not_found');

select throws_ok(
  $$ select public.set_account_role(current_setting('test.third_uid')::uuid, 'admin',
       current_setting('test.third_version')::timestamptz) $$,
  '22023', null,
  'a role outside the vocabulary is refused');

select is(pg_temp.audit_count('role'), 1::bigint, 'stale, unchanged, not_found and refused audited nothing');


-- ===========================================================================
-- 7. The last active owner
-- ===========================================================================

-- Two active owners now: the seeded one and the third. Demote the third back.
select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'staff',
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated',
  'with two owners, one can be demoted');

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'exactly one active owner remains');

select is(
  (select public.set_account_role(current_setting('test.owner_uid')::uuid, 'staff',
     current_setting('test.owner_version')::timestamptz)) ->> 'status',
  'last_owner',
  'the last active owner cannot be demoted — last_owner, not an exception');

select is(
  (select public.set_account_active(current_setting('test.owner_uid')::uuid, false,
     current_setting('test.owner_version')::timestamptz)) ->> 'status',
  'last_owner',
  'the last active owner cannot be deactivated — last_owner');

select is(pg_temp.role_of(current_setting('test.owner_uid')::uuid), 'owner', 'the owner is still owner');
select is(pg_temp.disabled_of(current_setting('test.owner_uid')::uuid), null, 'the owner is still active');
select is(pg_temp.audit_count('role'), 2::bigint, 'the two refusals audited nothing (two role rows: promote, demote)');
select is(pg_temp.audit_count('deactivate'), 0::bigint, 'no deactivate audit row');

-- The deferred trigger is the backstop for a path that bypasses the transition:
-- a superuser demotion of the last owner is still 23514 at statement time when the
-- constraint is made immediate (004's shape).
select pg_temp.become_superuser();
set constraints all immediate;
select throws_ok(
  $$ update public.profiles set role = 'staff'
      where user_id = current_setting('test.owner_uid')::uuid $$,
  '23514', null,
  'the constraint trigger still refuses the last owner for a caller policies cannot stop');
set constraints all deferred;
select pg_temp.become_owner();


-- ===========================================================================
-- 8. Owner: set_account_active() — deactivate, reactivate, keep the role
-- ===========================================================================

select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);

select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, false,
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated',
  'the owner deactivates an account');

select isnt(pg_temp.disabled_of(current_setting('test.third_uid')::uuid), null, 'disabled_at is set');
select is(pg_temp.role_of(current_setting('test.third_uid')::uuid), 'staff', 'the role is untouched by deactivation');
select is(pg_temp.audit_count('deactivate'), 1::bigint, 'exactly one deactivate audit row');
select is(
  (select before from public.audit_log where action = 'deactivate'),
  '{"role": "staff", "disabled_at": null}'::jsonb,
  'the deactivate audit row holds the active state in before');
select isnt(
  (select after ->> 'disabled_at' from public.audit_log where action = 'deactivate'),
  null,
  'and the deactivation instant in after');

select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, false,
     current_setting('test.third_version')::timestamptz - interval '1 minute')) ->> 'status',
  'stale',
  'an older version token is stale');

select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, false,
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'unchanged',
  'deactivating a deactivated account is unchanged');

select is(
  (select role from public.list_accounts() where user_id = current_setting('test.third_uid')::uuid),
  'staff',
  'the read model still lists the deactivated account, with its role');
select isnt(
  (select disabled_at from public.list_accounts() where user_id = current_setting('test.third_uid')::uuid),
  null,
  'and with its deactivation instant');

select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, true,
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated',
  'the owner reactivates the account');

select is(pg_temp.disabled_of(current_setting('test.third_uid')::uuid), null, 'disabled_at is cleared');
select is(pg_temp.role_of(current_setting('test.third_uid')::uuid), 'staff', 'the account regained its existing role — no new account, no new role');
select is(pg_temp.audit_count('reactivate'), 1::bigint, 'exactly one reactivate audit row');
select is(
  (select after from public.audit_log where action = 'reactivate'),
  '{"role": "staff", "disabled_at": null}'::jsonb,
  'the reactivate audit row holds the active state in after');

select is(
  (select public.set_account_active(gen_random_uuid(), false, now())) ->> 'status',
  'not_found',
  'an unknown account is not_found');

select is(pg_temp.audit_count('deactivate') + pg_temp.audit_count('reactivate'), 2::bigint,
  'stale, unchanged and not_found audited nothing');


-- ===========================================================================
-- 9. Existing-token semantics: the helpers answer from the current row
-- ===========================================================================
-- The JWT does not change when a role or a state changes; the helpers read the
-- profile, so the refusal is immediate for every policy in the database.

select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);

-- Two Auth sessions for the third identity, as two signed-in devices would hold,
-- and one for the seeded owner (the Auth server's own shape; rolled back with the
-- file). `auth.sessions` is the Auth server's table — no JWT role can read it, so
-- the counts below go through SECURITY DEFINER temp helpers.
select pg_temp.become_superuser();
create function pg_temp.sessions_of(p_uid uuid) returns bigint
language sql security definer as $fn$
  select count(*) from auth.sessions where user_id = p_uid;
$fn$;
create function pg_temp.tokens_of(p_uid uuid) returns bigint
language sql security definer as $fn$
  select count(*) from auth.refresh_tokens where user_id = p_uid::text;
$fn$;
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values (gen_random_uuid(), current_setting('test.third_uid')::uuid, now(), now(), 'aal1'),
       (gen_random_uuid(), current_setting('test.third_uid')::uuid, now(), now(), 'aal1'),
       (gen_random_uuid(), current_setting('test.owner_uid')::uuid, now(), now(), 'aal1');
insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
select 'fixture-' || s.id::text, s.user_id::text, false, now(), now(), s.id
  from auth.sessions s
 where s.user_id in (current_setting('test.third_uid')::uuid, current_setting('test.owner_uid')::uuid)
   and s.created_at = now();
select is(pg_temp.sessions_of(current_setting('test.third_uid')::uuid), 2::bigint,
  'the third identity holds two sessions');
select is(pg_temp.tokens_of(current_setting('test.third_uid')::uuid), 2::bigint,
  'and two refresh tokens');
select set_config('test.owner_sessions', pg_temp.sessions_of(current_setting('test.owner_uid')::uuid)::text, true);

-- The helper refuses every direct call: no marker, and the account is active.
select pg_temp.become_owner();
select throws_ok(
  $$ select public.revoke_account_sessions(current_setting('test.third_uid')::uuid) $$,
  '42501', null,
  'the owner cannot revoke sessions directly — only the transition may');
select pg_temp.become_staff();
select throws_ok(
  $$ select public.revoke_account_sessions(current_setting('test.third_uid')::uuid) $$,
  '42501', null,
  'staff cannot revoke sessions directly');
select pg_temp.become_anon();
select throws_ok(
  $$ select public.revoke_account_sessions(current_setting('test.third_uid')::uuid) $$,
  '42501', null,
  'anon cannot revoke sessions');
select pg_temp.become_owner();

-- 9a. Deactivate the third (Staff) — their JWT loses every Staff capability, and
-- their sessions are gone in the same transaction.
select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, false,
     current_setting('test.third_version')::timestamptz)) ->> 'sessions_revoked',
  '2',
  'the third account is deactivated, and the transition reports two sessions revoked');
select is(pg_temp.sessions_of(current_setting('test.third_uid')::uuid), 0::bigint,
  'no session remains for the deactivated identity');
select is(pg_temp.tokens_of(current_setting('test.third_uid')::uuid), 0::bigint,
  'and no refresh token — they cascaded with the sessions');
select is(pg_temp.sessions_of(current_setting('test.owner_uid')::uuid),
  current_setting('test.owner_sessions')::bigint,
  'nobody else''s sessions were touched');
select is(
  coalesce(current_setting('app.account_write', true), '') || coalesce(current_setting('app.account_sessions', true), ''), '',
  'both markers are cleared after the transition');

-- A deactivated account with the marker gone: still refused directly.
select throws_ok(
  $$ select public.revoke_account_sessions(current_setting('test.third_uid')::uuid) $$,
  '42501', null,
  'even a deactivated account''s sessions cannot be revoked by a direct call');

select pg_temp.become_third();
select is(public.is_staff(), false, 'a deactivated staff JWT is not staff');
select is(public.is_owner(), false, 'nor owner');
select is(
  pg_temp.rows_moved($$ update public.dishes set draft = '{"name": "Smuglet"}'::jsonb $$),
  0,
  'a deactivated staff JWT moves zero dish rows');
select throws_ok(
  $$ select public.log_audit('publish', 'dishes') $$,
  '42501', null,
  'a deactivated staff JWT cannot write the audit log');
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a deactivated person still sees their own profile — the login screen can say why');

-- 9b. Reactivate and promote — the same JWT gains Owner capabilities.
select pg_temp.become_owner();
select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);
select is(
  (select public.set_account_active(current_setting('test.third_uid')::uuid, true,
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated', 'reactivated');
select is(pg_temp.sessions_of(current_setting('test.third_uid')::uuid), 0::bigint,
  'reactivation brings no session back — the person signs in afresh');
select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);
select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'owner',
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated', 'promoted');

select pg_temp.become_third();
select is(public.is_owner(), true, 'the promoted JWT is owner at once');
select lives_ok(
  $$ select count(*) from public.audit_log $$,
  'and reads the audit log');
select is(
  (select count(*) from public.list_accounts()),
  4::bigint,
  'and lists the accounts');

-- 9c. Demote again — the same JWT loses Owner capabilities.
select pg_temp.become_owner();
select set_config('test.third_version', pg_temp.version_of(current_setting('test.third_uid')::uuid)::text, true);
select is(
  (select public.set_account_role(current_setting('test.third_uid')::uuid, 'staff',
     current_setting('test.third_version')::timestamptz)) ->> 'status',
  'updated', 'demoted');

select pg_temp.become_third();
select is(public.is_owner(), false, 'the demoted JWT is not owner');
select is(public.is_staff(), true, 'but is still staff');
select throws_ok(
  $$ select * from public.list_accounts() $$,
  '42501', null,
  'and cannot list the accounts any more');
select is(
  pg_temp.rows_moved($$ update public.opening_hours set draft = '{}'::jsonb $$),
  0,
  'an Owner-only write from the demoted JWT moves zero rows');


-- ===========================================================================
-- 10. Audit hygiene, and the unrelated content
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select count(*) from public.audit_log
    where entity = 'profile'
      and (before::text ~* '(password|token|secret|key|ban)' or after::text ~* '(password|token|secret|key|ban)')),
  0::bigint,
  'no account audit row carries a secret-shaped key');

select is(
  (select array_agg(distinct action order by action) from public.audit_log where entity = 'profile'),
  array['deactivate', 'invite', 'reactivate', 'role'],
  'the account audit vocabulary is exactly invite, role, deactivate, reactivate');

select is(
  (select count(*) from public.audit_log where entity = 'profile' and actor_id is null),
  0::bigint,
  'every account audit row names its actor');

select is(pg_temp.content_state(), current_setting('test.content_before'),
  'every unrelated content table is byte-identical');

select * from finish();
rollback;
