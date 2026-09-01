-- Klingenberg Food — pgTAP: the news administration (§4, §5, §6, §7f). **Phase 9A.**
--
-- News is the entity with **no draft column**: a row is pending while its `status` is
-- 'draft', an edit writes the row itself, and the two trusted transitions move the
-- status — `publish_news()` (phase 4) and `unpublish_news()` (phase 9A) — with
-- `delete_news()` (phase 9A) as the audited way out. This suite proves the §5 matrix
-- row ("Nyheder: write, publish, unpublish — Staff yes, Owner yes") from **real Staff
-- and Owner JWTs**, proves a guest can neither write nor read anything unpublished,
-- and proves §7f's slug freeze at the layer that owns it.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–018.

begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- Fixtures — the same shape as 018's
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

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

create function pg_temp.become_anon() returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$fn$;

create function pg_temp.article(p_slug text) returns uuid
language sql security definer set search_path = '' as $fn$
  select id from public.news where slug = p_slug
$fn$;

create function pg_temp.v(p_slug text) returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.news where slug = p_slug
$fn$;

create function pg_temp.audit_total() returns bigint
language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

create function pg_temp.body(p_text text) returns jsonb language sql as $fn$
  select jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'spans', jsonb_build_array(
      jsonb_build_object('text', p_text)))))
$fn$;

/* Unrelated content, fingerprinted so "untouched" is a probe rather than a hope. */
create function pg_temp.announcement_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(a) from public.announcement a limit 1
$fn$;

create function pg_temp.week_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

create function pg_temp.menu_state() returns text
language sql security definer set search_path = '' as $fn$
  select md5(string_agg(d.id::text || d.name || d.updated_at::text, ',' order by d.id))
    from public.dishes d
$fn$;

select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.week_before', pg_temp.week_state()::text, true);
select set_config('test.menu_before', pg_temp.menu_state(), true);

-- ===========================================================================
-- 1. The model: the two phase-9A functions, and the freeze trigger
-- ===========================================================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'unpublish_news'),
  1,
  'there is exactly one unpublish function');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_news'),
  1,
  'and exactly one delete function');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in ('publish_news', 'unpublish_news', 'delete_news',
                        'tg_freeze_published_slug')),
  0,
  'no news function is SECURITY DEFINER — RLS decides for every caller (§8)');

select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'unpublish_news'),
  array['search_path=""'],
  'unpublish_news pins its search_path, like every function in this schema');

select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_news'),
  array['search_path=""'],
  'and so does delete_news');

select ok(
  has_function_privilege('authenticated', 'public.unpublish_news(uuid, timestamptz)', 'EXECUTE'),
  'staff and owner may call unpublish_news');

select ok(
  not has_function_privilege('anon', 'public.unpublish_news(uuid, timestamptz)', 'EXECUTE'),
  'and a guest may not');

select ok(
  has_function_privilege('authenticated', 'public.delete_news(uuid, timestamptz)', 'EXECUTE'),
  'staff and owner may call delete_news');

select ok(
  not has_function_privilege('anon', 'public.delete_news(uuid, timestamptz)', 'EXECUTE'),
  'and a guest may not');

select has_trigger('public', 'news', 'news_freeze_slug',
  'the §7f slug freeze is the database''s own rule, not only the application''s');

-- ===========================================================================
-- 2. Staff: write (§5)
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  $$ insert into public.news (title, slug, body, category, display_date, status)
     values ('Testnyhed A', 'testnyhed-a', pg_temp.body('Første afsnit.'),
             'Lukket', current_date, 'draft') $$,
  'staff can create a draft article');

