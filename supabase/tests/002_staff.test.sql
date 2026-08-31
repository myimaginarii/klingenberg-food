-- Klingenberg Food — pgTAP: the Staff permission surface (technical plan §5, §9).
--
-- Every row of the §5 matrix marked "Staff: yes" is exercised as a real write, and
-- every row marked "Staff: no" is attempted and shown not to take effect.
--
-- A denied UPDATE under RLS does not raise: the policy's USING clause filters the row
-- out and the statement reports zero rows changed. That is the correct semantics, and
-- it is also the easiest thing to get wrong in a test — asserting only "no exception"
-- would pass against a completely open table. So each denial is asserted twice: zero
-- rows affected, *and* the stored value is unchanged afterwards.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test. The tests use those real identities rather than hand-written
-- auth rows, so the JWT context matches a genuine session.

begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

-- ---------------------------------------------------------------------------
-- Fixtures and identity check
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

-- The seed (`supabase/seed.sql`) loads the restaurant's confirmed menu and its
-- placeholder news from phase 3. These tests assert exact counts over whole tables, so
-- that content is cleared here, inside the transaction: the fixtures below are then the
-- entire world, and the rollback at the end of the file leaves the developer's database
-- exactly as it was. Dishes go first — the category reference is ON DELETE RESTRICT.
delete from public.dishes;
delete from public.menu_categories;
delete from public.news;

insert into public.menu_categories (id, slug, name, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'burgere', 'Burgere', 1);

insert into public.dishes (id, category_id, name, price_ore) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Thor', 12900);

insert into public.images (id, storage_path) values
  ('55555555-5555-4555-8555-555555555551', 'media/test-a.avif');

insert into public.news (id, title, slug, status) values
  ('33333333-3333-4333-8333-333333333331', 'Testnyhed', 'testnyhed', 'draft');

insert into public.opening_hours_overrides (id, date, kind, status) values
  ('44444444-4444-4444-8444-444444444441', current_date + 10, 'closed', 'draft');

-- Known starting values, so the "unchanged" assertions below have something to compare.
update public.site_contact  set primary_phone = '+45 63 90 83 00';
update public.pages         set published = '{"heading": "Ejerens forside"}'::jsonb where key = 'home';

-- Reports how many rows a statement actually changed.
--
-- This is the assertion that matters for an RLS denial. A blocked UPDATE does not
-- raise — the policy filters the row out and the statement succeeds having changed
-- nothing — so "did not throw" proves nothing at all. SECURITY INVOKER, so the
-- statement runs with the caller's privileges and policies, exactly as the application
-- would issue it.
create function pg_temp.rows_affected(statement text)
returns bigint
language plpgsql
security invoker
as $fn$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- Become the staff member
-- ---------------------------------------------------------------------------

-- `authenticated` has no read access to auth.users — correctly, that is Supabase's
-- default and this schema does not widen it. So the two identities are resolved here,
-- while still superuser, and carried into the role-switched statements as settings.
select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

select set_config('request.jwt.claims',
  json_build_object(
    'sub',   current_setting('test.staff_uid'),
    'role',  'authenticated',
    'email', 'staff@example.test'
  )::text, true);
set local role authenticated;

select ok(public.is_staff(),     'staff session satisfies is_staff()');
select ok(not public.is_owner(), 'staff session does not satisfy is_owner()');


-- ===========================================================================
-- 1. Everything §5 grants Staff
-- ===========================================================================

-- --- menu sections ---
select lives_ok(
  $$ insert into public.menu_categories (slug, name, sort_order) values ('tapas', 'Tapas', 2) $$,
  'staff can create a menu section');
select lives_ok(
  $$ update public.menu_categories set name = 'Burgere & mere' where slug = 'burgere' $$,
  'staff can edit a menu section');

-- --- dishes: create, edit, price, labels, reorder, delete ---
select lives_ok(
  $$ insert into public.dishes (category_id, name, price_ore)
     values ('11111111-1111-4111-8111-111111111111', 'Ny ret', 9900) $$,
  'staff can create a dish');
