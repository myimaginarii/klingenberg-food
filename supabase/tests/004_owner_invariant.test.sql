-- Klingenberg Food — pgTAP: the owner invariant (technical plan §4, §5 decision 11, §9).
--
-- The system must never end with zero active owners, and the rule must live in the
-- database rather than in a Server Action, so that no code path — an admin screen, a
-- migration, a psql session, a service-role script — can produce an ownerless system.
--
-- Three rejections are required: the last active owner cannot be demoted, disabled or
-- deleted. Multiple owners must stay possible, because that is how a handover happens
-- without a gap.
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED, so it normally fires at COMMIT. pgTAP
-- runs inside one transaction that is rolled back, so the tests below switch it to
-- IMMEDIATE to observe each statement's effect. The final test switches back to
-- deferred to prove the property that deferral exists for: a two-statement handover.
--
-- These tests deliberately operate on the *real* seeded owner identity, and the
-- environment starts with exactly one active owner — which is the condition the
-- invariant is about.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);
select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'the fixture starts with exactly one active owner');

-- Observe the deferred trigger statement by statement.
set constraints all immediate;


-- ===========================================================================
-- 1. The three rejections, as the superuser
-- ===========================================================================
--
-- Running these with RLS bypassed is the point: the invariant must hold even for a
-- caller that policies cannot stop. If it only held for `authenticated`, a service-role
-- script or a migration could still empty the owner set.

select throws_ok(
  $$ update public.profiles set role = 'staff'
      where user_id = current_setting('test.owner_uid')::uuid $$,
  '23514', null,
  'the last active owner cannot be demoted');

select throws_ok(
  $$ update public.profiles set disabled_at = now()
      where user_id = current_setting('test.owner_uid')::uuid $$,
  '23514', null,
  'the last active owner cannot be disabled');

select throws_ok(
  $$ delete from public.profiles
      where user_id = current_setting('test.owner_uid')::uuid $$,
  '23514', null,
  'the last active owner cannot be deleted');

-- profiles.user_id cascades from auth.users, so deleting the underlying auth user is
-- the same attack by another route. It must fail for the same reason.
select throws_ok(
  $$ delete from auth.users where id = current_setting('test.owner_uid')::uuid $$,
  '23514', null,
  'the last active owner cannot be removed by deleting their auth user');

-- After the four rejections the owner is still there, unchanged.
select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'the active owner survived every attempt');
select is(
  (select role from public.profiles where user_id = current_setting('test.owner_uid')::uuid),
  'owner',
  'the owner still holds the owner role');
select is(
  (select disabled_at from public.profiles where user_id = current_setting('test.owner_uid')::uuid),
  null,
  'the owner is still enabled');


-- ===========================================================================
-- 2. Multiple owners are permitted, and unblock every operation above
-- ===========================================================================

select lives_ok(
  $$ update public.profiles set role = 'owner'
      where user_id = current_setting('test.staff_uid')::uuid $$,
  'a second owner can be appointed');

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  2::bigint,
  'two active owners coexist');

select lives_ok(
  $$ update public.profiles set role = 'staff'
      where user_id = current_setting('test.owner_uid')::uuid $$,
  'with a second owner in place, the first can be demoted');

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'exactly one active owner remains after the demotion');

-- ... and the invariant immediately applies to the new last owner.
select throws_ok(
  $$ update public.profiles set disabled_at = now()
      where user_id = current_setting('test.staff_uid')::uuid $$,
  '23514', null,
  'the invariant follows the role: the new last owner cannot be disabled either');


-- ===========================================================================
-- 3. Why the trigger is deferred: a handover in one transaction
-- ===========================================================================
--
-- Restore the outgoing owner, then perform a real handover as a single unit of work.
-- With an immediate check the demotion would have to be ordered after the promotion by
-- hand; deferred, the transaction is simply judged on the state it commits.

update public.profiles set role = 'owner'  where user_id = current_setting('test.owner_uid')::uuid;
update public.profiles set role = 'staff'  where user_id = current_setting('test.staff_uid')::uuid;

set constraints all deferred;

-- Demote the sitting owner FIRST — the order a naive implementation would use, and the
-- order that an immediate check would reject.
update public.profiles set role = 'staff' where user_id = current_setting('test.owner_uid')::uuid;
update public.profiles set role = 'owner' where user_id = current_setting('test.staff_uid')::uuid;

select lives_ok(
  $$ set constraints all immediate $$,
  'a handover that demotes before promoting is accepted, because the check is deferred to commit');

select is(
  (select count(*) from public.profiles where role = 'owner' and disabled_at is null),
  1::bigint,
  'the handover left exactly one active owner');

select * from finish();
rollback;
