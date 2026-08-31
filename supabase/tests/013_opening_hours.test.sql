-- Klingenberg Food — pgTAP: the normal weekly opening hours (§4, §5, §6, §7, §8, §9).
--
-- Phase 8A added **no migration**. The table, its shape check, its RLS policies, its
-- publish function and the `pending_changes` view have all existed since phases 1 and 4,
-- and this suite exists to assert — from real Owner, Staff and anonymous JWTs — that the
-- properties the new editor relies on are the ones the database actually enforces:
--
--    1. **Owner may draft and publish**; the draft is written by an ordinary UPDATE
--       through the owner's own JWT, and the publish is `public.publish_opening_hours`;
--    2. **Staff may not**, in either direction — not the draft, not the live schedule, and
--       not the publish — and a refused attempt changes nothing and logs nothing. That is
--       the §5 matrix row this whole phase is built around, asserted at the boundary that
--       does not care what the application believes;
--    3. **anonymous may not** read the draft, write anything or execute the publish;
--    4. a draft is **invisible to a guest** until a publish, and publishing applies it;
--    5. a **malformed draft cannot be published** — a day with no closing time, a closing
--       time before its opening, an unknown weekday and a closed day carrying times are
--       each refused by the CHECK, with nothing merged and nothing cleared;
--    6. a stale version token writes nothing;
--    7. a publish writes exactly one audit row, attributed to whoever pressed it;
--    8. **no SECURITY DEFINER path exists** to the weekly schedule. `publish_opening_hours`
--       is SECURITY INVOKER, and there is no `set_opening_hours`, no
--       `update_opening_hours` and no other definer function that could write the table on
--       a staff caller's behalf — which is what makes assertion 2 a property of the system
--       rather than of the application's good manners;
--    9. **the one-off override table is untouched** by everything above, and so is the
--       **announcement**.
--
-- Assertion 9 has been read two ways, and only one of them is still true. When this suite
-- was written, phase 8B did not exist and nothing in the application wrote
-- `opening_hours_overrides` at all. **Phase 8B now owns that table**, and its own suite —
-- `014_opening_hours_overrides.test.sql` — is where it is exercised, including the §5 split
-- that lets a *staff* member write an override while still refusing them the recurring
-- week. What §7 below asserts is the narrower and still-correct claim it was always making:
-- **the weekly schedule's own editor cannot reach an override**, which is why the row it
-- plants is byte-identical after every draft, publish and refusal above it.
--
-- The **announcement** half of assertion 9 is unchanged and still whole: the generated
-- opening-hours message, `source='opening_hours'`, `previous`, `replaced_at` and 1ae's
-- conflict sheet are **phase 8C**, and neither 8A nor 8B goes near any of them.
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "a guest never reads a draft" is the promise the draft model exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and staff@example.test,
-- as for 005–012.

begin;
create extension if not exists pgtap with schema extensions;

select plan(65);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;

/*
 * The owner-confirmed week (design 1ab, seeded by supabase/seed.sql), restated here so
 * the suite does not depend on the seed having been left alone by an earlier file.
 */
create function pg_temp.confirmed_schedule() returns jsonb language sql immutable as $fn$
  select jsonb_build_object(
    'mon', jsonb_build_object('closed', true),
    'tue', jsonb_build_object('closed', true),
    'wed', jsonb_build_object('from', '15:00', 'to', '20:00'),
    'thu', jsonb_build_object('from', '15:00', 'to', '20:00'),
    'fri', jsonb_build_object('from', '15:00', 'to', '20:00'),
    'sat', jsonb_build_object('from', '17:00', 'to', '20:00'),
    'sun', jsonb_build_object('from', '17:00', 'to', '20:00'))
$fn$;

update public.opening_hours set schedule = pg_temp.confirmed_schedule(), draft = null;

-- One published override and one announcement, so "untouched" is a claim with something
-- behind it rather than a claim about two empty tables.
insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
values (current_date + 30, 'custom', '12:00', '14:00', 'published');

