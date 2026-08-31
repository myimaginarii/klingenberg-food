-- Klingenberg Food — pgTAP: one-off opening-hours overrides (§4, §5, §6, §7b, §7e, §8, §9).
--
-- Phase 8B's own database suite. `supabase/tests/013_opening_hours.test.sql` covers the
-- **recurring weekly schedule** and stays exactly as it is; this file covers the table 8A
-- deliberately never touched, and takes over the claim 013 §7 makes about it.
--
-- Phase 8B added one migration — `20260831120000_opening_hours_override_admin.sql` — which
-- adds a `draft jsonb` column, replaces `publish_opening_hours_override`, adds
-- `remove_opening_hours_override` and replaces the `pending_changes` view. It changed **no
-- policy and no grant**, which is what makes the §5 split below a property of the database
-- rather than of the application's good manners.
--
-- What this suite asserts, from real Staff, Owner and anonymous JWTs:
--
--    1. **the unusual permission split** — Staff *may* create, edit, publish and remove a
--       one-off override, and Staff still *may not* write the normal weekly schedule, in
--       either direction. That is the §5 matrix's one row that differs between the two
--       cards on a single screen, asserted at the boundary that does not care what the
--       application believes;
--    2. **Owner may do both**, so the split widens nobody's reach;
--    3. **anonymous may do none of it** — no pending row, no `draft` column, no write, no
--       function;
--    4. **a pending override is invisible to a guest**, and publishing it makes it visible;
--    5. **a pending edit to a published override does not leak** — the guest goes on
--       reading the published answer until the publish merges the draft;
--    6. **the shape CHECK is the guarantee**: an invalid kind, a closed day carrying times,
--       a custom day missing one, and a closing at or before its opening are each refused
--       with nothing merged;
--    7. **one date, one row** — the UNIQUE refuses a duplicate;
--    8. **optimistic concurrency** — a stale token publishes nothing, removes nothing and
--       writes no audit row;
--    9. **removal** returns the date to the weekly schedule, is audited, and says whether
--       the row it removed was live;
--   10. **nothing else moved**: the recurring schedule and the announcement row are
--       byte-identical after all of it, no override owns it (8C-3A), `source` is
--       still 'manual', and no announcement function has appeared. Phase 8C is untouched.
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "a guest never reads a pending change" is the promise the model exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and staff@example.test,
-- as for 005–013.

begin;
create extension if not exists pgtap with schema extensions;

select plan(88);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;
delete from public.opening_hours_overrides;

/* The owner-confirmed week (design 1ab), restated so this suite does not depend on an
 * earlier file having left the seed alone. It is also the value every "byte-identical"
 * assertion below is measured against. */
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

update public.announcement
   set message     = 'Uberørt besked',
       expires_at  = now() + interval '2 hours',
       is_visible  = true,
       source      = 'manual',
       previous    = null,
       replaced_at = null,
       draft       = null;

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

/* Today, in the timezone the whole system reasons in (§7a). Every date below is relative
 * to it, so the suite says the same thing whenever it is run. */
create function pg_temp.today() returns date language sql stable as $fn$
  select (now() at time zone 'Europe/Copenhagen')::date
$fn$;

create function pg_temp.override_id(d date) returns uuid language sql as $fn$
  select id from public.opening_hours_overrides where date = d
$fn$;

create function pg_temp.version(d date) returns timestamptz language sql as $fn$
  select updated_at from public.opening_hours_overrides where date = d
$fn$;

/* What the row *says* — the three content columns and its status, as one string. */
create function pg_temp.row_state(d date) returns text language sql as $fn$
  select kind || ' ' || coalesce(opens_at::text, '-') || ' ' || coalesce(closes_at::text, '-')
         || ' ' || status
    from public.opening_hours_overrides where date = d
$fn$;

