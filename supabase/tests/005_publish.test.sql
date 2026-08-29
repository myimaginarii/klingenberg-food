-- Klingenberg Food — pgTAP: the draft/publish core (technical plan §5, §6, §8, §9).
--
-- Phase 4 moved publishing into the database because §6 requires it to be one
-- transaction. That makes the database, not the application, the place where the
-- promises have to be proved:
--
--   1. a publish is atomic — the merge, the cleared draft and the audit row commit
--      together, and a publish that fails leaves all three exactly as they were;
--   2. optimistic concurrency actually refuses the second writer;
--   3. Staff cannot publish Owner-only content, and Owner can;
--   4. attribution in `audit_log` comes from the JWT and cannot be forged;
--   5. anonymous sessions can reach none of it — not the functions, not the view;
--   6. the one new SECURITY DEFINER function is as narrow as it claims to be.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test. The tests use those real identities rather than hand-written auth
-- rows, so the JWT context matches a genuine session.

begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

-- The seed loads the restaurant's menu and placeholder news. These tests assert exact
-- counts, so that content is cleared inside the transaction; the rollback at the end
-- leaves the developer's database exactly as it was.
delete from public.dishes;
delete from public.menu_categories;
delete from public.news;
delete from public.audit_log;

insert into public.menu_categories (id, slug, name, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'burgere', 'Burgere', 1);

insert into public.dishes (id, category_id, name, description, price_ore, labels) values
  ('22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111',
   'Thor', 'Oksekød, bacon, cheddar.', 12900, array['Populær']);

insert into public.news (id, title, slug, status) values
  ('33333333-3333-4333-8333-333333333331', 'Kladdenyhed', 'kladdenyhed', 'draft');

-- Known starting values for the two page documents the Owner/Staff split runs through.
update public.pages
   set published = '{"heading": "Levende overskrift", "intro": "Levende intro"}'::jsonb
 where key = 'about';
update public.pages
   set published = '{"hero": {"heading": "Levende forside", "intro": "Levende intro"}}'::jsonb
 where key = 'home';

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

-- Switch the session to one of the two identities. Written once so no test can
-- accidentally assert a permission while still holding superuser rights.
--
-- The uuids are resolved above, while still superuser: `authenticated` has no read
-- access to `auth.users` — correctly, that is Supabase's default and this schema does
-- not widen it — so a helper that looked them up after the switch would fail.
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


-- ===========================================================================
-- 1. Anonymous can reach none of the publish machinery (§8)
-- ===========================================================================
--
-- The catalog assertion first, because it cannot rot: a publish function added by a
-- future migration that inherits Supabase's default EXECUTE grant fails this one
-- assertion without anybody remembering to extend the list.

select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like 'publish\_%' or p.proname in ('editor_name', 'log_audit'))
        and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon holds EXECUTE on no publish function, on editor_name or on log_audit');

select is_empty(
  $$ select table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public' and table_name = 'pending_changes' $$,
  'anon holds no privilege at all on the pending_changes view');

select ok(
  has_table_privilege('authenticated', 'public.pending_changes', 'SELECT'),
  'authenticated may select from pending_changes');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
  'audit_log still has row level security enabled');

-- The view must run with the caller's privileges, or it would hand every reader a
-- complete, RLS-free listing of every draft in the system.
select ok(
  (select 'security_invoker=on' = any (c.reloptions)
     from pg_class c where c.oid = 'public.pending_changes'::regclass),
  'pending_changes is a security_invoker view, so RLS decides every row');

-- Every publish function must be SECURITY INVOKER, so RLS re-checks the caller.
select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'publish\_%' and p.prosecdef $$,
  'no publish function is SECURITY DEFINER');

-- Every SECURITY DEFINER function in the schema must pin an empty search_path.
select is_empty(
  $$ select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not coalesce(p.proconfig, '{}') @> array['search_path=""'] $$,
  'every SECURITY DEFINER function pins search_path to the empty string');

select pg_temp.become_anon();

select throws_ok(
  $$ select public.publish_page('00000000-0000-4000-8000-000000000000'::uuid, now()) $$,
  '42501', null, 'anon cannot call publish_page');
select throws_ok(
  $$ select public.publish_dish('00000000-0000-4000-8000-000000000000'::uuid, now()) $$,
  '42501', null, 'anon cannot call publish_dish');
select throws_ok(
  $$ select public.publish_site_contact('00000000-0000-4000-8000-000000000000'::uuid, now()) $$,
  '42501', null, 'anon cannot call publish_site_contact');
select throws_ok(
  $$ select public.editor_name('00000000-0000-4000-8000-000000000000'::uuid) $$,
  '42501', null, 'anon cannot call editor_name');
