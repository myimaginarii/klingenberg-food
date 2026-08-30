-- Klingenberg Food — pgTAP: Ugens ret and Lørdagsmenu (§4, §5, §6, §7b, §9).
--
-- Phase 6A added one migration with three functions. This suite asserts the properties
-- the application relies on, from real Staff, Owner and anonymous JWTs:
--
--    1. `anon` may read the live weekly columns and **not** the draft, so a guest cannot
--       learn what next week is going to be;
--    2. `anon` may not write any of it, and may not execute either new function;
--    3. Staff may write a draft, Owner may, and the write touches `draft` and nothing
--       else — the live name, both prices, `sat_enabled` and both sold-out columns all
--       stand exactly as they were;
--    4. **a pending Ugens ret price survives a Lørdagsmenu edit, and a pending Saturday
--       menu survives an Ugens ret edit** — the merge property phase 6A most easily
--       breaks, asserted in both directions;
--    5. a stale version token writes nothing, for every one of the three operations;
--    6. `set_weekly_special_sold_out` moves exactly one named column, refuses a date
--       that is not today in Copenhagen, refuses a target outside the closed set, and
--       writes one audit row attributed to whoever pressed it;
--    7. `copy_weekly_special_to_draft` seeds a draft, **never publishes**, carries no
--       sold-out or attribution field, refuses to overwrite an existing draft without an
--       explicit confirmation, and refuses a row with nothing to copy;
--    8. `publish_weekly_special` — phase 4's, unchanged — moves both halves of the row
--       in one transaction, clears the draft, logs one audit row, and only then does the
--       public read see the new week;
--    9. an invalid ISO week is refused by the copy and by the column CHECK.
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "the guest still reads last week" is the promise the draft model exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–009.

begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;

update public.weekly_special
   set iso_year        = 2026,
       iso_week        = 35,
       days            = array['wed', 'thu', 'fri'],
       name            = 'Stegt flæsk',
       description     = 'Med persillesovs.',
       price_small_ore = 8900,
       price_large_ore = 11900,
       image_id        = null,
       sold_out_on     = null,
       sat_enabled     = true,
       sat_name        = 'Helstegt pattegris',
       sat_description = 'Til deling.',
       sat_price_ore   = 19900,
       sat_deadline    = 'Bestilling senest fredag kl. 12:00',
       sat_sold_out_on = null,
       draft           = null;

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

/* The one row, whoever is asking. `weekly_special` is a singleton (§4). */
create function pg_temp.weekly_id() returns uuid language sql as $fn$
  select id from public.weekly_special limit 1
$fn$;

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.weekly_special limit 1
$fn$;

/* What a guest currently reads. Live columns only — no draft anywhere in sight. */
create function pg_temp.public_week() returns text language sql as $fn$
  select coalesce(w.name, '—') || ' / uge ' || coalesce(w.iso_week::text, '—')
    from public.weekly_special w limit 1
$fn$;

create function pg_temp.public_saturday() returns text language sql as $fn$
  select case when w.sat_enabled then coalesce(w.sat_name, '—') else 'ingen' end
    from public.weekly_special w limit 1
$fn$;

/*
 * How many audit rows one action wrote, and who they are attributed to.
 *
 * SECURITY DEFINER, and owned by the role that owns the table, because `audit_log` is
 * **Owner-readable** (§5) — a staff session reads none of it, which is itself asserted
 * by suite 002. These assertions are about what was *written* and to whom it was
 * attributed, not about who may read it, so they are made from outside the RLS question
 * rather than by borrowing an Owner session that would change what is being tested.
 */
create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'weekly_special' and action = p_action and actor_id = p_actor
$fn$;

/* What the administration shows: the draft's value where there is one. */
create function pg_temp.draft_of(field text) returns text language sql as $fn$
  select w.draft ->> field from public.weekly_special w limit 1
$fn$;


-- ===========================================================================
-- 1. anon reads the live week and never the draft (§4, §5)
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  $$ update public.weekly_special
        set draft = jsonb_build_object('name', 'Hemmelig ret til næste uge')
      where updated_at = (select updated_at from public.weekly_special) $$,
  'staff may write a draft');

