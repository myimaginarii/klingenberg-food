-- Klingenberg Food — pgTAP: Månedens burger (§4, §5, §6, §7b, §7d, §9).
--
-- Phase 6B added one migration with one operation. This suite asserts the properties the
-- application relies on, from real Staff, Owner and anonymous JWTs:
--
--    1. `anon` may read the live columns of a burger **inside its window** and may not
--       read the draft, so a guest cannot learn what next month is going to be — and the
--       RLS window filter is asserted directly, because it is the defence-in-depth copy
--       of §7d that the application's own filter sits on top of;
--    2. `anon` may not write any of it, and may not execute the new function;
--    3. Staff may write a draft, Owner may, and the write touches `draft` and nothing
--       else — the live name, price, both dates, `show_on_homepage` and `sold_out_on`
--       all stand exactly as they were;
--    4. **`show_on_homepage` is an ordinary draft field**: changing it is invisible to a
--       guest until a publish, and it survives a later edit to another field;
--    5. **a pending price survives a `show_on_homepage` edit, and pending dates survive a
--       description edit** — the merge property phase 6B most easily breaks, asserted in
--       both directions;
--    6. a stale version token writes nothing, for both operations;
--    7. `set_monthly_burger_sold_out` moves exactly one named column, refuses a date that
--       is not today in Copenhagen, writes one audit row attributed to whoever pressed
--       it, and **creates no draft and no pending change**;
--    8. a refused availability call writes no audit row — no false attribution;
--    9. `publish_monthly_burger` — phase 4's, unchanged — merges the draft, clears it,
--       logs one audit row, and only then does the public read see the new burger;
--   10. the `monthly_burger_window_check` CHECK still refuses a reversed window.
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "the guest still reads last month" is the promise the draft model exists to keep, and
-- an assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–010.

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
 * A published burger whose window is open today, whatever "today" is when this runs.
 * A literal month would make the suite pass in September and fail in October, which is
 * the one way a date-window test can be worse than no test at all.
 */
update public.monthly_burger
   set name             = 'Efteraarsburgeren',
       description      = 'Boef, bacon og rygeostcreme.',
       price_ore        = 12900,
       image_id         = null,
       starts_on        = (now() at time zone 'Europe/Copenhagen')::date - 5,
       ends_on          = (now() at time zone 'Europe/Copenhagen')::date + 5,
       sold_out_on      = null,
       show_on_homepage = true,
       draft            = null;

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

/* The one row, whoever is asking. `monthly_burger` is a singleton (§4). */
create function pg_temp.burger_id() returns uuid language sql as $fn$
  select id from public.monthly_burger limit 1
$fn$;

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.monthly_burger limit 1
$fn$;

/* What a guest currently reads. Live columns only — no draft anywhere in sight. */
create function pg_temp.public_burger() returns text language sql as $fn$
  select coalesce(m.name, '-') || ' / ' || coalesce(m.price_ore::text, '-')
    from public.monthly_burger m limit 1
$fn$;

/* Whether a guest can see the row at all, which is the RLS window filter (§7d). */
create function pg_temp.public_rows() returns bigint language sql as $fn$
  select count(*) from public.monthly_burger
$fn$;

/*
 * How many audit rows one action wrote, and who they are attributed to.
 *
 * SECURITY DEFINER, and owned by the role that owns the table, because `audit_log` is
 * **Owner-readable** (§5) — a staff session reads none of it, which is itself asserted by
 * suite 002. These assertions are about what was *written* and to whom it was attributed,
 * not about who may read it.
 */
create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'monthly_burger' and action = p_action and actor_id = p_actor
$fn$;

/* What the administration shows: the draft's value where there is one. */
create function pg_temp.draft_of(field text) returns text language sql as $fn$
  select m.draft ->> field from public.monthly_burger m limit 1
$fn$;

create function pg_temp.today() returns date language sql as $fn$
  select (now() at time zone 'Europe/Copenhagen')::date
$fn$;


-- ===========================================================================
-- 1. anon reads the live burger and never the draft (§4, §5)
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  $$ update public.monthly_burger
        set draft = jsonb_build_object('name', 'Hemmelig burger til naeste maaned')
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'staff may write a draft');

select pg_temp.become_anon();

select is(pg_temp.public_burger(), 'Efteraarsburgeren / 12900',
  'anon reads the published burger, not the draft');