select throws_ok(
  $$ select entity from public.pending_changes $$,
  '42501', null, 'anon cannot read pending_changes');

reset role;


-- ===========================================================================
-- 2. A publish is one transaction (§6)
-- ===========================================================================

select pg_temp.become_staff();

update public.dishes
   set draft = jsonb_build_object('price_ore', 13900, 'secondary_note', 'Som menu 164 kr.')
 where id = '22222222-2222-4222-8222-222222222221';

-- Nothing is live yet: editing writes to `draft` and leaves the columns alone.
select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  12900,
  'writing a draft does not change the live price');

select is(
  (select count(*) from public.pending_changes where entity = 'dish'),
  1::bigint,
  'the dish appears in pending_changes while it has a draft');

select is(
  (select editor_name from public.pending_changes where entity = 'dish'),
  'Lokal Medarbejder',
  'pending_changes names the person who last edited it');

select is(
  (select subject from public.pending_changes where entity = 'dish'),
  'Thor',
  'pending_changes carries the row''s own name, so the dashboard can label it');

-- --- the publish itself ---
select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222221'),
  'published',
  'staff can publish a dish');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  13900,
  'the draft price is now live');

select is(
  (select secondary_note from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Som menu 164 kr.',
  'every drafted field went live, not only the first');

select is(
  (select description from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Oksekød, bacon, cheddar.',
  'a field the draft did not mention keeps its live value');

select is(
  (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'the draft is cleared by the publish, and only by the publish');

select is(
  (select count(*) from public.pending_changes where entity = 'dish'),
  0::bigint,
  'the dish leaves pending_changes once it is published');

-- --- and the audit row that committed with it ---
--
-- Read back as the superuser, not as staff: `audit_log_select_owner` deliberately
-- denies staff any read of the log (§5), so asserting from the staff session would
-- prove only that the policy works — which 002 already does.
reset role;

select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'dish'),
  1::bigint,
  'publishing wrote exactly one audit row');

select is(
  (select entity_id from public.audit_log where entity = 'dish'),
  '22222222-2222-4222-8222-222222222221'::uuid,
  'the audit row names the entity that was published');

select is(
  (select before ->> 'price_ore' from public.audit_log where entity = 'dish'),
  '12900',
  'the audit row records the previous live value');

select is(
  (select after ->> 'price_ore' from public.audit_log where entity = 'dish'),
  '13900',
  'the audit row records the new live value');

select is(
  (select before ->> 'secondary_note' from public.audit_log where entity = 'dish'),
  null,
  'a field that was empty before is recorded as empty, not omitted');

select is(
  (select actor_id from public.audit_log where entity = 'dish'),
  (select id from auth.users where email = 'staff@example.test'),
  'the audit row is attributed to the JWT subject, not to a parameter');


-- ===========================================================================
-- 3. Null in a draft clears; absence does not (§6)
-- ===========================================================================

select pg_temp.become_staff();

update public.dishes
   set draft = jsonb_build_object('description', null)
 where id = '22222222-2222-4222-8222-222222222221';

select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222221'),
  'published',
  'a draft that clears a field publishes');

select is(
  (select description from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'an explicit null in a draft clears the live value');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  13900,
  'and clearing one field left the others untouched');


-- ===========================================================================
-- 4. Optimistic concurrency (§6)
-- ===========================================================================
--
-- The rule: a publish carries the `updated_at` the editor loaded, and is refused if
-- the row has moved on since. What must be true is that a version token which is not
-- the row's current one changes nothing at all.
--
-- A genuine second writer cannot be simulated here. `tg_touch_row` stamps
-- `updated_at := now()`, and `now()` is the *transaction* timestamp, so every write
-- inside this one pgTAP transaction lands on the same instant — which is correct in
-- production, where each PostgREST request is its own transaction, and unusable for
-- this test. So the stale version is constructed directly, and the two-session case is
-- covered end to end by tests/e2e/draft-publish.spec.ts, where the two saves really are
-- two requests.

select pg_temp.become_staff();

update public.dishes
   set draft = jsonb_build_object('name', 'Thor (B)')
 where id = '22222222-2222-4222-8222-222222222221';

-- The version the first editor loaded, before somebody else saved.
select set_config('test.stale_version',
  (select (updated_at - interval '1 minute')::text from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'), true);

reset role;
select set_config('test.audit_before_conflict',
  (select count(*)::text from public.audit_log), true);
select pg_temp.become_staff();

select is(
  (select public.publish_dish(
     '22222222-2222-4222-8222-222222222221'::uuid,
     current_setting('test.stale_version')::timestamptz) ->> 'status'),
  'conflict',
  'publishing a version somebody else has already replaced is refused');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Thor',
  'the refused publish changed no live value');

select is(
  (select draft ->> 'name' from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Thor (B)',
  'and it did not overwrite the other person''s draft');

reset role;
select is(
  (select count(*) from public.audit_log),
  current_setting('test.audit_before_conflict')::bigint,
  'a refused publish writes no audit row');
select pg_temp.become_staff();

-- The current version does publish, so the refusal was about the version and nothing else.
select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222221'),
  'published',
  'publishing the current version succeeds');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Thor (B)',
  'the other person''s version is what went live');