select lives_ok(
  $$ update public.dishes set price_ore = 13900 where name = 'Thor' $$,
  'staff can change a price');
select lives_ok(
  $$ update public.dishes set labels = array['Populær'] where name = 'Thor' $$,
  'staff can set dish labels');
select lives_ok(
  $$ update public.dishes set sort_order = 5 where name = 'Thor' $$,
  'staff can reorder dishes');

-- --- Tilgængelig / Udsolgt (§7b) ---
select lives_ok(
  $$ update public.dishes
        set sold_out_on = (now() at time zone 'Europe/Copenhagen')::date
      where name = 'Thor' $$,
  'staff can mark a dish Udsolgt');
select is(
  (select sold_out_on from public.dishes where name = 'Thor'),
  (now() at time zone 'Europe/Copenhagen')::date,
  'the sold-out date is stored as the Copenhagen-local date');
select lives_ok(
  $$ update public.dishes set sold_out_on = null where name = 'Thor' $$,
  'staff can mark a dish Tilgængelig again (the Fortryd write)');

-- --- Tapas lists (§4, decision 3) ---
select lives_ok(
  $$ update public.dishes
        set details = '{"kind":"tapas","groups":[{"id":"base","heading":"Fast indhold","mode":"fixed","items":["Oliven"]}]}'::jsonb
      where name = 'Thor' $$,
  'staff can edit a tapas list');

-- --- drafts ---
select lives_ok(
  $$ update public.dishes set draft = '{"price_ore": 14900}'::jsonb where name = 'Thor' $$,
  'staff can write a draft');
select is(
  (select draft ->> 'price_ore' from public.dishes where name = 'Thor'),
  '14900',
  'staff can read a draft back');

-- --- soft delete, then hard delete ---
select lives_ok(
  $$ update public.dishes set deleted_at = now() where name = 'Ny ret' $$,
  'staff can soft-delete a dish');
select lives_ok(
  $$ delete from public.dishes where name = 'Ny ret' $$,
  'staff can delete a dish row');

-- --- images ---
select lives_ok(
  $$ insert into public.images (storage_path) values ('media/test-b.avif') $$,
  'staff can add an image');
select lives_ok(
  $$ update public.images set alt_text = 'En burger' where storage_path = 'media/test-b.avif' $$,
  'staff can edit an image');
select lives_ok(
  $$ delete from public.images where storage_path = 'media/test-b.avif' $$,
  'staff can delete an image');

-- --- Ugens ret and Lørdagsmenu ---
select lives_ok(
  $$ update public.weekly_special
        set iso_year = 2026, iso_week = 36, name = 'Ugens ret', price_small_ore = 8900 $$,
  'staff can edit Ugens ret');
select lives_ok(
  $$ update public.weekly_special
        set sold_out_on = (now() at time zone 'Europe/Copenhagen')::date $$,
  'staff can mark Ugens ret Udsolgt');
select lives_ok(
  $$ update public.weekly_special
        set sat_enabled = true, sat_name = 'Lørdagsmenu', sat_price_ore = 19900,
            sat_sold_out_on = (now() at time zone 'Europe/Copenhagen')::date $$,
  'staff can edit Lørdagsmenu and mark it Udsolgt');

-- --- Månedens burger, including its date window ---
select lives_ok(
  $$ update public.monthly_burger
        set name = 'Månedens burger', price_ore = 15900,
            starts_on = current_date, ends_on = current_date + 30,
            show_on_homepage = true $$,
  'staff can publish Månedens burger with a date window');
select lives_ok(
  $$ update public.monthly_burger set draft = '{"name": "Næste måned"}'::jsonb $$,
  'staff can prepare Månedens burger as a draft');

-- --- news: write, publish, unpublish ---
select lives_ok(
  $$ insert into public.news (title, slug, status) values ('Anden nyhed', 'anden-nyhed', 'draft') $$,
  'staff can write a news article');