select lives_ok(
  format($$ update public.news
              set title = 'Testnyhed A, rettet', body = pg_temp.body('Rettet tekst.')
            where id = %L and updated_at = %L $$,
         pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')),
  'staff can edit their draft, version-guarded');

-- A stale token writes zero rows and nothing else: no silent overwrite (§6).
update public.news
   set title = 'Må ikke vinde'
 where id = pg_temp.article('testnyhed-a')
   and updated_at = pg_temp.v('testnyhed-a') - interval '1 hour';

reset role;
select is(
  (select title from public.news where slug = 'testnyhed-a'),
  'Testnyhed A, rettet',
  'a stale version token updates nothing — no silent overwrite');

select is(
  (select count(*)::int from public.pending_changes
    where entity = 'news' and entity_id = pg_temp.article('testnyhed-a')
      and state = 'unpublished'),
  1,
  'the draft article is pending, through its status alone (§4)');

-- ===========================================================================
-- 3. A guest sees nothing unpublished, and writes nothing at all
-- ===========================================================================

select pg_temp.become_anon();

select is(
  (select count(*)::int from public.news n where n.slug = 'testnyhed-a'),
  0,
  'an unpublished article does not exist for a guest');

select throws_ok(
  $$ select status from public.news $$,
  '42501',
  null,
  'a guest cannot even name the status column — it is not in the grant (§8)');

select throws_ok(
  $$ insert into public.news (title, slug, status) values ('Gæst', 'gaest', 'draft') $$,
  '42501',
  null,
  'a guest cannot create an article');

select throws_ok(
  $$ update public.news set title = 'Hacket' $$,
  '42501',
  null,
  'a guest cannot edit one');

select throws_ok(
  $$ delete from public.news $$,
  '42501',
  null,
  'a guest cannot delete one');

select throws_ok(
  format($$ select public.publish_news(%L, now()) $$, pg_temp.article('testnyhed-a')),
  '42501',
  null,
  'a guest cannot call publish_news');

select throws_ok(
  format($$ select public.unpublish_news(%L, now()) $$, pg_temp.article('testnyhed-a')),
  '42501',
  null,
  'nor unpublish_news');

select throws_ok(
  format($$ select public.delete_news(%L, now()) $$, pg_temp.article('testnyhed-a')),
  '42501',
  null,
  'nor delete_news');

-- ===========================================================================
-- 4. Malformed articles are refused by the schema (§12 of the phase brief)
-- ===========================================================================

select pg_temp.become_staff();

select throws_ok(
  $$ insert into public.news (title, slug, status)
     values ('Dublet', 'testnyhed-a', 'draft') $$,
  '23505',
  null,
  'a duplicate slug is refused — the UNIQUE constraint is §7f''s final gate');

select throws_ok(
  $$ insert into public.news (title, slug, status)
     values ('Forkert status', 'forkert-status', 'scheduled') $$,
  '23514',
  null,
  'a status outside draft/published is refused');

select throws_ok(
  $$ insert into public.news (title, slug, status) values ('   ', 'blank-titel', 'draft') $$,
  '23514',
  null,
  'a blank title is refused');

select throws_ok(
  $$ insert into public.news (title, slug, status) values ('Skæv adresse', 'Skæv Adresse!', 'draft') $$,
  '23514',
  null,
  'a slug outside the grammar is refused');

select throws_ok(
  $$ insert into public.news (title, slug, body, status)
     values ('Skæv krop', 'skaev-krop', '"bare en streng"'::jsonb, 'draft') $$,
  '23514',
  null,
  'a body that is not a JSON object is refused');

select throws_ok(
  $$ insert into public.news (title, slug, status, published_at)
     values ('Uden stempel', 'uden-stempel', 'published', null) $$,
  '23514',
  null,
  'published without published_at is refused');

reset role;
select is(pg_temp.audit_total(), 0::bigint,
  'and none of the refusals wrote an audit row');

-- ===========================================================================
-- 5. Staff: publish (§5, §6)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-a'),
     pg_temp.v('testnyhed-a') - interval '1 hour') ->> 'status'),
  'conflict',
  'publishing with a stale version token is a conflict, and nothing moves');