-- A publish with no version token at all is refused rather than treated as "any".
update public.dishes set draft = jsonb_build_object('name', 'Uden version')
 where id = '22222222-2222-4222-8222-222222222221';

select is(
  (select public.publish_dish('22222222-2222-4222-8222-222222222221'::uuid, null) ->> 'status'),
  'conflict',
  'a publish with no version token is refused');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Thor (B)',
  'and that refusal changed nothing either');


-- ===========================================================================
-- 5. Nothing to publish, and no such row
-- ===========================================================================

update public.dishes set draft = null where id = '22222222-2222-4222-8222-222222222221';

select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222221'),
  'nothing_to_publish',
  'publishing a dish with no draft reports nothing to publish');

select is(
  (select public.publish_dish('00000000-0000-4000-8000-000000000000'::uuid, now()) ->> 'status'),
  'not_found',
  'publishing an id that does not exist reports not found');


-- ===========================================================================
-- 6. Staff cannot publish Owner-only content; Owner can (§5)
-- ===========================================================================

reset role;
update public.pages
   set draft = '{"hero": {"heading": "Overtaget forside", "intro": null}}'::jsonb
 where key = 'home';
update public.site_contact set draft = '{"primary_phone": "+45 00 00 00 00"}'::jsonb;
update public.opening_hours
   set draft = jsonb_build_object('schedule', jsonb_build_object(
     'mon', jsonb_build_object('closed', true),
     'tue', jsonb_build_object('closed', true),
     'wed', jsonb_build_object('closed', true),
     'thu', jsonb_build_object('closed', true),
     'fri', jsonb_build_object('closed', true),
     'sat', jsonb_build_object('closed', true),
     'sun', jsonb_build_object('from', '12:00', 'to', '20:00')));

select set_config('test.audit_before_owner_tests',
  (select count(*)::text from public.audit_log), true);

select pg_temp.become_staff();

-- Staff may *see* that the Forsiden has a pending change — that is how the dashboard
-- can say who is waiting on the owner — but may not publish it.
select is(
  (select count(*) from public.pending_changes where entity = 'page:home'),
  1::bigint,
  'staff sees that Forsiden has a pending change');

select is(
  (select public.publish_page(p.id, p.updated_at) ->> 'status' from public.pages p where p.key = 'home'),
  'forbidden',
  'staff cannot publish the owner-only Forsiden');

select is(
  (select published -> 'hero' ->> 'heading' from public.pages where key = 'home'),
  'Levende forside',
  'the refused publish left the live Forsiden unchanged');

select is(
  (select draft -> 'hero' ->> 'heading' from public.pages where key = 'home'),
  'Overtaget forside',
  'and left the draft intact for the owner to publish');

select is(
  (select public.publish_site_contact(c.id, c.updated_at) ->> 'status' from public.site_contact c),
  'forbidden',
  'staff cannot publish the owner-only contact facts');

select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status' from public.opening_hours h),
  'forbidden',
  'staff cannot publish the owner-only opening hours');

reset role;
select is(
  (select count(*) from public.audit_log),
  current_setting('test.audit_before_owner_tests')::bigint,
  'three refused publishes wrote no audit row between them');

-- Staff *can* publish the two staff-editable page documents.
reset role;
update public.pages set draft = '{"heading": "Ny Om os-overskrift"}'::jsonb where key = 'about';
select pg_temp.become_staff();

select is(
  (select public.publish_page(p.id, p.updated_at) ->> 'status' from public.pages p where p.key = 'about'),
  'published',
  'staff can publish the staff-editable Om os page');

select is(
  (select published ->> 'heading' from public.pages where key = 'about'),
  'Ny Om os-overskrift',
  'the drafted section went live');

select is(
  (select published ->> 'intro' from public.pages where key = 'about'),
  'Levende intro',
  'a section the draft did not mention survived the shallow merge');

-- Every audit row in this transaction carries the same `created_at` — `now()` is the
-- transaction timestamp — so the row is found by what it says, not by being last.
reset role;
select is(
  (select count(*) from public.audit_log where entity = 'page:about'),
  1::bigint,
  'the audit row names the page that was published, not just the table');

-- --- and the owner can do what staff could not ---
select pg_temp.become_owner();

