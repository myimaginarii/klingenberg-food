-- Klingenberg Food — pgTAP: the trusted image transitions report the references
-- they moved (technical plan §6, §15 phase 10C-2, §20; migration 20260901220000).
--
-- The subject is the `affected` reply of delete_image() and replace_image(): the
-- authoritative, per-kind counts of the LIVE rows (a guest could see) and the
-- draft rows (a guest could not) each transition moved — read from the
-- transition's own statements, inside its one transaction — so the application
-- can expire exactly the public cache tags whose HTML changed and no others.
-- Proved from real Staff, Owner and anonymous JWTs:
--
--   1. structure — both functions stay SECURITY INVOKER with search_path pinned,
--      and anon may not execute either;
--   2. delete_image() — a refused delete (unconfirmed, stale) carries no affected
--      set and moves nothing; a confirmed delete over a live dish, a soft-deleted
--      dish, the live weekly singleton, a monthly draft, a published article and a
--      draft article reports exactly which of those a guest could see; a
--      draft-only image reports live zeros; an unreferenced image reports zeros;
--   3. replace_image() — a stale replacement carries no affected set; a
--      multi-entity replacement (two dishes, the weekly singleton, a monthly
--      draft, a published article) reports its live and draft counts and moves
--      every reference; an unreferenced and a draft-only replacement report live
--      zeros;
--   4. the guard from 20260901200000 still holds afterwards — a direct write of a
--      live image_id is refused for Staff and Owner, and anon is refused the
--      transitions outright;
--   5. unrelated content is byte-identical — the announcement, the opening hours
--      and every dish outside the fixtures.
--
-- Nothing here tests the Next.js cache: which tag a kind maps to is
-- lib/images/cache-impact.ts's, pinned by its unit suite. This suite proves the
-- counts that mapping is fed. Since phase 11A the document carries a fifth kind,
-- `page:home`; none of these fixtures names the Forside, so it reports zero here
-- and its own counts are proved in 025.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–023.

begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

-- ---------------------------------------------------------------------------
-- Fixtures and identity check
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;
delete from public.images;

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

/*
 * The fixture door for a LIVE image reference: sets it as the table owner, the
 * way seed.sql would — the one way left for a test to put a live reference in
 * place without walking a whole publish (the 023 precedent). SECURITY DEFINER is
 * the test's own privilege, never the application's.
 */
create function pg_temp.fixture_live_image(p_kind text, p_image uuid, p_name text default 'Thor')
returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  case p_kind
    when 'dish'    then update public.dishes set image_id = p_image where name = p_name;
    when 'weekly'  then update public.weekly_special set image_id = p_image;
    when 'monthly' then update public.monthly_burger set image_id = p_image;
  end case;
end;
$fn$;

/* A pending selection, written the way the picker action writes it. */
create function pg_temp.fixture_draft_image(p_kind text, p_image uuid, p_name text default 'Thor')
returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  case p_kind
    when 'dish'    then update public.dishes set draft = jsonb_build_object('image_id', p_image::text) where name = p_name;
    when 'weekly'  then update public.weekly_special set draft = jsonb_build_object('image_id', p_image::text);
    when 'monthly' then update public.monthly_burger set draft = jsonb_build_object('image_id', p_image::text);
  end case;
end;
$fn$;

/* Unrelated content, fingerprinted so "untouched" is a probe rather than a hope. */
create function pg_temp.announcement_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(a) from public.announcement a limit 1
$fn$;

create function pg_temp.hours_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

/* The menu apart from the two fixtures, Thor and Odin. */
create function pg_temp.menu_state() returns text
language sql security definer set search_path = '' as $fn$
  select md5(string_agg(d.id::text || d.name || d.updated_at::text, ',' order by d.id))
    from public.dishes d
   where d.name not in ('Thor', 'Odin')
$fn$;

select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.hours_before', pg_temp.hours_state()::text, true);
select set_config('test.menu_before', pg_temp.menu_state(), true);
select set_config('test.news_before', (select count(*) from public.news)::text, true);

/* A valid derivatives document for a 1600 x 1200 original. */
create function pg_temp.good_derivatives() returns jsonb
language sql as $fn$
  select '{"formats": ["avif", "webp"],
           "widths": [{"width": 480, "height": 360},
                      {"width": 960, "height": 720},
                      {"width": 1440, "height": 1080}]}'::jsonb