select lives_ok(
  $$ update public.news set status = 'published', published_at = now() where slug = 'testnyhed' $$,
  'staff can publish a news article');
select lives_ok(
  $$ update public.news set status = 'draft' where slug = 'testnyhed' $$,
  'staff can unpublish a news article');
select lives_ok(
  $$ delete from public.news where slug = 'anden-nyhed' $$,
  'staff can delete a news article');

-- --- announcement ---
--
-- The §5 capability is "Announcement (besked): create, edit, publish, remove", and it
-- is exercised here through the paths that own it rather than as one broad UPDATE.
-- Until the 8C-1 hardening pass this was a single direct write of the published
-- columns; `20260831160000_announcement_column_privileges.sql` closed that, because
-- `restore_announcement()` trusts `previous` and a caller who may write the published
-- columns directly may also write that one. What Staff may do is unchanged — a draft,
-- then Offentliggør, then "Fjern beskeden nu". `016` asserts the refusals themselves.
select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object(
              'message',    'Vi lukker kl. 18 i dag',
              'link_type',  'none',
              'expires_at', (now() + interval '2 hours')::text) $$,
  'staff can write an announcement draft');
select is(
  (select public.publish_announcement(
            (select id from public.announcement),
            (select updated_at from public.announcement)) ->> 'status'),
  'published',
  'staff can create and publish an announcement');
select is(
  (select public.set_announcement_visible(
            false, (select updated_at from public.announcement)) ->> 'status'),
  'updated',
  'staff can remove an announcement immediately');

-- --- one-off opening-hour overrides ---
select lives_ok(
  $$ insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
     values (current_date + 11, 'custom', '16:00', '20:00', 'published') $$,
  'staff can create a one-off opening-hours override');
select lives_ok(
  $$ update public.opening_hours_overrides set status = 'published'
      where date = current_date + 10 $$,
  'staff can publish a one-off override');
-- Phase 8C-3B: a direct DELETE is refused, and that is the point of `overrides_guard_delete`.
--
-- Staff keep the table-level DELETE privilege — a SECURITY INVOKER function spends the
-- caller's privileges, so `remove_opening_hours_override()` could not delete anything
-- without it — and the guard trigger is what decides when that privilege may actually be
-- spent. Removing an override is still entirely within a staff member's rights; it simply
-- has one door, which checks the version, the generated announcement the override may own
-- and the audit trail on the way through (technical plan §7e item 6, §8).
select throws_ok(
  $$ delete from public.opening_hours_overrides where date = current_date + 11 $$,
  '42501',
  null,
  'a direct DELETE of a one-off override is refused, whoever the staff member is');

select lives_ok(
  $$ select public.remove_opening_hours_override(
       (select id from public.opening_hours_overrides where date = current_date + 11),
       (select updated_at from public.opening_hours_overrides where date = current_date + 11),
       false) $$,
  'staff can delete a one-off override through the trusted removal function');

select is(
  (select count(*)::int from public.opening_hours_overrides where date = current_date + 11),
  0,
  'and the row is actually gone');

-- --- Mad ud af huset, including its visibility toggle ---
select lives_ok(
  $$ update public.pages set published = '{"heading": "Mad ud af huset"}'::jsonb where key = 'takeaway' $$,
  'staff can edit the Mad ud af huset page');
select lives_ok(
  $$ update public.pages set is_visible = false where key = 'takeaway' $$,
  'staff can toggle the Mad ud af huset page off');
select lives_ok(
  $$ update public.pages set published = '{"heading": "Om os"}'::jsonb where key = 'about' $$,
  'staff can edit the Om os page');

-- --- the audit log is written through the one vetted function ---
select lives_ok(
  $$ select public.log_audit('publish', 'dishes', '22222222-2222-4222-8222-222222222221') $$,
  'staff can write an audit entry through log_audit()');


-- ===========================================================================
-- 2. Everything §5 withholds from Staff
-- ===========================================================================