reset role;
select is(pg_temp.audit_total(), 0::bigint,
  'a refused publish writes no audit row');

select pg_temp.become_staff();

select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'status'),
  'published',
  'staff can publish the article');

reset role;

select is(
  (select status from public.news where slug = 'testnyhed-a'),
  'published',
  'the status flipped');

select ok(
  (select published_at is not null from public.news where slug = 'testnyhed-a'),
  'and published_at is stamped');

select set_config('test.first_published_at',
  (select published_at::text from public.news where slug = 'testnyhed-a'), true);

select is(
  (select count(*)::int from public.audit_log
    where action = 'publish' and entity = 'news'
      and entity_id = pg_temp.article('testnyhed-a')
      and actor_id = current_setting('test.staff_uid')::uuid),
  1,
  'the publish wrote one audit row, attributed to the staff member from the JWT');

select is(
  (select count(*)::int from public.pending_changes
    where entity = 'news' and entity_id = pg_temp.article('testnyhed-a')),
  0,
  'a published article is no longer pending');

select pg_temp.become_anon();
select is(
  (select count(*)::int from public.news n where n.slug = 'testnyhed-a'),
  1,
  'a guest can read it now');

select pg_temp.become_staff();
select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'status'),
  'nothing_to_publish',
  'publishing it again publishes nothing');

-- ===========================================================================
-- 6. §7f: the slug is frozen at first publish
-- ===========================================================================

select throws_ok(
  format($$ update public.news set slug = 'nyt-navn' where id = %L $$,
         pg_temp.article('testnyhed-a')),
  '23514',
  null,
  'the slug of a published article cannot be changed — the trigger refuses');

select lives_ok(
  format($$ update public.news set title = 'Helt ny overskrift' where id = %L $$,
         pg_temp.article('testnyhed-a')),
  'editing the title of a published article is allowed');

reset role;
select is(
  (select slug from public.news where id = pg_temp.article('testnyhed-a')),
  'testnyhed-a',
  'and deliberately leaves the URL untouched (§7f)');

-- ===========================================================================
-- 7. Staff: unpublish (§7f)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.unpublish_news(
     pg_temp.article('testnyhed-a'),
     pg_temp.v('testnyhed-a') - interval '1 hour') ->> 'status'),
  'conflict',
  'unpublishing with a stale token is a conflict');

reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'unpublish'),
  0,
  'and it wrote no audit row');

select pg_temp.become_staff();
select is(
  (select public.unpublish_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'status'),
  'unpublished',
  'staff can take the article off the hjemmeside');

reset role;

select is(
  (select status from public.news where slug = 'testnyhed-a'),
  'draft',
  'the status is draft again — the row survives (§7f)');

select is(
  (select published_at::text from public.news where slug = 'testnyhed-a'),
  current_setting('test.first_published_at'),
  'published_at survives the unpublish — it is what keeps the slug frozen');

select is(
  (select count(*)::int from public.audit_log
    where action = 'unpublish' and entity = 'news'
      and entity_id = pg_temp.article('testnyhed-a')),
  1,
  'the unpublish wrote one audit row');

select pg_temp.become_anon();
select is(
  (select count(*)::int from public.news n where n.slug = 'testnyhed-a'),
  0,
  'the article is gone for a guest — the address will answer 404');

select pg_temp.become_staff();
select is(
  (select public.unpublish_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'status'),
  'nothing_to_unpublish',
  'unpublishing it again removes nothing');

select throws_ok(
  format($$ update public.news set slug = 'nyt-navn' where id = %L $$,
         pg_temp.article('testnyhed-a')),
  '23514',
  null,
  'the slug stays frozen while unpublished — a shared link must work again on republish');

select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'status'),
  'published',
  'republishing restores the article');

reset role;
select is(
  (select published_at::text from public.news where slug = 'testnyhed-a'),
  current_setting('test.first_published_at'),
  'with its original publication instant, not an invented new one (§7f)');

