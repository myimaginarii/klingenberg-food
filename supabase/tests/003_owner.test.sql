-- Klingenberg Food — pgTAP: the Owner permission surface (technical plan §5, §9).
--
-- An Owner receives everything Staff receives, plus the four things that define the
-- business permanently: the normal weekly opening hours, the site contact facts,
-- Forsiden, and user accounts — and read access to the audit log.

begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- The seed (`supabase/seed.sql`) loads the restaurant's confirmed menu and its
-- placeholder news from phase 3. These tests assert exact counts over whole tables, so
-- that content is cleared here, inside the transaction: the fixtures below are then the
-- entire world, and the rollback at the end of the file leaves the developer's database
-- exactly as it was. Dishes go first — the category reference is ON DELETE RESTRICT.
delete from public.dishes;
delete from public.menu_categories;
delete from public.news;
-- `audit_log` accumulates a row per publish, so a database that has been used at all
-- carries history the "owner can read the audit log" assertion would otherwise count.
-- It is cleared here for the same reason as the tables above: the single row inserted
-- below must be the entire log. The delete runs before `set local role authenticated`,
-- i.e. still as the table owner — no RLS policy grants DELETE on this table to anyone,
-- and that rule is asserted from the Owner session further down.
delete from public.audit_log;

insert into public.menu_categories (id, slug, name, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'burgere', 'Burgere', 1);

insert into public.dishes (id, category_id, name, price_ore) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Thor', 12900);

insert into public.audit_log (action, entity) values ('seed', 'dishes');

-- Resolved while still superuser: `authenticated` cannot read auth.users.
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);
select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);

select set_config('request.jwt.claims',
  json_build_object(
    'sub',   current_setting('test.owner_uid'),
    'role',  'authenticated',
    'email', 'owner@example.test'
  )::text, true);
set local role authenticated;

select ok(public.is_staff(), 'owner session satisfies is_staff() — owners are staff (§5)');
select ok(public.is_owner(), 'owner session satisfies is_owner()');


-- ===========================================================================
-- 1. The four Owner-only capabilities
-- ===========================================================================

-- --- normal weekly opening hours ---
select lives_ok(
  $$ update public.opening_hours
        set schedule = '{"mon":{"closed":true},"tue":{"closed":true},
                         "wed":{"from":"15:00","to":"20:00"},
                         "thu":{"from":"15:00","to":"20:00"},
                         "fri":{"from":"15:00","to":"20:00"},
                         "sat":{"from":"17:00","to":"20:00"},
                         "sun":{"from":"16:00","to":"21:00"}}'::jsonb $$,
  'owner can modify the normal weekly opening hours');
select is(
  (select schedule -> 'sun' ->> 'to' from public.opening_hours),
  '21:00',
  'the owner edit to the opening hours took effect');

-- --- site contact information ---
select lives_ok(
  $$ update public.site_contact set primary_phone = '+45 63 90 83 01' $$,
  'owner can modify site contact information');
select is(
  (select primary_phone from public.site_contact),
  '+45 63 90 83 01',
  'the owner edit to the contact details took effect');

-- --- Forsiden ---
select lives_ok(
  $$ update public.pages set published = '{"heading": "Velkommen"}'::jsonb where key = 'home' $$,
  'owner can modify Forsiden');
select is(
  (select published ->> 'heading' from public.pages where key = 'home'),
  'Velkommen',
  'the owner edit to Forsiden took effect');

-- --- user accounts ---
select lives_ok(
  $$ update public.profiles set name = 'Omdøbt medarbejder'
      where user_id = current_setting('test.staff_uid')::uuid $$,
  'owner can edit another account');
select is(
  (select name from public.profiles where user_id = current_setting('test.staff_uid')::uuid),
  'Omdøbt medarbejder',
  'the owner edit to the staff account took effect');
select lives_ok(
  $$ update public.profiles set role = 'owner'
      where user_id = current_setting('test.staff_uid')::uuid $$,
  'owner can promote a staff member to owner');
select lives_ok(
  $$ update public.profiles set role = 'staff', disabled_at = now()
      where user_id = current_setting('test.staff_uid')::uuid $$,
  'owner can demote and deactivate a staff member');
select is(
  (select count(*) from public.profiles),
  2::bigint,
  'owner sees every account, not only their own');

-- --- audit log ---
select is(
  (select count(*) from public.audit_log),
  1::bigint,
  'owner can read the audit log');
select lives_ok(
  $$ select public.log_audit('publish', 'pages') $$,
  'owner can write an audit entry through log_audit()');

-- Even an owner may not write the audit log directly — the function is the only door.
select throws_ok(
  $$ insert into public.audit_log (action, entity) values ('direct', 'pages') $$,
  '42501', null, 'owner cannot insert into audit_log directly');
select throws_ok(
  $$ update public.audit_log set action = 'rewritten' $$,
  '42501', null, 'owner cannot rewrite an audit entry');
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null, 'owner cannot delete an audit entry');


-- ===========================================================================
-- 2. Owner also holds every Staff capability (spot-check across the matrix)
-- ===========================================================================

select lives_ok(
  $$ update public.dishes set price_ore = 13900 where name = 'Thor' $$,
  'owner can change a price');
select lives_ok(
  $$ update public.dishes set sold_out_on = (now() at time zone 'Europe/Copenhagen')::date
      where name = 'Thor' $$,
  'owner can mark a dish Udsolgt');
select lives_ok(
  $$ insert into public.news (title, slug, status, published_at)
     values ('Ejerens nyhed', 'ejerens-nyhed', 'published', now()) $$,
  'owner can publish a news article');
select lives_ok(
  $$ update public.weekly_special set name = 'Ugens ret' $$,
  'owner can edit Ugens ret');
select lives_ok(
  $$ update public.announcement
        set message = 'Lukket i dag', expires_at = now() + interval '3 hours', is_visible = true $$,
  'owner can publish an announcement');
select lives_ok(
  $$ insert into public.opening_hours_overrides (date, kind, status)
     values (current_date + 20, 'closed', 'published') $$,
  'owner can create a one-off override');
select lives_ok(
  $$ update public.pages set is_visible = false where key = 'takeaway' $$,
  'owner can toggle the Mad ud af huset page');
select lives_ok(
  $$ insert into public.images (storage_path) values ('media/owner.avif') $$,
  'owner can add an image');

select * from finish();
rollback;