create function pg_temp.has_draft(d date) returns boolean language sql as $fn$
  select draft is not null from public.opening_hours_overrides where date = d
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
 * Audit rows. SECURITY DEFINER and owned by the table's owner, because `audit_log` is
 * **Owner-readable** (§5) — a staff session reads none of it, which suite 002 asserts.
 * These assertions are about what was written and by whom, not about who may read it.
 */
create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'opening_hours_override' and action = p_action and actor_id = p_actor
$fn$;

create function pg_temp.audit_total() returns bigint language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

create function pg_temp.staff_uid() returns uuid language sql as $fn$
  select current_setting('test.staff_uid')::uuid
$fn$;

create function pg_temp.owner_uid() returns uuid language sql as $fn$
  select current_setting('test.owner_uid')::uuid
$fn$;


-- ===========================================================================
-- 1. The migration added a draft column, a removal function, and nothing else
-- ===========================================================================

select has_column('public', 'opening_hours_overrides', 'draft',
  'the override table carries a draft column (phase 8B)');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_opening_hours_override'),
  false,
  'publish_opening_hours_override is SECURITY INVOKER, so RLS decides for every caller');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'remove_opening_hours_override'),
  false,
  'remove_opening_hours_override is SECURITY INVOKER too');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_functiondef(p.oid) ilike '%opening_hours_overrides%'
      and pg_get_functiondef(p.oid) !~* 'select .* from public\.opening_hours_overrides'),
  0::bigint,
  'no SECURITY DEFINER function writes public.opening_hours_overrides');

-- The four policies phase 1 wrote, unchanged. If a later phase widens one, this fails
-- rather than passing quietly.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'opening_hours_overrides'),
  5::bigint,
  'the override table still has exactly its five phase-1 policies');

select is(
  (select qual from pg_policies
    where schemaname = 'public' and tablename = 'opening_hours_overrides' and cmd = 'DELETE'),
  'is_staff()',
  'and the DELETE policy is staff-wide — the lifecycle §7e item 6 assumes');


-- ===========================================================================
-- 2. anon: no pending row, no draft column, no write, no function
-- ===========================================================================

-- Planted by the table's owner, because a staff write is what the next section proves.
insert into public.opening_hours_overrides (date, kind, status)
values (pg_temp.today() + 3, 'closed', 'draft');

select pg_temp.become_anon();

select is(
  (select count(*) from public.opening_hours_overrides),
  0::bigint,
  'a guest sees no pending override at all');

select throws_ok(
  $$ select draft from public.opening_hours_overrides $$,
  '42501', null,
  'anon cannot read opening_hours_overrides.draft');

select throws_ok(
  $$ insert into public.opening_hours_overrides (date, kind) values (current_date + 9, 'closed') $$,
  '42501', null,
  'anon cannot insert an override');

select throws_ok(
  $$ update public.opening_hours_overrides set kind = 'closed' $$,
  '42501', null,
  'anon cannot update one');

select throws_ok(
  $$ delete from public.opening_hours_overrides $$,
  '42501', null,
  'anon cannot delete one');

select throws_ok(
  $$ select public.publish_opening_hours_override(gen_random_uuid(), now()) $$,
  '42501', null,
  'anon cannot execute publish_opening_hours_override');

select throws_ok(
  $$ select public.remove_opening_hours_override(gen_random_uuid(), now()) $$,
  '42501', null,
  'anon cannot execute remove_opening_hours_override');

select throws_ok(
  $$ select * from public.pending_changes $$,
  '42501', null,
  'anon cannot read the pending-changes view');

reset role;
delete from public.opening_hours_overrides;


-- ===========================================================================
-- 3. Staff may do the whole one-off workflow — the §5 row this phase is built on
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, status)
            values (%L, 'closed', 'draft') $$, pg_temp.today() + 3),
  'a staff member may create a one-off override');

select is(pg_temp.row_state(pg_temp.today() + 3), 'closed - - draft',
  'and it is stored closed, with no times, pending');