-- ===========================================================================
-- 8. Owner: the same capabilities (§5)
-- ===========================================================================

select pg_temp.become_owner();

select lives_ok(
  $$ insert into public.news (title, slug, body, status)
     values ('Testnyhed B', 'testnyhed-b', pg_temp.body('Ejerens tekst.'), 'draft') $$,
  'the owner can create an article');

select lives_ok(
  format($$ update public.news set title = 'Testnyhed B, rettet'
            where id = %L and updated_at = %L $$,
         pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')),
  'the owner can edit it');

select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')) ->> 'status'),
  'published',
  'the owner can publish it');

select is(
  (select public.unpublish_news(
     pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')) ->> 'status'),
  'unpublished',
  'and take it down again — news is never Owner-only, and never Staff-only');

-- ===========================================================================
-- 9. Phase 10's column is preserved, never cleared
-- ===========================================================================

select pg_temp.become_staff();

insert into public.images (storage_path) values ('test/nyhed-foto.jpg');

update public.news
   set image_id = (select id from public.images where storage_path = 'test/nyhed-foto.jpg')
 where id = pg_temp.article('testnyhed-b');

select is(
  (select public.publish_news(
     pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')) ->> 'status'),
  'published',
  'a republish over an image reference succeeds');

select is(
  (select public.unpublish_news(
     pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')) ->> 'status'),
  'unpublished',
  'and so does the unpublish');

reset role;
select is(
  (select image_id from public.news where slug = 'testnyhed-b'),
  (select id from public.images where storage_path = 'test/nyhed-foto.jpg'),
  'image_id survives both transitions untouched — phase 10''s column is not this phase''s to move');

-- ===========================================================================
-- 10. Delete — audited, version-checked, and the audit is the recovery story
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.delete_news(
     pg_temp.article('testnyhed-a'),
     pg_temp.v('testnyhed-a') - interval '1 hour') ->> 'status'),
  'conflict',
  'deleting with a stale token is a conflict');

reset role;
select is(
  (select count(*)::int from public.news where slug = 'testnyhed-a'),
  1,
  'and the article survives it');

select pg_temp.become_staff();

select is(
  (select public.delete_news(
     pg_temp.article('testnyhed-a'), pg_temp.v('testnyhed-a')) ->> 'was_published'),
  'true',
  'deleting the published article reports that a guest could see it');

reset role;

select is(
  (select count(*)::int from public.news where slug = 'testnyhed-a'),
  0,
  'the published article is gone');

select is(
  (select before ->> 'title' from public.audit_log
    where action = 'delete' and entity = 'news'
    order by created_at desc limit 1),
  'Helt ny overskrift',
  'and its whole content is in the audit row — the recovery story (§4)');

select pg_temp.become_staff();

select is(
  (select public.delete_news(
     pg_temp.article('testnyhed-b'), pg_temp.v('testnyhed-b')) ->> 'was_published'),
  'false',
  'deleting the draft article reports it was not public');

reset role;
select is(
  (select count(*)::int from public.news where slug in ('testnyhed-a', 'testnyhed-b')),
  0,
  'both test articles are gone — the suite restores the seeded state');

select is(
  (select count(*)::int from public.audit_log where action = 'delete' and entity = 'news'),
  2,
  'each deletion wrote exactly one audit row');

-- ===========================================================================
-- 11. Nothing else moved
-- ===========================================================================

select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — news writes touch no other content');

select is(
  pg_temp.week_state()::text,
  current_setting('test.week_before'),
  'the opening hours are byte-identical');

select is(
  pg_temp.menu_state(),
  current_setting('test.menu_before'),
  'and every dish is byte-identical');

select is(
  (select count(*)::int from public.news where status = 'published'),
  3,
  'the three seeded articles stand exactly as the seed left them');

select * from finish();
rollback;