update public.announcement
   set message    = 'Uberørt besked',
       expires_at = now() + interval '2 hours',
       is_visible = true,
       source     = 'manual',
       previous   = null,
       replaced_at = null,
       draft      = null;

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

create function pg_temp.become(uid text, email text)
returns void
language plpgsql
as $fn$
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

create function pg_temp.become_anon()
returns void
language plpgsql
as $fn$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$fn$;

/* The one row, whoever is asking. `opening_hours` is a singleton (§4). */
create function pg_temp.hours_id() returns uuid language sql as $fn$
  select id from public.opening_hours limit 1
$fn$;

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.opening_hours limit 1
$fn$;

/* One day of the **live** schedule — what a guest reads. */
create function pg_temp.live_day(day text, part text) returns text language sql as $fn$
  select h.schedule -> day ->> part from public.opening_hours h limit 1
$fn$;

/* One day of the stored **draft** — what the administration shows and a guest must not. */
create function pg_temp.draft_day(day text, part text) returns text language sql as $fn$
  select h.draft -> 'schedule' -> day ->> part from public.opening_hours h limit 1
$fn$;

create function pg_temp.has_draft() returns boolean language sql as $fn$
  select draft is not null from public.opening_hours limit 1
$fn$;

/* How many rows an attempted write actually changed, whatever RLS decided. */
create function pg_temp.rows_affected(statement text)
returns bigint
language plpgsql
as $fn$
declare affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

/*
 * Audit rows, by action and actor.
 *
 * SECURITY DEFINER, and owned by the role that owns the table, because `audit_log` is
 * **Owner-readable** (§5) — a staff session reads none of it, which suite 002 asserts.
 * These assertions are about what was *written* and to whom, not about who may read it.
 */
create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'opening_hours' and action = p_action and actor_id = p_actor
$fn$;

create function pg_temp.audit_total() returns bigint language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

/* Restore the fixture between the destructive sections. */
create function pg_temp.reset_fixture() returns void language sql security definer set search_path = '' as $fn$
  update public.opening_hours set schedule = pg_temp.confirmed_schedule(), draft = null;
$fn$;

/* A schedule with one weekday changed, for the ordinary happy path. */
create function pg_temp.wednesday_at(opens text) returns jsonb language sql as $fn$
  select jsonb_set(pg_temp.confirmed_schedule(), '{wed}',
    jsonb_build_object('from', opens, 'to', '20:00'))
$fn$;


-- ===========================================================================
-- 1. anon reads the live schedule, and nothing else (§4, §5, §8)
-- ===========================================================================

select pg_temp.become_anon();

select is(
  (select count(*) from public.opening_hours),
  1::bigint,
  'anon can read the one opening-hours row');

select is(pg_temp.live_day('wed', 'from'), '15:00',
  'anon reads the published Wednesday opening time');

select throws_ok(
  $$ select draft from public.opening_hours $$,
  '42501', null,
  'anon cannot read opening_hours.draft');

select throws_ok(
  $$ update public.opening_hours set schedule = schedule $$,
  '42501', null,
  'anon cannot update the opening hours — it holds no UPDATE grant at all');

select throws_ok(
  $$ select public.publish_opening_hours(
       (select id from public.opening_hours), now()) $$,
  '42501', null,
  'anon cannot execute publish_opening_hours');


-- ===========================================================================
-- 2. Staff may look and may not touch — the §5 matrix row, at the boundary
-- ===========================================================================

select pg_temp.become_staff();

select is(pg_temp.live_day('wed', 'from'), '15:00',
  'staff can read the weekly schedule — the admin shows it on other screens');

select is(
  pg_temp.rows_affected(
    $$ update public.opening_hours set draft = jsonb_build_object('schedule', '{}'::jsonb) $$),
  0::bigint,
  'staff cannot write an opening-hours draft');