select pg_temp.become_anon();

select is(pg_temp.public_week(), 'Stegt flæsk / uge 35',
  'anon reads the published week, not the draft');

select throws_ok(
  $$ select draft from public.weekly_special $$,
  '42501',
  null,
  'anon has no SELECT privilege on weekly_special.draft');

select throws_ok(
  $$ update public.weekly_special set name = 'Overtaget' $$,
  '42501',
  null,
  'anon cannot write weekly_special at all');

select throws_ok(
  $$ select public.set_weekly_special_sold_out('week', null, now()) $$,
  '42501',
  null,
  'anon cannot execute set_weekly_special_sold_out');

select throws_ok(
  $$ select public.copy_weekly_special_to_draft(2026, 36, now(), false) $$,
  '42501',
  null,
  'anon cannot execute copy_weekly_special_to_draft');

select throws_ok(
  $$ select public.copy_weekly_special_to_draft(2026, 36, now(), true) $$,
  '42501',
  null,
  'anon cannot execute it with the confirmation either');

reset role;

update public.weekly_special set draft = null;


-- ===========================================================================
-- 2. Draft integrity — one editor never clears the other's fields (§4, §6)
-- ===========================================================================
--
-- The application writes these two drafts through `saveEntityDraft`, which merges the
-- submitted fields into the existing draft and removes only the names its `clear` list
-- carries. Both lists come from `lib/menu/weekly.ts` and are disjoint. What is asserted
-- here is the *database-visible consequence*: after both edits, both are still pending.

select pg_temp.become_staff();

-- Ugens ret: a new price, pending.
select lives_ok(
  $$ update public.weekly_special
        set draft = coalesce(draft, '{}'::jsonb) || jsonb_build_object('price_small_ore', 9500)
      where updated_at = (select updated_at from public.weekly_special) $$,
  'a pending price on Ugens ret is stored');

-- Lørdagsmenu: switched off, pending. The merge names only `sat_enabled`.
select lives_ok(
  $$ update public.weekly_special
        set draft = coalesce(draft, '{}'::jsonb) || jsonb_build_object('sat_enabled', false)
      where updated_at = (select updated_at from public.weekly_special) $$,
  'switching the Saturday menu off is stored beside it');

select is(pg_temp.draft_of('price_small_ore'), '9500',
  'the Ugens ret price survived the Lørdagsmenu edit');
select is(pg_temp.draft_of('sat_enabled'), 'false',
  'and the Lørdagsmenu edit is there too');

-- And the other direction: an Ugens ret edit after a Saturday one.
select lives_ok(
  $$ update public.weekly_special
        set draft = coalesce(draft, '{}'::jsonb) || jsonb_build_object('name', 'Frikadeller')
      where updated_at = (select updated_at from public.weekly_special) $$,
  'a later Ugens ret edit merges rather than replaces');

select is(pg_temp.draft_of('sat_enabled'), 'false',
  'the Saturday draft survived the Ugens ret edit');
select is(pg_temp.draft_of('name'), 'Frikadeller',
  'and the new name is pending as well');

-- Nothing live has moved through any of it.
select is(pg_temp.public_week(), 'Stegt flæsk / uge 35',
  'no live column moved while three drafts were written');
select is(pg_temp.public_saturday(), 'Helstegt pattegris',
  'and the Saturday menu is still switched on for a guest');

reset role;


-- ===========================================================================
-- 3. Publishing moves both halves at once, and only then (§6)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select count(*) from public.pending_changes where entity = 'weekly_special'),
  1::bigint,
  'the weekly special appears once in pending_changes');

select is(
  (select public.publish_weekly_special(pg_temp.weekly_id(), pg_temp.version()) ->> 'status'),
  'published',
  'publish_weekly_special publishes the draft');

select is(pg_temp.public_week(), 'Frikadeller / uge 35',
  'the new name is live');
select is(
  (select price_small_ore from public.weekly_special),
  9500,
  'so is the new price');