$fn$;

/* One image through the one door in, its result stored under a setting name. */
create function pg_temp.make_image(setting text, path text) returns void
language plpgsql as $fn$
begin
  perform set_config(setting,
    public.create_image(path, 'image/jpeg', 1600, 1200, 250000, null,
                        pg_temp.good_derivatives())::text,
    true);
end;
$fn$;

create function pg_temp.img(setting text) returns uuid
language sql as $fn$
  select (current_setting(setting)::jsonb ->> 'id')::uuid
$fn$;

create function pg_temp.img_version(setting text) returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.images where id = pg_temp.img(setting)
$fn$;

create function pg_temp.dish_image(p_name text) returns uuid
language sql security definer set search_path = '' as $fn$
  select image_id from public.dishes where name = p_name
$fn$;
create function pg_temp.weekly_image() returns uuid
language sql security definer set search_path = '' as $fn$
  select image_id from public.weekly_special limit 1
$fn$;
create function pg_temp.monthly_draft_image() returns text
language sql security definer set search_path = '' as $fn$
  select draft ->> 'image_id' from public.monthly_burger limit 1
$fn$;
create function pg_temp.news_image(p_slug text) returns uuid
language sql security definer set search_path = '' as $fn$
  select image_id from public.news where slug = p_slug
$fn$;

-- ===========================================================================
-- 1. Structure
-- ===========================================================================

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_image'),
  false,
  'delete_image() is still SECURITY INVOKER');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'replace_image'),
  false,
  'replace_image() is still SECURITY INVOKER');

select ok(
  not has_function_privilege('anon', 'public.delete_image(uuid, timestamptz, boolean)', 'EXECUTE'),
  'anon may not execute delete_image()');

select ok(
  not has_function_privilege('anon', 'public.replace_image(uuid, timestamptz, uuid)', 'EXECUTE'),
  'anon may not execute replace_image()');

-- ===========================================================================
-- 2. delete_image() reports what a guest could see
-- ===========================================================================

select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1/original.jpg');
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbe1/original.jpg');
select pg_temp.make_image('test.c', 'cccccccc-cccc-4ccc-8ccc-cccccccccce1/original.jpg');
reset role;

-- Image A: live on Thor, live on a soft-deleted Odin, live on the weekly singleton,
-- pending on the monthly burger, on a published article and on a draft article.
select pg_temp.fixture_live_image('dish', pg_temp.img('test.a'), 'Thor');
select pg_temp.fixture_live_image('dish', pg_temp.img('test.a'), 'Odin');
update public.dishes set deleted_at = now() where name = 'Odin';
select pg_temp.fixture_live_image('weekly', pg_temp.img('test.a'));
select pg_temp.fixture_draft_image('monthly', pg_temp.img('test.a'));
insert into public.news (title, slug, body, status, published_at, image_id)
values ('pgTAP-cache-live', 'pgtap-cache-live', '{"blocks": []}'::jsonb, 'published', now(),
        pg_temp.img('test.a')),
       ('pgTAP-cache-kladde', 'pgtap-cache-kladde', '{"blocks": []}'::jsonb, 'draft', null,
        pg_temp.img('test.a'));

-- Image B: pending only — on Thor's draft and the monthly draft.
-- (Thor's draft is set after A's tests, because a dish carries one draft.)

select pg_temp.become_staff();

-- a) an unconfirmed delete refuses, and carries no affected set
select set_config('test.del_unconfirmed',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), false))::text,
  true);

select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'status'), 'in_use',
  'an image with six references refuses an unconfirmed delete');
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'references'), '6',
  'and counts all six — live, hidden and pending alike');
select ok(
  not (current_setting('test.del_unconfirmed')::jsonb ? 'affected'),
  'a refused delete reports no affected set — nothing moved, nothing to expire');

-- b) a stale delete refuses, and carries no affected set
select set_config('test.del_stale',
  (select public.delete_image(pg_temp.img('test.a'),
                              pg_temp.img_version('test.a') - interval '1 second', true))::text,
  true);

select is(
  (current_setting('test.del_stale')::jsonb ->> 'status'), 'conflict',
  'a stale confirmed delete is a conflict');