select is(
  pg_temp.rows_affected(
    $$ update public.opening_hours set schedule = pg_temp.wednesday_at('09:00') $$),
  0::bigint,
  'staff cannot write the live weekly schedule directly, bypassing the editor');

select is(pg_temp.has_draft(), false, 'and no draft appeared from the refused staff write');
select is(pg_temp.live_day('wed', 'from'), '15:00',
  'and the published Wednesday is exactly as it was');

select throws_ok(
  $$ delete from public.opening_hours $$,
  '42501', null,
  'staff cannot delete the opening-hours singleton — the table has no DELETE grant');

select throws_ok(
  $$ insert into public.opening_hours (schedule)
     values (pg_temp.confirmed_schedule()) $$,
  '42501', null,
  'staff cannot insert a second opening-hours row');

/*
 * A draft has to exist for the publish to reach its permission check at all —
 * `publish_opening_hours` answers `nothing_to_publish` before anything else when there is
 * none. It is planted here by the table's owner rather than by staff, because staff
 * writing one is the thing the assertion above just proved impossible.
 */
reset role;
update public.opening_hours
   set draft = jsonb_build_object('schedule', pg_temp.wednesday_at('09:00'));

select pg_temp.become_staff();

select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status'
     from public.opening_hours h),
  'forbidden',
  'staff cannot publish the normal weekly opening hours');

select is(pg_temp.live_day('wed', 'from'), '15:00',
  'and the refused publish left the live Wednesday alone');

reset role;
update public.opening_hours set draft = null;

select is(pg_temp.audit_total(), 0::bigint,
  'not one refused staff attempt wrote an audit row');


-- ===========================================================================
-- 3. Owner drafts, a guest sees nothing, Owner publishes (§6)
-- ===========================================================================

select pg_temp.become_owner();

select lives_ok(
  $$ update public.opening_hours
        set draft = jsonb_build_object('schedule', pg_temp.wednesday_at('16:00')) $$,
  'the owner may write an opening-hours draft');

select is(pg_temp.draft_day('wed', 'from'), '16:00', 'the draft holds the new Wednesday');
select is(pg_temp.live_day('wed', 'from'), '15:00',
  'and the live schedule is untouched by the draft — the whole point of §6');

select is(
  (select count(*) from public.pending_changes where entity = 'opening_hours'),
  1::bigint,
  'the pending-changes view reports it, so the screen and the dashboard agree');

select pg_temp.become_anon();

select is(pg_temp.live_day('wed', 'from'), '15:00',
  'a guest still reads the published Wednesday while the draft waits');
select throws_ok($$ select draft from public.opening_hours $$, '42501', null,
  'and still cannot read the draft that is waiting');

select pg_temp.become_staff();
select is(
  (select count(*) from public.pending_changes where entity = 'opening_hours'),
  1::bigint,
  'staff can see that the hours have a pending change — that is how the dashboard says who is waiting');
select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status'
     from public.opening_hours h),
  'forbidden',
  'but still cannot publish it');
select is(pg_temp.live_day('wed', 'from'), '15:00',
  'and the refused publish changed nothing');
select is(pg_temp.draft_day('wed', 'from'), '16:00', 'and left the draft for the owner');

select pg_temp.become_owner();

select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status'
     from public.opening_hours h),
  'published',
  'the owner can publish the opening hours');

select is(pg_temp.live_day('wed', 'from'), '16:00', 'and the new Wednesday is now live');
select is(pg_temp.has_draft(), false, 'and the draft was cleared by the publish');

select pg_temp.become_anon();
select is(pg_temp.live_day('wed', 'from'), '16:00', 'a guest now reads the new Wednesday');

reset role;
select is(
  pg_temp.audit_count('publish', (select id from auth.users where email = 'owner@example.test')),
  1::bigint,
  'the publish wrote exactly one audit row, attributed to the owner who pressed it');