select throws_ok(
  $$ select draft from public.monthly_burger $$,
  '42501',
  null,
  'anon has no SELECT privilege on monthly_burger.draft');

select throws_ok(
  $$ update public.monthly_burger set name = 'Overtaget' $$,
  '42501',
  null,
  'anon cannot write monthly_burger at all');

select throws_ok(
  $$ select public.set_monthly_burger_sold_out(null, now()) $$,
  '42501',
  null,
  'anon cannot execute set_monthly_burger_sold_out');

select throws_ok(
  $$ select public.set_monthly_burger_sold_out(
       (now() at time zone 'Europe/Copenhagen')::date, now()) $$,
  '42501',
  null,
  'and not with a date either');

select throws_ok(
  $$ select public.publish_monthly_burger(
       (select id from public.monthly_burger), now()) $$,
  '42501',
  null,
  'anon cannot publish it');

reset role;

update public.monthly_burger set draft = null;


-- ===========================================================================
-- 2. The RLS window filter — defence in depth for §7d
-- ===========================================================================
--
-- The application applies the date window at read time (`lib/menu/view.ts`). The policy
-- applies it again, so a published-but-not-yet-current burger is unreadable to `anon`
-- even if a public query forgot the filter. Both ends are asserted, and so is the
-- inclusive boundary, because "inclusive at both ends" (§7d) is the half of the rule an
-- off-by-one would silently break.

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 1::bigint, 'a burger inside its window is readable');
reset role;

update public.monthly_burger set starts_on = pg_temp.today() + 1, ends_on = pg_temp.today() + 30;
select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint, 'a burger whose window has not begun is not');
reset role;

update public.monthly_burger set starts_on = pg_temp.today(), ends_on = pg_temp.today();
select pg_temp.become_anon();
select is(pg_temp.public_rows(), 1::bigint, 'a window of exactly today is readable — inclusive');
reset role;

update public.monthly_burger set starts_on = pg_temp.today() - 30, ends_on = pg_temp.today() - 1;
select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint, 'a burger whose window has ended is not readable');
reset role;

update public.monthly_burger set starts_on = null, ends_on = null;
select pg_temp.become_anon();
select is(pg_temp.public_rows(), 1::bigint, 'a burger with no window at all is readable');
reset role;

-- Back to an open window for the rest of the suite.
update public.monthly_burger
   set starts_on = pg_temp.today() - 5, ends_on = pg_temp.today() + 5;


-- ===========================================================================
-- 3. Draft integrity — one control never clears another's fields (§4, §6)
-- ===========================================================================
--
-- The application writes these drafts through `saveEntityDraft`, which merges the
-- submitted fields into the existing draft and removes only the names its `clear` list
-- carries. The list comes from `lib/menu/monthly.ts` and excludes `image_id`. What is
-- asserted here is the *database-visible consequence*: after both edits, both are still
-- pending, and a field no editor owns is still there.

select pg_temp.become_staff();

select lives_ok(
  $$ update public.monthly_burger
        set draft = coalesce(draft, '{}'::jsonb) || jsonb_build_object('price_ore', 13900)
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'a pending price is stored');

select lives_ok(
  $$ update public.monthly_burger
        set draft = coalesce(draft, '{}'::jsonb)
                    || jsonb_build_object('show_on_homepage', false)
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'turning "Vis paa forsiden" off is stored beside it');

select is(pg_temp.draft_of('price_ore'), '13900',
  'the pending price survived the forside edit');
select is(pg_temp.draft_of('show_on_homepage'), 'false',
  'and the forside edit is there too');

select lives_ok(
  $$ update public.monthly_burger
        set draft = coalesce(draft, '{}'::jsonb)
                    || jsonb_build_object('starts_on', (pg_temp.today() + 10)::text,
                                          'ends_on',   (pg_temp.today() + 40)::text)
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'pending dates merge rather than replace');

select is(pg_temp.draft_of('price_ore'), '13900',
  'the pending price survived the date edit as well');
select is(pg_temp.draft_of('show_on_homepage'), 'false',
  'and so did the forside edit');

select lives_ok(
  $$ update public.monthly_burger
        set draft = coalesce(draft, '{}'::jsonb)
                    || jsonb_build_object('description', 'Ny beskrivelse.')
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'a later description edit merges too');