select ok(
  not (current_setting('test.del_stale')::jsonb ? 'affected'),
  'and reports no affected set');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.a'),
  'and moved nothing — Thor still carries A');

-- c) the confirmed delete reports exactly what a guest could see
select set_config('test.del',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text,
  true);

select is(
  (current_setting('test.del')::jsonb ->> 'status'), 'deleted',
  'the confirmed delete goes through');
select is(
  (current_setting('test.del')::jsonb ->> 'references'), '6',
  'and still reports the total reference count, as 10C-1 defined it');
select is(
  (current_setting('test.del')::jsonb -> 'affected' -> 'live'),
  '{"dish": 1, "weekly": 1, "monthly": 0, "news": 1, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'affected.live: Thor, the weekly singleton and the published article — what a guest could see');
select is(
  (current_setting('test.del')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 1, "weekly": 0, "monthly": 1, "news": 1, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'affected.draft: the soft-deleted Odin, the monthly draft and the draft article — what no guest could see');

select is(pg_temp.dish_image('Thor'), null::uuid, 'Thor is detached');
select is(pg_temp.dish_image('Odin'), null::uuid, 'the soft-deleted Odin is detached too');
select is(pg_temp.weekly_image(), null::uuid, 'the weekly singleton is detached');
select is(pg_temp.monthly_draft_image(), null::text, 'the monthly draft no longer names the image');
select is(pg_temp.news_image('pgtap-cache-live'), null::uuid, 'the published article is detached');
select is(pg_temp.news_image('pgtap-cache-kladde'), null::uuid, 'the draft article is detached');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.a')), 0::bigint,
  'and the row is gone');

-- d) a draft-only image reports live zeros
reset role;
select pg_temp.fixture_draft_image('dish', pg_temp.img('test.b'), 'Thor');
select pg_temp.fixture_draft_image('monthly', pg_temp.img('test.b'));
select pg_temp.become_staff();

select set_config('test.del_b',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text,
  true);