select is(pg_temp.audit_total(), 1::bigint, 'and nothing else wrote one');

select is(
  (select after -> 'schedule' -> 'wed' ->> 'from' from public.audit_log
    where entity = 'opening_hours' limit 1),
  '16:00',
  'and the audit row records what went live');


-- ===========================================================================
-- 4. A stale version token, and an empty publish
-- ===========================================================================

select pg_temp.become_owner();
select lives_ok(
  $$ update public.opening_hours
        set draft = jsonb_build_object('schedule', pg_temp.wednesday_at('17:00')) $$,
  'a second draft is written');

select is(
  (select public.publish_opening_hours(pg_temp.hours_id(), now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token is refused');
select is(pg_temp.live_day('wed', 'from'), '16:00', 'and the stale publish changed nothing');
select is(pg_temp.draft_day('wed', 'from'), '17:00', 'and left the draft alone');

reset role;
update public.opening_hours set draft = null;

select pg_temp.become_owner();
select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status'
     from public.opening_hours h),
  'nothing_to_publish',
  'publishing with no draft says so rather than pretending to succeed');

reset role;
select pg_temp.reset_fixture();
delete from public.audit_log;


-- ===========================================================================
-- 5. A malformed draft cannot be published (§4's shape CHECK)
-- ===========================================================================
--
-- Each of these is a document the *editor* refuses with a Danish sentence before it ever
-- reaches the database. They are asserted here as well, because the editor's refusal is a
-- courtesy and the CHECK is the guarantee: the merge itself must be impossible.

select pg_temp.become_owner();

-- --- a day with no closing time ---
select lives_ok(
  $$ update public.opening_hours
        set draft = jsonb_build_object('schedule',
              jsonb_set(pg_temp.confirmed_schedule(), '{wed}',
                jsonb_build_object('from', '15:00'))) $$,
  'a draft naming an open day with no closing time can be stored');

select throws_ok(
  $$ select public.publish_opening_hours(h.id, h.updated_at) from public.opening_hours h $$,
  '23514', null,
  'but publishing it is refused by the schedule CHECK');
select is(pg_temp.live_day('wed', 'from'), '15:00', 'and nothing was merged');

-- --- closing before opening, which is also the overnight case ---
reset role;
update public.opening_hours
   set draft = jsonb_build_object('schedule',
         jsonb_set(pg_temp.confirmed_schedule(), '{fri}',
           jsonb_build_object('from', '22:00', 'to', '02:00')));

select pg_temp.become_owner();
select throws_ok(
  $$ select public.publish_opening_hours(h.id, h.updated_at) from public.opening_hours h $$,
  '23514', null,
  'an overnight opening is refused — the engine relies on hours never crossing midnight');

-- --- an unknown weekday ---
reset role;
update public.opening_hours
   set draft = jsonb_build_object('schedule',
         pg_temp.confirmed_schedule() || jsonb_build_object('holiday', jsonb_build_object('closed', true)));

select pg_temp.become_owner();
select throws_ok(
  $$ select public.publish_opening_hours(h.id, h.updated_at) from public.opening_hours h $$,
  '23514', null,
  'an unknown weekday key is refused');

-- --- a missing weekday ---
reset role;
update public.opening_hours
   set draft = jsonb_build_object('schedule', pg_temp.confirmed_schedule() - 'sun');

select pg_temp.become_owner();
select throws_ok(
  $$ select public.publish_opening_hours(h.id, h.updated_at) from public.opening_hours h $$,
  '23514', null,
  'a missing weekday key is refused');

-- --- a closed day carrying times ---
reset role;
update public.opening_hours
   set draft = jsonb_build_object('schedule',
         jsonb_set(pg_temp.confirmed_schedule(), '{mon}',
           jsonb_build_object('closed', true, 'from', '15:00', 'to', '20:00')));

select pg_temp.become_owner();
select throws_ok(
  $$ select public.publish_opening_hours(h.id, h.updated_at) from public.opening_hours h $$,
  '23514', null,
  'a closed day carrying times is refused — which is why the editor stores none');

reset role;
select is(pg_temp.live_day('mon', 'closed'), 'true',
  'after five refused publishes the live Monday is still closed');
select is(pg_temp.live_day('sun', 'from'), '17:00',
  'and the live Sunday is still the seeded one');
select is(pg_temp.audit_total(), 0::bigint, 'and not one of them wrote an audit row');

select pg_temp.reset_fixture();


-- ===========================================================================
-- 6. No SECURITY DEFINER path to the weekly schedule (§8)
-- ===========================================================================
--
-- Assertion 2 is only a property of the system if there is no function that would perform
-- the write with somebody else's privileges. `publish_opening_hours` is the only function
-- that writes this table, and it is SECURITY INVOKER — so RLS decides, every time, against
-- the caller's own JWT.

select is(
  (select prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_opening_hours'),
  false,
  'publish_opening_hours is SECURITY INVOKER, so RLS decides for every caller');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_functiondef(p.oid) ilike '%update public.opening_hours%'),
  0::bigint,
  'no SECURITY DEFINER function writes public.opening_hours');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_opening_hours', 'update_opening_hours', 'save_opening_hours')),
  0::bigint,
  'and phase 8A added no immediate-path function for the weekly schedule');

