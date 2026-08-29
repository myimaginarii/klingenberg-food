-- Klingenberg Food — pgTAP: the anonymous permission surface (technical plan §5, §8, §9).
--
-- What a visitor's session can reach is the highest-consequence part of this schema, so
-- it is tested by attempting the operations, not by reading the policies back.
--
-- Anonymous must:
--   * hold no INSERT / UPDATE / DELETE privilege on any application table;
--   * be unable to read any `draft` column at all;
--   * see only content that is genuinely live — no unpublished news, no hidden
--     sections, no soft-deleted or never-published dishes, no invisible or expired
--     announcement, no out-of-window monthly burger, no draft or past hours override,
--     no invisible page;
--   * be unable to read `audit_log` or `profiles` in any form.

begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

-- ---------------------------------------------------------------------------
-- Fixtures, created as the superuser so RLS does not interfere with setup.
-- Everything is rolled back at the end of the file.
-- ---------------------------------------------------------------------------

-- The seed (`supabase/seed.sql`) loads the restaurant's confirmed menu and its
-- placeholder news from phase 3. These tests assert exact counts over whole tables, so
-- that content is cleared here, inside the transaction: the fixtures below are then the
-- entire world, and the rollback at the end of the file leaves the developer's database
-- exactly as it was. Dishes go first — the category reference is ON DELETE RESTRICT.
delete from public.dishes;
delete from public.menu_categories;
delete from public.news;

insert into public.menu_categories (id, slug, name, sort_order, visible) values
  ('11111111-1111-4111-8111-111111111111', 'synlig',  'Synlig sektion',  1, true),
  ('11111111-1111-4111-8111-111111111112', 'skjult',  'Skjult sektion',  2, false);

insert into public.dishes (id, category_id, name, price_ore, is_new_draft, deleted_at, draft) values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Udgivet ret',      12900, false, null, null),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Aldrig udgivet',   12900, true,  null, null),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'Slettet ret',      12900, false, now(), null),
  ('22222222-2222-4222-8222-222222222224', '11111111-1111-4111-8111-111111111111', 'Ret med kladde',   12900, false, null, '{"price_ore": 99900}'::jsonb);

insert into public.news (id, title, slug, status, published_at, display_date) values
  ('33333333-3333-4333-8333-333333333331', 'Offentliggjort nyhed', 'offentliggjort-nyhed', 'published', now(), current_date),
  ('33333333-3333-4333-8333-333333333332', 'Kladde-nyhed',         'kladde-nyhed',         'draft',     null,  current_date);

insert into public.opening_hours_overrides (id, date, kind, status) values
  ('44444444-4444-4444-8444-444444444441', current_date + 3, 'closed', 'published'),
  ('44444444-4444-4444-8444-444444444442', current_date + 4, 'closed', 'draft'),
  ('44444444-4444-4444-8444-444444444443', current_date - 3, 'closed', 'published');

insert into public.audit_log (action, entity) values ('test', 'dishes');

update public.pages set is_visible = false where key = 'takeaway';


-- ---------------------------------------------------------------------------
-- Become an anonymous visitor: the `anon` role with an anon JWT, exactly as
-- PostgREST presents an unauthenticated request.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(current_user::text, 'anon', 'the session is running as anon');


-- ===========================================================================
-- 1. Anonymous holds no write privilege on any application table
-- ===========================================================================
--
-- The catalog assertion first, because it cannot rot: any table added by a future
-- migration that accidentally inherits Supabase's default grants fails this one
-- assertion without anybody remembering to extend the list below it.

reset role;
select is_empty(
  $$ select table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
        and privilege_type <> 'SELECT' $$,
  'anon holds no non-SELECT privilege on any table in public'
);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- And the same thing proved by attempting it, one table at a time.

select throws_ok(
  $$ insert into public.profiles (user_id, name, role) values (gen_random_uuid(), 'x', 'owner') $$,
  '42501', null, 'anon cannot insert into profiles');
select throws_ok(
  $$ insert into public.menu_categories (slug, name) values ('x', 'x') $$,
  '42501', null, 'anon cannot insert into menu_categories');
select throws_ok(
  $$ insert into public.dishes (category_id, name) values ('11111111-1111-4111-8111-111111111111', 'x') $$,
  '42501', null, 'anon cannot insert into dishes');
select throws_ok(
  $$ insert into public.weekly_special (name) values ('x') $$,
  '42501', null, 'anon cannot insert into weekly_special');
select throws_ok(
  $$ insert into public.monthly_burger (name) values ('x') $$,
  '42501', null, 'anon cannot insert into monthly_burger');
select throws_ok(
  $$ insert into public.news (title, slug) values ('x', 'x') $$,
  '42501', null, 'anon cannot insert into news');
select throws_ok(
  $$ insert into public.announcement (message) values ('x') $$,
  '42501', null, 'anon cannot insert into announcement');
select throws_ok(
  $$ insert into public.opening_hours (schedule) values ('{}'::jsonb) $$,
  '42501', null, 'anon cannot insert into opening_hours');
select throws_ok(
  $$ insert into public.opening_hours_overrides (date, kind) values (current_date + 9, 'closed') $$,
  '42501', null, 'anon cannot insert into opening_hours_overrides');