select is(
  (select count(*) from public.pending_changes
    where entity = 'opening_hours_override' and state = 'unpublished'),
  1::bigint,
  'the pending-changes view reports it as not yet published');

select pg_temp.become_anon();
select is(
  (select count(*) from public.opening_hours_overrides),
  0::bigint,
  'and a guest still sees nothing — §6’s whole promise');

select pg_temp.become_staff();

select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 3), pg_temp.version(pg_temp.today() + 3)) ->> 'status'),
  'published',
  'a staff member may publish it');

select is(pg_temp.row_state(pg_temp.today() + 3), 'closed - - published',
  'and it is live');

select pg_temp.become_anon();
select is(
  (select kind from public.opening_hours_overrides where date = pg_temp.today() + 3),
  'closed',
  'a guest now reads the published override');

reset role;
select is(
  pg_temp.audit_count('publish', pg_temp.staff_uid()),
  1::bigint,
  'the publish wrote exactly one audit row, attributed to the staff member who pressed it');


-- ===========================================================================
-- 4. A pending edit to a **published** override does not leak (§6)
-- ===========================================================================
--
-- The state phase 8B's `draft` column exists for. The hjemmeside says "closed"; somebody
-- prepares "13:00–18:00"; the guest goes on reading "closed" until the publish merges it.

select pg_temp.become_staff();

select lives_ok(
  format($$ update public.opening_hours_overrides
               set draft = jsonb_build_object('kind', 'custom', 'opens_at', '13:00', 'closes_at', '18:00')
             where date = %L $$, pg_temp.today() + 3),
  'a staff member may write a draft onto a published override');

select is(pg_temp.row_state(pg_temp.today() + 3), 'closed - - published',
  'and the live columns are untouched by the draft');

select is(
  (select state from public.pending_changes where entity = 'opening_hours_override'),
  'draft',
  'the view now calls it a kladde rather than “not yet published”');

select pg_temp.become_anon();
select is(
  (select kind || ' ' || coalesce(opens_at::text, '-')
     from public.opening_hours_overrides where date = pg_temp.today() + 3),
  'closed -',
  'a guest still reads the published answer while the edit waits');
select throws_ok(
  $$ select draft from public.opening_hours_overrides $$,
  '42501', null,
  'and cannot read the edit that is waiting');

select pg_temp.become_staff();

select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 3), pg_temp.version(pg_temp.today() + 3)) ->> 'status'),
  'published',
  'publishing merges the draft');

select is(pg_temp.row_state(pg_temp.today() + 3), 'custom 13:00:00 18:00:00 published',
  'and the three columns now hold what the draft said');
select is(pg_temp.has_draft(pg_temp.today() + 3), false,
  'and the draft was cleared by the same statement');

select is(
  (select count(*) from public.pending_changes where entity = 'opening_hours_override'),
  0::bigint,
  'so nothing is pending any more');

select pg_temp.become_anon();
select is(
  (select opens_at::text from public.opening_hours_overrides where date = pg_temp.today() + 3),
  '13:00:00',
  'and a guest now reads the new times');

-- The other direction, which the two times make different from the first: custom → closed
-- has to *clear* two columns, which is a draft carrying JSON nulls rather than absences.
select pg_temp.become_staff();

select lives_ok(
  format($$ update public.opening_hours_overrides
               set draft = jsonb_build_object('kind', 'closed', 'opens_at', null, 'closes_at', null)
             where date = %L $$, pg_temp.today() + 3),
  'the edit back to closed is stored as a draft');

select pg_temp.become_anon();
select is(
  (select opens_at::text from public.opening_hours_overrides where date = pg_temp.today() + 3),
  '13:00:00',
  'and a guest still reads 13:00 while it waits');

select pg_temp.become_staff();
select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 3), pg_temp.version(pg_temp.today() + 3)) ->> 'status'),
  'published',
  'publishing it succeeds');
select is(pg_temp.row_state(pg_temp.today() + 3), 'closed - - published',
  'and a JSON null in the draft clears the column, as `draft ? key` requires');