select is(pg_temp.draft_of('starts_on'), (pg_temp.today() + 10)::text,
  'the pending start date survived the description edit');
select is(pg_temp.draft_of('ends_on'), (pg_temp.today() + 40)::text,
  'and so did the pending end date');

-- Nothing live has moved through any of it.
select is(pg_temp.public_burger(), 'Efteraarsburgeren / 12900',
  'no live column moved while four drafts were written');
select is(
  (select show_on_homepage from public.monthly_burger),
  true,
  'and "Vis paa forsiden" is still on for a guest: it is a normal draft field (§7d)');

reset role;


-- ===========================================================================
-- 4. Publishing moves the row, and only then (§6)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select count(*) from public.pending_changes where entity = 'monthly_burger'),
  1::bigint,
  'the monthly burger appears once in pending_changes');

select is(
  (select public.publish_monthly_burger(pg_temp.burger_id(), pg_temp.version()) ->> 'status'),
  'published',
  'publish_monthly_burger publishes the draft');

select is(
  (select price_ore from public.monthly_burger),
  13900,
  'the new price is live');
select is(
  (select show_on_homepage from public.monthly_burger),
  false,
  'and so is the forside setting — it went live with the publish, not before it');
select is(
  (select starts_on from public.monthly_burger),
  pg_temp.today() + 10,
  'and both dates');

select is(
  (select draft from public.monthly_burger),
  null,
  'the draft is cleared by the publish');

select is(
  pg_temp.audit_count('publish', current_setting('test.staff_uid')::uuid),
  1::bigint,
  'exactly one audit row, attributed to whoever published');

select is(
  (select public.publish_monthly_burger(pg_temp.burger_id(), pg_temp.version()) ->> 'status'),
  'nothing_to_publish',
  'publishing again with no draft does nothing');

/*
 * A stale version token is refused — but the function answers `nothing_to_publish`
 * *before* it reaches the concurrency check, so this only asserts anything with a draft
 * in place. Writing one here is what makes the next line a test of §6 rather than a test
 * of the empty case twice.
 */
select lives_ok(
  $$ update public.monthly_burger set draft = jsonb_build_object('name', 'Kladde til versionstest') $$,
  'a draft is written, so the version check has something to refuse');