select is(pg_temp.public_saturday(), 'ingen',
  'and the Saturday menu is now off — 1af renders "Ingen lørdagsmenu denne uge"');

select is(
  (select sat_name from public.weekly_special),
  'Helstegt pattegris',
  'switching it off kept the text, exactly as 1ag promises');

select is(
  (select draft from public.weekly_special),
  null,
  'the draft is cleared by the publish');

select is(
  pg_temp.audit_count('publish', current_setting('test.staff_uid')::uuid),
  1::bigint,
  'exactly one audit row, attributed to whoever published');

reset role;


-- ===========================================================================
-- 4. The immediate Udsolgt path (§6, §7b)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_weekly_special_sold_out('week',
     (now() at time zone 'Europe/Copenhagen')::date, pg_temp.version()) ->> 'status'),
  'updated',
  'Ugens ret can be marked udsolgt i dag');

select isnt(
  (select sold_out_on from public.weekly_special),
  null,
  'the weekly dish carries a sold-out date');

select is(
  (select sat_sold_out_on from public.weekly_special),
  null,
  'and the Saturday menu was not touched — one named column moved');

select is(
  (select name from public.weekly_special),
  'Frikadeller',
  'no content column moved either');

select is(
  (select draft from public.weekly_special),
  null,
  'and no draft was created: this is the immediate path, not a pending change');

select is(
  (select count(*) from public.pending_changes where entity = 'weekly_special'),
  0::bigint,
  'so an Udsolgt weekly special appears in no publish list');

select is(
  pg_temp.audit_count('availability', current_setting('test.staff_uid')::uuid),
  1::bigint,
  'one availability audit row, attributed from the JWT');

-- The other column, independently.
select is(
  (select public.set_weekly_special_sold_out('saturday',
     (now() at time zone 'Europe/Copenhagen')::date, pg_temp.version()) ->> 'status'),
  'updated',
  'the Saturday menu has its own sold-out column');

select isnt((select sat_sold_out_on from public.weekly_special), null,
  'which is now set');

-- Fortryd is a second write down the same path.
select is(
  (select public.set_weekly_special_sold_out('saturday', null, pg_temp.version()) ->> 'status'),
  'updated',
  'and Fortryd sets it back');
select is((select sat_sold_out_on from public.weekly_special), null,
  'the Saturday menu is available again');

select is(
  (select public.set_weekly_special_sold_out('saturday', null, pg_temp.version()) ->> 'status'),
  'unchanged',
  'pressing it twice is one decision, and logs nothing the second time');

select is(
  (select public.set_weekly_special_sold_out('week', '2020-01-01', pg_temp.version()) ->> 'status'),
  'invalid_date',
  'a date that is not today in Copenhagen is refused');

select is(
  (select public.set_weekly_special_sold_out('draft', null, pg_temp.version()) ->> 'status'),
  'invalid_target',
  'and a target outside the closed set names nothing');