reset role;
delete from public.opening_hours_overrides;
delete from public.audit_log;


-- ===========================================================================
-- 5. Staff still cannot touch the recurring weekly schedule (§5)
-- ===========================================================================
--
-- The other half of the split, asserted in the same file as the half that grants it — so
-- a future change that widens one is measured against the other in one place.

select pg_temp.become_staff();

select is(
  pg_temp.rows_affected(
    $$ update public.opening_hours set draft = jsonb_build_object('schedule', '{}'::jsonb) $$),
  0::bigint,
  'a staff member who may write an override still cannot draft the weekly schedule');

select is(
  pg_temp.rows_affected(
    $$ update public.opening_hours set schedule = pg_temp.confirmed_schedule() $$),
  0::bigint,
  'nor write it directly');

select is(
  (select h.schedule = pg_temp.confirmed_schedule() from public.opening_hours h),
  true,
  'and the weekly schedule is byte-identical after both refusals');

select is(
  (select draft is null from public.opening_hours),
  true,
  'with no draft on it');


-- ===========================================================================
-- 6. The shape CHECK is the guarantee, not the editor's good manners
-- ===========================================================================

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind) values (%L, 'holiday') $$,
         pg_temp.today() + 5),
  '23514', null,
  'an invalid kind is refused');

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at)
            values (%L, 'closed', '13:00', '18:00') $$, pg_temp.today() + 5),
  '23514', null,
  'a closed override carrying times is refused — which is why the editor stores none');

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at)
            values (%L, 'custom', '13:00') $$, pg_temp.today() + 5),
  '23514', null,
  'a custom override missing its closing time is refused');

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at)
            values (%L, 'custom', '18:00', '13:00') $$, pg_temp.today() + 5),
  '23514', null,
  'a closing time before its opening is refused');

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at)
            values (%L, 'custom', '22:00', '02:00') $$, pg_temp.today() + 5),
  '23514', null,
  'and so is an overnight range — the engine relies on hours never crossing midnight');

select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, status) values (%L, 'closed', 'live') $$,
         pg_temp.today() + 5),
  '23514', null,
  'an invalid status is refused');

-- The same guarantee on the way *out* of a draft: a draft that would break the shape is
-- refused by the merge, with nothing written.
select lives_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
            values (%L, 'custom', '13:00', '18:00', 'published') $$, pg_temp.today() + 5),
  'a published custom override is created for the merge tests');

select lives_ok(
  format($$ update public.opening_hours_overrides set draft = jsonb_build_object('kind', 'closed')
             where date = %L $$, pg_temp.today() + 5),
  'a draft that names only the kind can be stored');

select throws_ok(
  format($$ select public.publish_opening_hours_override(%L::uuid, %L::timestamptz) $$,
         pg_temp.override_id(pg_temp.today() + 5), pg_temp.version(pg_temp.today() + 5)),
  '23514', null,
  'but publishing it is refused by the shape CHECK — closed may carry no times');

select is(pg_temp.row_state(pg_temp.today() + 5), 'custom 13:00:00 18:00:00 published',
  'and nothing was merged');

reset role;
delete from public.opening_hours_overrides;
delete from public.audit_log;


-- ===========================================================================
-- 7. One date, one row
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, status)
            values (%L, 'closed', 'draft') $$, pg_temp.today() + 7),
  'the first override for a date is created');

-- A second row that is *otherwise valid*, so the UNIQUE is what refuses it rather than the
-- shape CHECK getting there first.
select throws_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
            values (%L, 'custom', '13:00', '18:00', 'draft') $$, pg_temp.today() + 7),
  '23505', null,
  'a second override for the same date is refused by the UNIQUE — never two answers');

select is(
  (select count(*) from public.opening_hours_overrides where date = pg_temp.today() + 7),
  1::bigint,
  'so the date still has exactly one');