select throws_ok(
  $$ insert into public.pages (key) values ('home') $$,
  '42501', null, 'anon cannot insert into pages');
select throws_ok(
  $$ insert into public.site_contact (city) values ('x') $$,
  '42501', null, 'anon cannot insert into site_contact');
select throws_ok(
  $$ insert into public.images (storage_path) values ('x') $$,
  '42501', null, 'anon cannot insert into images');
select throws_ok(
  $$ insert into public.audit_log (action, entity) values ('x', 'y') $$,
  '42501', null, 'anon cannot insert into audit_log');

-- Update and delete, on the tables a visitor can actually see rows in.

select throws_ok(
  $$ update public.dishes set price_ore = 1 $$,
  '42501', null, 'anon cannot update dishes');
select throws_ok(
  $$ update public.site_contact set primary_phone = 'x' $$,
  '42501', null, 'anon cannot update site_contact');
select throws_ok(
  $$ update public.opening_hours set schedule = schedule $$,
  '42501', null, 'anon cannot update opening_hours');
select throws_ok(
  $$ update public.announcement set is_visible = true $$,
  '42501', null, 'anon cannot update announcement');
select throws_ok(
  $$ delete from public.dishes $$,
  '42501', null, 'anon cannot delete dishes');
select throws_ok(
  $$ delete from public.news $$,
  '42501', null, 'anon cannot delete news');

-- The audit-log write function is not reachable either: EXECUTE was granted to
-- `authenticated` only, so anon is stopped before the function's own staff check.
select throws_ok(
  $$ select public.log_audit('forged', 'dishes') $$,
  '42501', null, 'anon cannot execute log_audit');


-- ===========================================================================
-- 2. Anonymous cannot read a draft
-- ===========================================================================
--
-- RLS filters rows, not columns, so this is enforced by column-level GRANT: `anon`
-- was never granted SELECT on `draft`. Reading it is a privilege error, which is a
-- stronger and more durable guarantee than a policy that happens to exclude it.

select throws_ok($$ select draft from public.dishes $$,
  '42501', null, 'anon cannot read dishes.draft');
select throws_ok($$ select draft from public.menu_categories $$,
  '42501', null, 'anon cannot read menu_categories.draft');
select throws_ok($$ select draft from public.weekly_special $$,
  '42501', null, 'anon cannot read weekly_special.draft');
select throws_ok($$ select draft from public.monthly_burger $$,
  '42501', null, 'anon cannot read monthly_burger.draft');
select throws_ok($$ select draft from public.announcement $$,
  '42501', null, 'anon cannot read announcement.draft');
select throws_ok($$ select previous from public.announcement $$,
  '42501', null, 'anon cannot read announcement.previous');
select throws_ok($$ select draft from public.opening_hours $$,
  '42501', null, 'anon cannot read opening_hours.draft');
select throws_ok($$ select draft from public.pages $$,
  '42501', null, 'anon cannot read pages.draft');
select throws_ok($$ select draft from public.site_contact $$,
  '42501', null, 'anon cannot read site_contact.draft');


-- ===========================================================================
-- 3. Anonymous cannot read admin-only tables at all
-- ===========================================================================

select throws_ok($$ select id from public.audit_log $$,
  '42501', null, 'anon cannot read audit_log');
select throws_ok($$ select user_id from public.profiles $$,
  '42501', null, 'anon cannot read profiles');
select throws_ok($$ select public.is_staff() $$,
  '42501', null, 'anon cannot execute is_staff()');
select throws_ok($$ select public.is_owner() $$,
  '42501', null, 'anon cannot execute is_owner()');


-- ===========================================================================
-- 4. Anonymous sees live content only
-- ===========================================================================

select is(
  (select count(*) from public.news),
  1::bigint,
  'anon sees only the published news article, never the draft');

select is(
  (select title from public.news),
  'Offentliggjort nyhed',
  'anon sees the published article by name');

select is(
  (select count(*) from public.menu_categories),
  1::bigint,
  'anon does not see a section whose visible flag is false');

-- Of the four fixture dishes, only the published, undeleted ones are public. The dish
-- carrying a draft is itself published, so it is visible — but its draft is not (§2).
select is(
  (select count(*) from public.dishes),
  2::bigint,
  'anon sees neither the never-published dish nor the soft-deleted one');

select is_empty(
  $$ select id from public.dishes where name = 'Aldrig udgivet' $$,
  'a dish that has never been published is invisible to anon');

select is_empty(
  $$ select id from public.dishes where name = 'Slettet ret' $$,
  'a soft-deleted dish is invisible to anon');

select is(
  (select count(*) from public.opening_hours_overrides),
  1::bigint,
  'anon sees only published, future opening-hours overrides');

select is(
  (select count(*) from public.pages),
  2::bigint,
  'anon does not see a page whose visibility toggle is off');

-- The announcement singleton is currently is_visible = false.
select is_empty(
  $$ select id from public.announcement $$,
  'anon does not see an announcement that is switched off');

-- The monthly burger singleton has no name and no window: nothing to show.
select is_empty(
  $$ select id from public.monthly_burger $$,
  'anon does not see an unfilled monthly burger');

select * from finish();
rollback;