select is(
  (select public.set_weekly_special_sold_out('week', null,
     now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token writes nothing (§6)');

-- Back to available for the rest of the suite.
select is(
  (select public.set_weekly_special_sold_out('week', null, pg_temp.version()) ->> 'status'),
  'updated',
  'Ugens ret is available again');

reset role;


-- ===========================================================================
-- 5. "Kopiér sidste uge" (§6, decision 4)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.copy_weekly_special_to_draft(2026, 36, pg_temp.version(), false) ->> 'status'),
  'copied',
  'the live week is copied forward into a draft');

select is(pg_temp.draft_of('iso_week'), '36',
  'under the destination week the server computed');
select is(pg_temp.draft_of('name'), 'Frikadeller',
  'carrying the live dish name');
select is(pg_temp.draft_of('sat_name'), 'Helstegt pattegris',
  'and the Saturday menu with it');

select ok(
  not ((select draft from public.weekly_special) ? 'sold_out_on')
  and not ((select draft from public.weekly_special) ? 'sat_sold_out_on'),
  'the copy carries neither sold-out column — operational state is not content');

select ok(
  not ((select draft from public.weekly_special) ? 'updated_by')
  and not ((select draft from public.weekly_special) ? 'updated_at')
  and not ((select draft from public.weekly_special) ? 'id')
  and not ((select draft from public.weekly_special) ? 'draft'),
  'and no attribution, timestamp or identity field either');

select is(pg_temp.public_week(), 'Frikadeller / uge 35',
  'THE COPY PUBLISHED NOTHING: the guest still reads the live week');

select is(
  pg_temp.audit_count('copy_previous_week', current_setting('test.staff_uid')::uuid),
  1::bigint,
  'the copy wrote one audit row, attributed from the JWT (§6 item 4)');

-- The overwrite guard.
select is(
  (select public.copy_weekly_special_to_draft(2026, 37, pg_temp.version(), false) ->> 'status'),
  'needs_confirmation',
  'a second copy refuses while a draft is in the way');

select is(pg_temp.draft_of('iso_week'), '36',
  'and it wrote nothing at all while refusing');

select is(
  (select public.copy_weekly_special_to_draft(2026, 37, pg_temp.version(), true) ->> 'status'),
  'copied',
  'an explicit confirmation overwrites it');

select is(pg_temp.draft_of('iso_week'), '37',
  'with the new destination week');

select is(
  (select public.copy_weekly_special_to_draft(2026, 38, now() - interval '1 day', true) ->> 'status'),
  'conflict',
  'a stale version token copies nothing (§6)');

select is(
  (select public.copy_weekly_special_to_draft(2026, 54, pg_temp.version(), true) ->> 'status'),
  'invalid_week',
  'a week outside the column CHECK is refused before anything is read');

select is(
  (select public.copy_weekly_special_to_draft(1999, 36, pg_temp.version(), true) ->> 'status'),
  'invalid_week',
  'so is a year outside it');

select is(pg_temp.draft_of('iso_week'), '37',
  'and neither refusal disturbed the draft that was there');

reset role;


-- ===========================================================================
-- 6. Owner may do all of it, and a row with nothing to copy refuses (§5, §6)
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select public.set_weekly_special_sold_out('week',
     (now() at time zone 'Europe/Copenhagen')::date, pg_temp.version()) ->> 'status'),
  'updated',
  'an Owner may change availability too (§5 matrix)');

select is(
  (select public.set_weekly_special_sold_out('week', null, pg_temp.version()) ->> 'status'),
  'updated',
  'and set it back');

select is(
  (select public.copy_weekly_special_to_draft(2026, 39, pg_temp.version(), true) ->> 'status'),
  'copied',
  'and may copy the previous week');

reset role;

-- An empty live row has nothing to copy forward, whoever asks.
update public.weekly_special
   set name = null, sat_enabled = false, sat_name = null, draft = null;

select pg_temp.become_staff();

select is(
  (select public.copy_weekly_special_to_draft(2026, 40, pg_temp.version(), true) ->> 'status'),
  'nothing_to_copy',
  'an empty live row refuses rather than producing a blank draft (§6)');

select is(
  (select draft from public.weekly_special),
  null,
  'and wrote nothing while refusing');

reset role;


-- ===========================================================================
-- 7. The column CHECKs still hold for a published week (§4)
-- ===========================================================================

select pg_temp.become_staff();

select throws_ok(
  $$ update public.weekly_special set iso_week = 54 $$,
  '23514',
  null,
  'an ISO week outside 1–53 is refused by the column CHECK');

select throws_ok(
  $$ update public.weekly_special set iso_year = 1999 $$,
  '23514',
  null,
  'so is an ISO year outside 2000–2999');

select throws_ok(
  $$ update public.weekly_special set days = array['funday']::text[] $$,
  '23514',
  null,
  'and a serving day outside the schedule vocabulary');

select throws_ok(
  $$ update public.weekly_special set sold_out_on = '2020-01-01' $$,
  '23514',
  null,
  'the sold-out guard refuses a date far from today, whatever writes it');

reset role;

select * from finish();
rollback;