-- The one UPDATE policy on the table, and its condition. Phase 8A neither added a policy
-- nor widened one; if a later phase does, this fails rather than passing quietly.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'opening_hours' and cmd = 'UPDATE'),
  1::bigint,
  'opening_hours has exactly one UPDATE policy');

select is(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'opening_hours' and cmd = 'UPDATE'),
  'is_owner()',
  'and it is owner-only');


-- ===========================================================================
-- 7. Phase 8B and the announcement are untouched (§4, §7e, phase boundaries)
-- ===========================================================================

select is(
  (select count(*) from public.opening_hours_overrides),
  1::bigint,
  'the one-off override table still holds exactly the row this suite created');

select is(
  (select kind || ' ' || coalesce(opens_at::text, '-') || ' ' || status
     from public.opening_hours_overrides),
  'custom 12:00:00 published',
  'and that row is byte-for-byte what it was — the weekly editor writes no override');

/*
 * Phase 8B gave the table a `draft` column. The weekly editor cannot write it either: this
 * suite's every draft, publish and refusal above went to `public.opening_hours`, and the
 * override planted in the fixtures still carries nothing pending.
 */
select is(
  (select draft is null from public.opening_hours_overrides),
  true,
  'and it carries no pending edit — nothing on the weekly card can write one');

select is(
  (select message from public.announcement),
  'Uberørt besked',
  'the announcement is untouched — no generated opening-hours message exists yet');

select is((select source from public.announcement), 'manual',
  'and `source` is still manual, as phase 7 left it');
select is((select previous from public.announcement), null,
  'and `previous` is still null');
select is((select replaced_at from public.announcement), null,
  'and `replaced_at` is still null');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('replace_announcement', 'restore_announcement')),
  0::bigint,
  'and no replacement or restore function has appeared — that is a later phase 8 increment');

select is(
  (select count(*) from public.audit_log where entity = 'announcement'),
  0::bigint,
  'nothing in this suite wrote an announcement audit row');


-- ===========================================================================
-- 8. The singleton stays a singleton
-- ===========================================================================

select pg_temp.become_owner();

select throws_ok(
  $$ insert into public.opening_hours (schedule) values (pg_temp.confirmed_schedule()) $$,
  '42501', null,
  'not even the owner may insert a second opening-hours row');

select throws_ok(
  $$ delete from public.opening_hours $$,
  '42501', null,
  'and not even the owner may delete the one there is');

select is((select count(*) from public.opening_hours), 1::bigint,
  'so there is still exactly one weekly schedule');


select * from finish();
rollback;