-- ===========================================================================
-- 8. Optimistic concurrency (§6, §7e item 2)
-- ===========================================================================

select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 7), now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token refuses the publish');

select is(pg_temp.row_state(pg_temp.today() + 7), 'closed - - draft',
  'and the row is exactly as it was');

select is(
  (select public.remove_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 7), now() - interval '1 day') ->> 'status'),
  'conflict',
  'and a stale token refuses the removal too');

select is(
  (select count(*) from public.opening_hours_overrides where date = pg_temp.today() + 7),
  1::bigint,
  'with the row still there');

reset role;
select is(pg_temp.audit_total(), 0::bigint,
  'not one refused attempt wrote an audit row');


-- ===========================================================================
-- 9. Removal — the date goes back to the weekly schedule (§7e item 6)
-- ===========================================================================

select pg_temp.become_staff();

-- (a) A pending override: nothing public moves.
select is(
  (select public.remove_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 7), pg_temp.version(pg_temp.today() + 7)) ->> 'was_published'),
  'false',
  'removing a pending override reports that nothing was live');

select is(
  (select count(*) from public.opening_hours_overrides where date = pg_temp.today() + 7),
  0::bigint,
  'and the row is gone, so the date follows the normal week again');

-- (b) A published one: the answer says so, which is what the cache rule keys off.
select lives_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, status)
            values (%L, 'closed', 'published') $$, pg_temp.today() + 8),
  'a published override is created');

select is(
  (select public.remove_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 8), pg_temp.version(pg_temp.today() + 8)) ->> 'was_published'),
  'true',
  'removing a published override reports that a guest’s answer just changed');

select pg_temp.become_anon();
select is(
  (select count(*) from public.opening_hours_overrides),
  0::bigint,
  'and the guest reads no override for that date any more');

reset role;
select is(pg_temp.audit_count('delete', pg_temp.staff_uid()), 2::bigint,
  'both removals wrote an audit row, attributed to the staff member');

select is(
  (select before ->> 'kind' from public.audit_log
    where entity = 'opening_hours_override' and action = 'delete'
    order by created_at desc limit 1),
  'closed',
  'and the audit row records what was removed');

select pg_temp.become_staff();
select is(
  (select public.remove_opening_hours_override(gen_random_uuid(), now()) ->> 'status'),
  'not_found',
  'removing something that is not there says so rather than pretending');

reset role;
delete from public.audit_log;


-- ===========================================================================
-- 10. Owner may do all of it too
-- ===========================================================================

select pg_temp.become_owner();

select lives_ok(
  format($$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
            values (%L, 'custom', '11:00', '14:00', 'draft') $$, pg_temp.today() + 10),
  'an owner may create a one-off override');

select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 10), pg_temp.version(pg_temp.today() + 10)) ->> 'status'),
  'published',
  'and publish it');

select is(
  (select public.publish_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 10), pg_temp.version(pg_temp.today() + 10)) ->> 'status'),
  'nothing_to_publish',
  'publishing it again says there is nothing waiting');

select is(
  (select public.remove_opening_hours_override(
     pg_temp.override_id(pg_temp.today() + 10), pg_temp.version(pg_temp.today() + 10)) ->> 'status'),
  'removed',
  'and remove it');

reset role;
select is(pg_temp.audit_count('publish', pg_temp.owner_uid()), 1::bigint,
  'the owner’s publish is attributed to the owner');
select is(pg_temp.audit_count('delete', pg_temp.owner_uid()), 1::bigint,
  'and so is the owner’s removal');

delete from public.audit_log;


-- ===========================================================================
-- 11. A past override is invisible to a guest (§7e item 7)
-- ===========================================================================
--
-- The application refuses to *create* one; the policy refuses to *serve* one. Both, so
-- neither is the only thing keeping a meaningless row off the hjemmeside.

insert into public.opening_hours_overrides (date, kind, status)
values (pg_temp.today() - 1, 'closed', 'published');