select is(
  (current_setting('test.del_b')::jsonb -> 'affected' -> 'live'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'a draft-only image reports no live reference — nothing public to expire');
select is(
  (current_setting('test.del_b')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 1, "weekly": 0, "monthly": 1, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'and exactly its two pending references');

-- e) an unreferenced image reports zeros everywhere
select set_config('test.del_c',
  (select public.delete_image(pg_temp.img('test.c'), pg_temp.img_version('test.c'), false))::text,
  true);

select is(
  (current_setting('test.del_c')::jsonb -> 'affected'),
  '{"live": {"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0},
    "draft": {"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}}'::jsonb,
  'an unreferenced image reports zeros everywhere');

-- ===========================================================================
-- 3. replace_image() reports what it repointed
-- ===========================================================================

reset role;
update public.dishes set deleted_at = null where name = 'Odin';

select pg_temp.become_staff();
select pg_temp.make_image('test.d', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1/original.jpg');
select pg_temp.make_image('test.e', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/original.jpg');
select pg_temp.make_image('test.g', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1/original.jpg');
select pg_temp.make_image('test.h', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2/original.jpg');
select pg_temp.make_image('test.i', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3/original.jpg');
reset role;

-- Image D: live on Thor and Odin, live on the weekly singleton, pending on the
-- monthly burger, and on the published article.
select pg_temp.fixture_live_image('dish', pg_temp.img('test.d'), 'Thor');
select pg_temp.fixture_live_image('dish', pg_temp.img('test.d'), 'Odin');
select pg_temp.fixture_live_image('weekly', pg_temp.img('test.d'));
select pg_temp.fixture_draft_image('monthly', pg_temp.img('test.d'));
update public.news set image_id = pg_temp.img('test.d') where slug = 'pgtap-cache-live';

select pg_temp.become_owner();

-- a) a stale replacement refuses, and carries no affected set
select set_config('test.rep_stale',
  (select public.replace_image(pg_temp.img('test.d'),
                               pg_temp.img_version('test.d') - interval '1 second',
                               pg_temp.img('test.e')))::text,
  true);

select is(
  (current_setting('test.rep_stale')::jsonb ->> 'status'), 'conflict',
  'a stale replacement is a conflict');
select ok(
  not (current_setting('test.rep_stale')::jsonb ? 'affected'),
  'and reports no affected set');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.d'),
  'and moved nothing — Thor still carries D');

-- b) the multi-entity replacement, as Owner
select set_config('test.rep',
  (select public.replace_image(pg_temp.img('test.d'), pg_temp.img_version('test.d'),
                               pg_temp.img('test.e')))::text,
  true);

select is(
  (current_setting('test.rep')::jsonb ->> 'status'), 'replaced',
  'the replacement goes through for Owner');
select is(
  (current_setting('test.rep')::jsonb ->> 'references'), '5',
  'and still reports the total moved count, as 10B defined it');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'live'),
  '{"dish": 2, "weekly": 1, "monthly": 0, "news": 1, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'affected.live: both dishes, the weekly singleton and the published article');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 0, "weekly": 0, "monthly": 1, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'affected.draft: the monthly draft alone');

select is(pg_temp.dish_image('Thor'), pg_temp.img('test.e'), 'Thor now carries E');
select is(pg_temp.dish_image('Odin'), pg_temp.img('test.e'), 'Odin now carries E');
select is(pg_temp.weekly_image(), pg_temp.img('test.e'), 'the weekly singleton now carries E');
select is(
  pg_temp.monthly_draft_image(), pg_temp.img('test.e')::text,
  'the monthly draft now names E');
select is(
  pg_temp.news_image('pgtap-cache-live'), pg_temp.img('test.e'),
  'the published article now carries E');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.d')), 0::bigint,
  'and D is gone');

-- c) an unreferenced replacement reports zeros
reset role;
select pg_temp.become_staff();

select set_config('test.rep_g',
  (select public.replace_image(pg_temp.img('test.g'), pg_temp.img_version('test.g'),
                               pg_temp.img('test.h')))::text,
  true);

select is(
  (current_setting('test.rep_g')::jsonb ->> 'status'), 'replaced',
  'an unreferenced image is replaced');
select is(
  (current_setting('test.rep_g')::jsonb -> 'affected'),
  '{"live": {"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0},
    "draft": {"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}}'::jsonb,
  'and reports zeros everywhere — nothing public to expire');

-- d) a draft-only replacement reports live zeros
reset role;
select pg_temp.fixture_draft_image('monthly', pg_temp.img('test.h'));
select pg_temp.become_staff();

select set_config('test.rep_h',
  (select public.replace_image(pg_temp.img('test.h'), pg_temp.img_version('test.h'),
                               pg_temp.img('test.i')))::text,
  true);

select is(
  (current_setting('test.rep_h')::jsonb -> 'affected' -> 'live'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'a draft-only replacement reports no live reference');
select is(
  (current_setting('test.rep_h')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 0, "weekly": 0, "monthly": 1, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 0}'::jsonb,
  'and exactly the one pending reference it moved');

-- ===========================================================================
-- 4. The 023 guard still holds
-- ===========================================================================

select throws_ok(
  format($$ update public.dishes set image_id = %L where name = 'Thor' $$,
         pg_temp.img('test.i')),
  '42501', null,
  'Staff is still refused a direct write of a published image_id');

reset role;
select pg_temp.become_owner();
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'Owner is still refused a direct clearing of a published image_id');

reset role;
select pg_temp.become_anon();
select throws_ok(
  format($$ select public.delete_image(%L, now(), true) $$, pg_temp.img('test.e')),
  '42501', null,
  'anon is refused the delete transition outright');

-- ===========================================================================
-- 5. Unrelated content, and the cleanup
-- ===========================================================================

reset role;
delete from public.news where slug in ('pgtap-cache-live', 'pgtap-cache-kladde');
update public.dishes set draft = null where name in ('Thor', 'Odin');
update public.weekly_special set draft = null;
update public.monthly_burger set draft = null;
delete from public.images;

select is(
  (select count(*) from public.news)::text,
  current_setting('test.news_before'),
  'the seeded articles are exactly as many as before');
select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — the transitions touch no other content');
select is(
  pg_temp.hours_state()::text,
  current_setting('test.hours_before'),
  'the opening hours are byte-identical');
select is(
  pg_temp.menu_state(),
  current_setting('test.menu_before'),
  'every dish except the Thor and Odin fixtures is byte-identical');

select * from finish();
rollback;