-- --- normal weekly opening hours: owner only ---
select is(
  pg_temp.rows_affected(
    $$ update public.opening_hours
          set schedule = '{"mon":{"closed":true},"tue":{"closed":true},"wed":{"closed":true},
                           "thu":{"closed":true},"fri":{"closed":true},"sat":{"closed":true},
                           "sun":{"from":"09:00","to":"10:00"}}'::jsonb $$),
  0::bigint,
  'staff cannot modify the normal weekly opening hours');
select is(
  (select schedule -> 'sun' ->> 'from' from public.opening_hours),
  '17:00',
  'the weekly opening hours still hold the seeded Sunday value after the staff attempt');

-- --- site contact: owner only ---
select is(
  pg_temp.rows_affected($$ update public.site_contact set primary_phone = '+45 00 00 00 00' $$),
  0::bigint,
  'staff cannot modify site contact information');
select is(
  (select primary_phone from public.site_contact),
  '+45 63 90 83 00',
  'the contact phone number is unchanged after the staff attempt');

-- --- Forsiden: owner only ---
select is(
  pg_temp.rows_affected(
    $$ update public.pages set published = '{"heading": "Kapret"}'::jsonb where key = 'home' $$),
  0::bigint,
  'staff cannot modify Owner-controlled homepage content');
select is(
  (select published ->> 'heading' from public.pages where key = 'home'),
  'Ejerens forside',
  'the homepage document is unchanged after the staff attempt');

-- A staff member must not be able to reach `home` by renaming another page into it.
-- This one raises rather than filtering: the USING clause admits the `about` row, and
-- the WITH CHECK clause then rejects the row it would become. That is precisely the
-- job of a separate WITH CHECK, and it is why the policy does not simply reuse USING.
select throws_ok(
  $$ update public.pages set key = 'home' where key = 'about' $$,
  '42501', null,
  'staff cannot rename another page into the owner-only home key');

-- --- user accounts: owner only ---
select throws_ok(
  $$ insert into public.profiles (user_id, name, role)
     values ('66666666-6666-4666-8666-666666666666', 'Selvudnævnt', 'owner') $$,
  '42501', null, 'staff cannot create a user account');
select is(
  pg_temp.rows_affected(
    $$ update public.profiles set role = 'owner'
        where user_id = current_setting('test.staff_uid')::uuid $$),
  0::bigint,
  'staff cannot promote themselves to owner');
select is(
  pg_temp.rows_affected(
    $$ delete from public.profiles
        where user_id = current_setting('test.owner_uid')::uuid $$),
  0::bigint,
  'staff cannot delete another account');

-- A staff member sees their own profile and nobody else's.
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'staff sees exactly one profile — their own');
select is(
  (select name from public.profiles),
  'Lokal Medarbejder',
  'the one profile staff sees is theirs');

-- --- audit log: owner only ---
select is(
  (select count(*) from public.audit_log),
  0::bigint,
  'staff cannot read the audit log');
select throws_ok(
  $$ insert into public.audit_log (action, entity) values ('forged', 'dishes') $$,
  '42501', null, 'staff cannot insert into audit_log directly');

-- --- the singletons cannot be multiplied or removed by anyone ---
select throws_ok(
  $$ insert into public.weekly_special (name) values ('Endnu en') $$,
  '42501', null, 'staff cannot create a second weekly_special row');
select throws_ok(
  $$ delete from public.weekly_special $$,
  '42501', null, 'staff cannot delete the weekly_special singleton');
select throws_ok(
  $$ insert into public.pages (key) values ('home') $$,
  '42501', null, 'staff cannot create a second pages row');


-- ===========================================================================
-- 3. Audit attribution is taken from the JWT, not from the caller
-- ===========================================================================

reset role;

select is(
  (select actor_id from public.audit_log where action = 'publish' order by created_at desc limit 1),
  (select id from auth.users where email = 'staff@example.test'),
  'log_audit() stamps actor_id from the session, so attribution cannot be forged');

select * from finish();
rollback;