select pg_temp.become_anon();
select is(
  (select count(*) from public.opening_hours_overrides),
  0::bigint,
  'a published override dated yesterday is not served to a guest');

reset role;

insert into public.opening_hours_overrides (date, kind, status)
values (pg_temp.today(), 'closed', 'published');

select pg_temp.become_anon();
select is(
  (select count(*) from public.opening_hours_overrides),
  1::bigint,
  'but one dated today is — “Ret kun i dag” is the case the feature is named after');

reset role;
delete from public.opening_hours_overrides;
delete from public.audit_log;


-- ===========================================================================
-- 12. Nothing else moved — the recurring week, and phase 8C
-- ===========================================================================

select is(
  (select h.schedule = pg_temp.confirmed_schedule() from public.opening_hours h),
  true,
  'the recurring weekly schedule is byte-identical after this entire suite');

select is((select draft is null from public.opening_hours), true,
  'and carries no draft — nothing in phase 8B writes it');

select is((select message from public.announcement), 'Uberørt besked',
  'the announcement is untouched — phase 8B generates no message');
select is((select source from public.announcement), 'manual',
  'and `source` is still manual, as phase 7 left it');
select is((select previous from public.announcement), null,
  'and `previous` is still null');
select is((select replaced_at from public.announcement), null,
  'and `replaced_at` is still null');
select is((select is_visible from public.announcement), true,
  'and the bar is still shown');

select is(
  (select count(*) from public.audit_log where entity = 'announcement'),
  0::bigint,
  'nothing in this suite wrote an announcement audit row');

/*
 * Phase 8C-1 built `replace_announcement` and `restore_announcement`. The assertions
 * above are what still holds: **no override path calls either of them**, the message,
 * `source`, `previous`, `replaced_at` and `is_visible` are all as this suite found
 * them, and the announcement wrote no audit row at all. The one thing asserted here is
 * that the mechanism 8C-3 will eventually reach from this screen is present and idle.
 */
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('replace_announcement', 'restore_announcement')),
  2::bigint,
  'the 8C-1 replacement mechanism exists — and nothing in phase 8B reaches it');

/*
 * `announcement_created` was §4's column for the generated opening-hours message, and
 * phase 8B wrote it nowhere. **Phase 8C-3A dropped it**: ownership is now one pointer,
 * `announcement.source_override_id`, on the announcement row rather than a boolean per
 * override — see `20260831180000_generated_announcement_ownership.sql` for why.
 *
 * So the assertion is stronger than it was. The column is gone, and no override in this
 * suite owns the announcement: every one of them was created, published, edited and
 * removed by the phase-8B path, which writes no announcement at all.
 */
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'opening_hours_overrides'
      and column_name = 'announcement_created'),
  0::bigint,
  'announcement_created no longer exists — 8C-3A replaced it with announcement.source_override_id');

select is(
  (select count(*) from public.announcement where source_override_id is not null),
  0::bigint,
  'and no override owns the announcement: nothing in phase 8B''s path can make one');

/*
 * Exactly one opening-hours function names the announcement table, and 8C-3A is why:
 * `remove_opening_hours_override()` asks whether the date still owns the generated
 * message before it deletes anything, and refuses with `owns_announcement` if it does
 * (§7e item 6). That is a **read**, and the two assertions below are what say so —
 * the name, and the absence of any write statement against the table in any of them.
 * Deciding what to offer instead of the refusal is 8C-3B's.
 */
select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and pg_get_functiondef(p.oid) ilike '%public.announcement%'
        and p.proname like '%opening_hours%' $$,
  array['remove_opening_hours_override'],
  'exactly one opening-hours function names the announcement table — the removal, to refuse itself');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%opening_hours%'
      and pg_get_functiondef(p.oid) ~* '(update|insert\s+into|delete\s+from)\s+public\.announcement'),
  0::bigint,
  'and no opening-hours function writes to it — the announcement is read, never moved, from this side');


select * from finish();
rollback;