select is(
  (select public.publish_monthly_burger(pg_temp.burger_id(), now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token publishes nothing (§6)');

select is((select name from public.monthly_burger), 'Efteraarsburgeren',
  'and the live name is exactly as it was');

select is(pg_temp.draft_of('name'), 'Kladde til versionstest',
  'the draft is still waiting, unpublished');

update public.monthly_burger set draft = null;

reset role;

-- A window a guest can see again, so the availability assertions are about availability.
update public.monthly_burger
   set starts_on = pg_temp.today() - 5, ends_on = pg_temp.today() + 5, show_on_homepage = true;


-- ===========================================================================
-- 5. The immediate Udsolgt path (§6, §7b)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_monthly_burger_sold_out(pg_temp.today(), pg_temp.version()) ->> 'status'),
  'updated',
  'Maanedens burger can be marked udsolgt i dag');

select is(
  (select sold_out_on from public.monthly_burger),
  pg_temp.today(),
  'the burger carries today''s Copenhagen date');

select is(
  (select name || '/' || price_ore::text || '/' || coalesce(starts_on::text, '-')
          || '/' || coalesce(ends_on::text, '-') || '/' || show_on_homepage::text
     from public.monthly_burger),
  'Efteraarsburgeren/13900/' || (pg_temp.today() - 5)::text || '/'
    || (pg_temp.today() + 5)::text || '/true',
  'NOTHING ELSE MOVED: name, price, both dates and the forside flag are untouched');

select is(
  (select draft from public.monthly_burger),
  null,
  'and no draft was created: this is the immediate path, not a pending change');

select is(
  (select count(*) from public.pending_changes where entity = 'monthly_burger'),
  0::bigint,
  'so an Udsolgt burger appears in no publish list');

select is(
  pg_temp.audit_count('availability', current_setting('test.staff_uid')::uuid),
  1::bigint,
  'one availability audit row, attributed from the JWT');

-- The burger is still readable to a guest: sold out is not hidden (§7b, §7d).
reset role;
select pg_temp.become_anon();
select is(pg_temp.public_rows(), 1::bigint,
  'a sold-out burger is still readable — it is shown with "Udsolgt i dag", not removed');
reset role;

select pg_temp.become_staff();

-- Fortryd is a second write down the same path.
select is(
  (select public.set_monthly_burger_sold_out(null, pg_temp.version()) ->> 'status'),
  'updated',
  'and Fortryd sets it back');
select is((select sold_out_on from public.monthly_burger), null,
  'the burger is available again');

select is(
  pg_temp.audit_count('availability', current_setting('test.staff_uid')::uuid),
  2::bigint,
  'the undo is audited too — it is a write, not a rollback');

select is(
  (select public.set_monthly_burger_sold_out(null, pg_temp.version()) ->> 'status'),
  'unchanged',
  'pressing it twice is one decision, and logs nothing the second time');

select is(
  pg_temp.audit_count('availability', current_setting('test.staff_uid')::uuid),
  2::bigint,
  'so the audit count did not move');

select is(
  (select public.set_monthly_burger_sold_out('2020-01-01', pg_temp.version()) ->> 'status'),
  'invalid_date',
  'a date that is not today in Copenhagen is refused');

select is(
  (select public.set_monthly_burger_sold_out(pg_temp.today() + 1, pg_temp.version()) ->> 'status'),
  'invalid_date',
  'including tomorrow: the browser cannot choose a date at all');

select is(
  (select public.set_monthly_burger_sold_out(pg_temp.today(), now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token writes nothing (§6)');

select is(
  pg_temp.audit_count('availability', current_setting('test.staff_uid')::uuid),
  2::bigint,
  'NO FALSE AUDIT: three refusals wrote no log rows between them');

select is(
  (select sold_out_on from public.monthly_burger),
  null,
  'and none of them touched the column either');

reset role;


-- ===========================================================================
-- 6. Owner may do all of it (§5 matrix)
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select public.set_monthly_burger_sold_out(pg_temp.today(), pg_temp.version()) ->> 'status'),
  'updated',
  'an Owner may change availability too');

select is(
  (select public.set_monthly_burger_sold_out(null, pg_temp.version()) ->> 'status'),
  'updated',
  'and set it back');

select lives_ok(
  $$ update public.monthly_burger
        set draft = jsonb_build_object('name', 'Ejerens burger')
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'an Owner may write a draft');

select is(
  (select public.publish_monthly_burger(pg_temp.burger_id(), pg_temp.version()) ->> 'status'),
  'published',
  'and publish it');

select is(
  pg_temp.audit_count('publish', current_setting('test.owner_uid')::uuid),
  1::bigint,
  'attributed to the Owner, not to whoever wrote the draft');

reset role;


-- ===========================================================================
-- 7. An unconfigured burger is the seeded state, and it works (§7d, phase 6B)
-- ===========================================================================

update public.monthly_burger
   set name = null, description = null, price_ore = null,
       starts_on = null, ends_on = null, show_on_homepage = false, draft = null;

select pg_temp.become_staff();

select lives_ok(
  $$ update public.monthly_burger
        set draft = jsonb_build_object('name', 'Foerste burger')
      where updated_at = (select updated_at from public.monthly_burger) $$,
  'staff can begin filling in an empty singleton — no placeholder row is needed');

select is(
  (select public.publish_monthly_burger(pg_temp.burger_id(), pg_temp.version()) ->> 'status'),
  'published',
  'and publish it from empty');

select is((select name from public.monthly_burger), 'Foerste burger',
  'which is how the first burger gets onto the hjemmeside');

reset role;


-- ===========================================================================
-- 8. The column CHECKs still hold (§4)
-- ===========================================================================

select pg_temp.become_staff();

select throws_ok(
  $$ update public.monthly_burger
        set starts_on = '2026-09-30', ends_on = '2026-09-01' $$,
  '23514',
  null,
  'a window that ends before it starts is refused by the column CHECK');

select throws_ok(
  $$ update public.monthly_burger set sold_out_on = '2020-01-01' $$,
  '23514',
  null,
  'the sold-out guard refuses a date far from today, whatever writes it');

select throws_ok(
  $$ update public.monthly_burger set price_ore = 2000000 $$,
  '23514',
  null,
  'and a price outside the column range');

reset role;

select * from finish();
rollback;