select is(
  (select public.publish_page(p.id, p.updated_at) ->> 'status' from public.pages p where p.key = 'home'),
  'published',
  'the owner can publish the Forsiden');

select is(
  (select published -> 'hero' ->> 'heading' from public.pages where key = 'home'),
  'Overtaget forside',
  'and the Forsiden draft is now live');

select is(
  (select draft from public.pages where key = 'home'),
  null,
  'the Forsiden draft was cleared by the publish');

select is(
  (select public.publish_site_contact(c.id, c.updated_at) ->> 'status' from public.site_contact c),
  'published',
  'the owner can publish the contact facts');

select is(
  (select primary_phone from public.site_contact),
  '+45 00 00 00 00',
  'and the contact draft is now live');

select is(
  (select public.publish_opening_hours(h.id, h.updated_at) ->> 'status' from public.opening_hours h),
  'published',
  'the owner can publish the opening hours');

select is(
  (select schedule -> 'sun' ->> 'from' from public.opening_hours),
  '12:00',
  'and the opening-hours draft is now live');

reset role;
select is(
  (select actor_id from public.audit_log where entity = 'page:home'),
  (select id from auth.users where email = 'owner@example.test'),
  'the Forsiden publish is attributed to the owner who performed it');


-- ===========================================================================
-- 7. A publish the database refuses leaves nothing behind (§6)
-- ===========================================================================
--
-- The announcement's link fields must agree with each other; the CHECK constraint is
-- the authority. A draft that would break it must roll the whole publish back: no
-- merge, no cleared draft, and no audit row claiming it happened.

update public.announcement
   set message = 'Levende besked', link_type = 'none', is_visible = true,
       expires_at = now() + interval '1 day';

update public.announcement
   set draft = jsonb_build_object('link_url', 'https://noget.test/side');

select set_config('test.audit_before_failure',
  (select count(*)::text from public.audit_log), true);

select pg_temp.become_staff();

select throws_ok(
  $$ select public.publish_announcement(a.id, a.updated_at) from public.announcement a $$,
  '23514', null,
  'a publish that would violate a constraint raises rather than half-succeeding');

reset role;

select is(
  (select message from public.announcement),
  'Levende besked',
  'the failed publish left the live announcement unchanged');

select is(
  (select link_url from public.announcement),
  null,
  'and did not apply the offending field');

select is(
  (select draft ->> 'link_url' from public.announcement),
  'https://noget.test/side',
  'the draft survived the failed publish');

select is(
  (select count(*) from public.audit_log),
  current_setting('test.audit_before_failure')::bigint,
  'a failed publish committed no audit row');


-- ===========================================================================
-- 8. News and one-off overrides publish by status (§4)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select state from public.pending_changes where entity = 'news'),
  'unpublished',
  'an unpublished article is pending with the state "unpublished", not "draft"');

select is(
  (select public.publish_news(n.id, n.updated_at) ->> 'status' from public.news n
    where n.id = '33333333-3333-4333-8333-333333333331'),
  'published',
  'staff can publish an article');

select is(
  (select status from public.news where id = '33333333-3333-4333-8333-333333333331'),
  'published',
  'the article is now published');

select ok(
  (select published_at is not null from public.news
    where id = '33333333-3333-4333-8333-333333333331'),
  'and published_at was stamped');

select is(
  (select public.publish_news(n.id, n.updated_at) ->> 'status' from public.news n
    where n.id = '33333333-3333-4333-8333-333333333331'),
  'nothing_to_publish',
  'publishing an already-published article reports nothing to publish');


-- ===========================================================================
-- 9. editor_name is as narrow as it claims (§6)
-- ===========================================================================
--
-- The one new SECURITY DEFINER function. It exists so a staff member can see who last
-- edited a pending change without being handed the whole profiles table; these
-- assertions are what keep that claim honest.

select is(
  (select public.editor_name(current_setting('test.owner_uid')::uuid)),
  'Lokal Ejer',
  'staff can resolve a colleague''s display name');

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'and still sees exactly one profile row — their own');

select is(
  (select public.editor_name(null)),
  null,
  'editor_name answers null for an unattributed row rather than raising');

select is(
  (select public.editor_name('00000000-0000-4000-8000-000000000000'::uuid)),
  null,
  'and null for a uuid that is not a profile');

-- A session that holds EXECUTE but is not staff is still refused inside the function.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-000000000000', 'role', 'authenticated')::text,
  true);
set local role authenticated;

select throws_ok(
  $$ select public.editor_name('00000000-0000-4000-8000-000000000000'::uuid) $$,
  '42501', null,
  'an authenticated session with no profile cannot call editor_name');

select is_empty(
  $$ select entity from public.pending_changes $$,
  'and sees no pending changes, because RLS returns it no rows');

reset role;

select * from finish();
rollback;
