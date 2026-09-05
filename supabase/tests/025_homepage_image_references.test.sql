-- Klingenberg Food — pgTAP: the Forside document owns images (technical plan §4, §5,
-- §6, §7e item 4, §8, §15 phase 11A; migration 20260902120000).
--
-- The subject is what phase 11A added to the image reference model: the Forside's
-- three image paths — `hero.image_id`, `award.image_id`, `about_excerpt.image_id` —
-- in `pages.published` (live) and `pages.draft` (pending). Proved from real Owner,
-- Staff and anonymous JWTs:
--
--   1. structure — the two new triggers on `pages`, the functions SECURITY INVOKER
--      with search_path pinned, no new SECURITY DEFINER, the pages policies and
--      grants unchanged;
--   2. `image_references` — a published path is a live `page:home` row named
--      "Forsiden", a draft path a pending one, three slots naming one image are
--      three rows, a malformed value contributes nothing, anon is refused;
--   3. the guard — a direct write of `published` that MOVES an image path is refused
--      for Owner (42501) and for Staff (RLS: zero rows), a text-only write of
--      `published` by the Owner still works (003's promise stands), a draft write
--      with an image works, `publish_page()` moves the image live under the marker,
--      Staff is still refused the publish, a stale publish writes nothing, and the
--      marker is spent afterwards;
--   4. `delete_image()` over the Forside — the §19 matrix: live A alone; draft B
--      alone; live A + draft B, delete A; live A + draft B, delete B (the section
--      stays when its words differ, and leaves the draft when nothing else does);
--      the same image live and pending; the unconfirmed refusal counts the page rows;
--      a Staff member is refused with `owner_only` before any write; every unrelated
--      key of the document and of the draft is byte-identical;
--   5. `replace_image()` over the Forside — live and pending paths repointed with the
--      column references in one call, `affected` reporting both, Staff refused with
--      `owner_only`, and a replacement that does not name the Forside still open to
--      Staff;
--   6. audit — the publish and the delete write their rows; a refused transition
--      writes none;
--   7. unrelated content — the announcement, the opening hours and the menu are
--      untouched, and the 023 guard still refuses a direct dish write.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–024.

begin;
create extension if not exists pgtap with schema extensions;

select plan(102);

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
 * The fixture door for the PUBLISHED Forside document: written as the table owner,
 * the way seed.sql would — the guard steps aside for the owner exactly as it does
 * for a migration. SECURITY DEFINER is the test's own privilege, never the
 * application's. A draft needs no door: the Owner may write `draft` directly, and
 * the guard watches `published` alone.
 */
create function pg_temp.fixture_home_published(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set published = p_doc where key = 'home';
end;
$fn$;

create function pg_temp.fixture_home_draft(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set draft = p_doc where key = 'home';
end;
$fn$;

/* A whole Forside document with the three slots as given (null = no image). */
create function pg_temp.home_doc(p_hero uuid, p_award uuid, p_about uuid) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'hero', jsonb_build_object('heading', 'Levende forside', 'intro', 'Intro', 'image_id', p_hero),
    'award', jsonb_build_object('title', 'Vinder', 'text', 'Tekst', 'image_id', p_award),
    'featured_dish_ids', '[]'::jsonb,
    'about_excerpt', jsonb_build_object('heading', 'Om os', 'text', 'Tekst', 'image_id', p_about))
$fn$;

create function pg_temp.home_published() returns jsonb
language sql security definer set search_path = '' as $fn$
  select published from public.pages where key = 'home'
$fn$;

create function pg_temp.home_draft() returns jsonb
language sql security definer set search_path = '' as $fn$
  select draft from public.pages where key = 'home'
$fn$;

create function pg_temp.home_version() returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.pages where key = 'home'
$fn$;

create function pg_temp.home_id() returns uuid
language sql security definer set search_path = '' as $fn$
  select id from public.pages where key = 'home'
$fn$;

/* The Thor fixture door from 022/023, for the cross-entity replacement. */
create function pg_temp.fixture_live_dish_image(p_image uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.dishes set image_id = p_image where name = 'Thor';
end;
$fn$;

create function pg_temp.dish_image(p_name text) returns uuid
language sql security definer set search_path = '' as $fn$
  select image_id from public.dishes where name = p_name
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

create function pg_temp.menu_state() returns text
language sql security definer set search_path = '' as $fn$
  select md5(string_agg(d.id::text || d.name || d.updated_at::text, ',' order by d.id))
    from public.dishes d
   where d.name <> 'Thor'
$fn$;

select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.hours_before', pg_temp.hours_state()::text, true);
select set_config('test.menu_before', pg_temp.menu_state(), true);

/* A valid derivatives document for a 1600 x 1200 original. */
create function pg_temp.good_derivatives() returns jsonb
language sql as $fn$
  select '{"formats": ["avif", "webp"],
           "widths": [{"width": 480, "height": 360},
                      {"width": 960, "height": 720},
                      {"width": 1440, "height": 1080}]}'::jsonb
$fn$;

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

/* How many rows a statement moved, run as the CURRENT role — a plain function. */
create function pg_temp.rows_moved(p_sql text) returns integer
language plpgsql as $fn$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ===========================================================================
-- 1. Structure
-- ===========================================================================

select ok(
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_guard_image_reference_write' and not t.tgisinternal),
  'the published-image guard is attached to pages');

select ok(
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_consume_image_reference_write' and not t.tgisinternal),
  'the statement-level marker consumer is attached to pages');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'tg_guard_page_image_reference_write'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'the page guard is SECURITY INVOKER with search_path pinned');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'publish_page'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'publish_page() is still SECURITY INVOKER with search_path pinned');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'delete_image'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'delete_image() is still SECURITY INVOKER with search_path pinned');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'replace_image'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'replace_image() is still SECURITY INVOKER with search_path pinned');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('is_staff', 'is_owner', 'log_audit', 'editor_name',
                            'enforce_owner_invariant',
                            'list_accounts', 'revoke_account_sessions',
                            -- phase 13B: the rate limiter's doors (§0ai, pgTAP 029)
                            'rate_limit_resolve', 'consume_rate_limit', 'peek_rate_limit',
                            -- phase 13B closure: the sign-in reservation (§0ai, pgTAP 030)
                            'reserve_sign_in_attempt', 'release_sign_in_attempt')),
  0::bigint,
  'phase 11A adds no SECURITY DEFINER function');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'pages'),
  array['pages_select_public', 'pages_select_staff', 'pages_update_scoped'],
  'the three phase-1 pages policies still stand unchanged');

select ok(
  has_table_privilege('authenticated', 'public.pages', 'UPDATE')
  and not has_table_privilege('anon', 'public.pages', 'UPDATE'),
  'the pages UPDATE grant is unchanged — authenticated holds it, anon does not');

-- ===========================================================================
-- 2. image_references: the Forside's six paths, one definition
-- ===========================================================================

select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf1/original.jpg');
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1/original.jpg');
select pg_temp.make_image('test.c', 'cccccccc-cccc-4ccc-8ccc-ccccccccccf1/original.jpg');
reset role;

select is(
  (select count(*) from public.image_references where kind = 'page:home'),
  0::bigint,
  'the seeded Forside names no image');

select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));

select pg_temp.become_owner();

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.a') and kind = 'page:home'
      and name = 'Forsiden' and entity_id = pg_temp.home_id() and not pending),
  1::bigint,
  'a published hero image is one live page:home row named Forsiden');

update public.pages
   set draft = jsonb_build_object(
     'award', jsonb_build_object('title', 'Ny titel', 'text', 'Tekst', 'image_id', pg_temp.img('test.b')))
 where key = 'home';

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:home' and pending),
  1::bigint,
  'a draft award image is one pending page:home row');

reset role;
select pg_temp.fixture_home_published(
  pg_temp.home_doc(pg_temp.img('test.a'), pg_temp.img('test.a'), pg_temp.img('test.a')));
select pg_temp.become_owner();

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.a') and kind = 'page:home' and not pending),
  3::bigint,
  'three slots naming one image are three live rows — the caption dedupes, the count does not');

reset role;
select pg_temp.fixture_home_published(
  jsonb_set(pg_temp.home_doc(null, null, null), '{hero,image_id}', '"ikke-en-uuid"'::jsonb));
select pg_temp.become_owner();

select lives_ok(
  $$ select count(*) from public.image_references $$,
  'a malformed published value does not make the view throw');
select is(
  (select count(*) from public.image_references where kind = 'page:home' and not pending),
  0::bigint,
  'and contributes no reference');

reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ select count(*) from public.image_references $$,
  '42501', null,
  'anon is refused the view outright');

-- ===========================================================================
-- 3. The guard: a published image path moves only through a transition
-- ===========================================================================

reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(null);

-- a) Owner: a direct write that moves an image path is refused
select pg_temp.become_owner();

select throws_ok(
  format($$ update public.pages set published = jsonb_set(published, '{hero,image_id}', %L::jsonb)
             where key = 'home' $$, to_jsonb(pg_temp.img('test.b'))::text),
  '42501', null,
  'Owner is refused a direct change of the published hero image');

select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{hero,image_id}', 'null'::jsonb)
      where key = 'home' $$,
  '42501', null,
  'Owner is refused a direct clearing of the published hero image');

select throws_ok(
  format($$ update public.pages set published = jsonb_set(published, '{award,image_id}', %L::jsonb)
             where key = 'home' $$, to_jsonb(pg_temp.img('test.b'))::text),
  '42501', null,
  'Owner is refused a direct setting of the published award image from empty');

select throws_ok(
  $$ update public.pages set published = '{"heading": "Alt erstattet"}'::jsonb where key = 'home' $$,
  '42501', null,
  'a whole-document replacement that drops the live hero image is a clearing, and refused');

select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'and the published hero image is exactly as it was');

-- b) Owner: a text-only write of the published document still works (003's promise)
select lives_ok(
  $$ update public.pages set published = jsonb_set(published, '{hero,heading}', '"Rettet direkte"'::jsonb)
      where key = 'home' $$,
  'Owner may still write the published document when no image path moves');
select is(
  pg_temp.home_published() #>> '{hero,heading}', 'Rettet direkte',
  'and the text write took effect');

-- c) Staff: RLS filters the home row out — zero rows, before the guard is reached
reset role;
select pg_temp.become_staff();

select is(
  pg_temp.rows_moved($$ update public.pages
                          set published = jsonb_set(published, '{hero,image_id}', 'null'::jsonb)
                        where key = 'home' $$),
  0,
  'Staff cannot reach the home row at all — RLS returns zero rows');

select is(
  pg_temp.rows_moved($$ update public.pages
                          set draft = '{"hero": {"heading": "Kapret", "intro": null, "image_id": null}}'::jsonb
                        where key = 'home' $$),
  0,
  'and cannot write a Forside draft either');

-- d) Owner: the draft is the door in; publish_page() moves the image live
reset role;
select pg_temp.become_owner();

select lives_ok(
  format($$ update public.pages
               set draft = jsonb_build_object('hero',
                     jsonb_build_object('heading', 'Ny overskrift', 'intro', 'Intro', 'image_id', %L))
             where key = 'home' $$, pg_temp.img('test.b')::text),
  'Owner writes a draft naming image B for the hero');

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:home' and pending),
  1::bigint,
  'the pending reference appears in the view');

-- Staff may not publish it (005's rule, restated with an image in the draft)
reset role;
select pg_temp.become_staff();
select is(
  (select public.publish_page(pg_temp.home_id(), pg_temp.home_version()) ->> 'status'),
  'forbidden',
  'Staff is refused the Forside publish');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'and the live hero still carries A');

-- A stale token publishes nothing
reset role;
select pg_temp.become_owner();
select is(
  (select public.publish_page(pg_temp.home_id(), pg_temp.home_version() - interval '1 second') ->> 'status'),
  'conflict',
  'a stale publish is a conflict');
select is(
  pg_temp.home_draft() #>> '{hero,image_id}', pg_temp.img('test.b')::text,
  'and the draft is untouched');

select set_config('test.audit_before_publish', (select count(*)::text from public.audit_log), true);

select is(
  (select public.publish_page(pg_temp.home_id(), pg_temp.home_version()) ->> 'status'),
  'published',
  'the Owner publishes the Forside');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.b')::text,
  'the hero image is B on the hjemmeside');
select is(
  pg_temp.home_published() #>> '{hero,heading}', 'Ny overskrift',
  'beside the new heading — the whole section moved');
select is(pg_temp.home_draft(), null, 'and the draft is cleared');
select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:home' and not pending),
  1::bigint,
  'the reference is live in the view now');
select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'page:home'),
  1::bigint,
  'one audit row names the page');

-- e) The marker is spent: the very next direct write is refused
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{hero,image_id}', 'null'::jsonb)
      where key = 'home' $$,
  '42501', null,
  'after the publish the marker is spent — a direct clearing is refused again');

-- ===========================================================================
-- 4. delete_image() over the Forside — the §19 matrix
-- ===========================================================================

-- Live A (hero), draft: nothing. Delete A.
reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(null);
select pg_temp.become_owner();

select set_config('test.pub_before', pg_temp.home_published()::text, true);

-- a) unconfirmed: refused, counting the page row
select set_config('test.del_unconfirmed',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), false))::text,
  true);
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'status'), 'in_use',
  'an image the Forside uses refuses an unconfirmed delete');
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'references'), '1',
  'and counts the one page reference');
select is(pg_temp.home_published(), current_setting('test.pub_before')::jsonb,
  'the refusal wrote nothing');

-- b) Staff, confirmed: refused as owner_only before any write
reset role;
select pg_temp.become_staff();
select set_config('test.del_staff',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text,
  true);
select is(
  (current_setting('test.del_staff')::jsonb ->> 'status'), 'owner_only',
  'Staff is refused a confirmed delete of an image the Forside uses');
select is(
  (current_setting('test.del_staff')::jsonb ->> 'references'), '1',
  'with the reference count, so the screen can say why');
select is(pg_temp.home_published(), current_setting('test.pub_before')::jsonb,
  'and the Forside is byte-identical');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.a')), 1::bigint,
  'and the image still exists');

-- c) Owner, confirmed: live A clears, everything else byte-identical
reset role;
select pg_temp.become_owner();
select set_config('test.del_a',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text,
  true);
select is(
  (current_setting('test.del_a')::jsonb ->> 'status'), 'deleted',
  'the Owner''s confirmed delete goes through');
select is(
  pg_temp.home_published() -> 'hero' -> 'image_id', 'null'::jsonb,
  'the published hero image is cleared to JSON null');
select is(
  pg_temp.home_published() - 'hero',
  current_setting('test.pub_before')::jsonb - 'hero',
  'every other section of the published document is byte-identical');
select is(
  (pg_temp.home_published() -> 'hero') - 'image_id',
  (current_setting('test.pub_before')::jsonb -> 'hero') - 'image_id',
  'and every other key of the hero section is too');
select is(
  (current_setting('test.del_a')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '1',
  'affected.live names the one Forside row a guest could see');
select is(
  (current_setting('test.del_a')::jsonb -> 'affected' -> 'draft' ->> 'page:home'), '0',
  'and no pending one');
select is(pg_temp.home_draft(), null, 'the draft stays NULL');

-- Draft B only (award), live: nothing. Delete B.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf2/original.jpg');
reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(null, null, null));
select pg_temp.fixture_home_draft(jsonb_build_object(
  'award', jsonb_build_object('title', 'Ny titel', 'text', 'Tekst', 'image_id', pg_temp.img('test.b')),
  'hero', jsonb_build_object('heading', 'Ny overskrift', 'intro', 'Intro', 'image_id', null)));
select pg_temp.become_owner();

select set_config('test.pub_before', pg_temp.home_published()::text, true);
select set_config('test.del_b',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text,
  true);
select is(
  (current_setting('test.del_b')::jsonb ->> 'status'), 'deleted',
  'a draft-only Forside image deletes');
select is(
  pg_temp.home_draft() -> 'award' -> 'image_id', 'null'::jsonb,
  'the pending award selection returns to the published value — none');
select is(
  pg_temp.home_draft() -> 'award' ->> 'title', 'Ny titel',
  'the award section stays, because its words still differ from the hjemmeside');
select is(
  pg_temp.home_draft() -> 'hero',
  '{"heading": "Ny overskrift", "intro": "Intro", "image_id": null}'::jsonb,
  'the unrelated pending hero section is byte-identical');
select is(pg_temp.home_published(), current_setting('test.pub_before')::jsonb,
  'the published document is byte-identical');
select is(
  (current_setting('test.del_b')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '0',
  'affected.live: nothing a guest could see');
select is(
  (current_setting('test.del_b')::jsonb -> 'affected' -> 'draft' ->> 'page:home'), '1',
  'affected.draft: the one pending row');

-- Live A + draft B (hero). Delete A → live clears, pending B remains.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2/original.jpg');
reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(jsonb_build_object(
  'hero', jsonb_build_object('heading', 'Levende forside', 'intro', 'Intro', 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_owner();

select set_config('test.del_a2',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text,
  true);
select is(
  (current_setting('test.del_a2')::jsonb ->> 'status'), 'deleted',
  'live A with draft B: deleting A goes through');
select is(
  pg_temp.home_published() -> 'hero' -> 'image_id', 'null'::jsonb,
  'the live hero clears');
select is(
  pg_temp.home_draft() #>> '{hero,image_id}', pg_temp.img('test.b')::text,
  'and the pending selection of B remains');
select is(
  (current_setting('test.del_a2')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '1',
  'affected.live: one');
select is(
  (current_setting('test.del_a2')::jsonb -> 'affected' -> 'draft' ->> 'page:home'), '0',
  'affected.draft: zero — B was not moved');

-- Live A + draft B (hero, words unchanged). Delete B → live A remains, the
-- selection clears, and the section leaves the draft because nothing else differs.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf3/original.jpg');
reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(jsonb_build_object(
  'hero', jsonb_build_object('heading', 'Levende forside', 'intro', 'Intro', 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_owner();

select set_config('test.del_b2',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text,
  true);
select is(
  (current_setting('test.del_b2')::jsonb ->> 'status'), 'deleted',
  'live A with draft B: deleting B goes through');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'live A remains');
select is(pg_temp.home_draft(), null,
  'the draft is NULL: the selection cleared back to A and nothing else differed');
select is(
  (current_setting('test.del_b2')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '0',
  'affected.live: zero');
select is(
  (current_setting('test.del_b2')::jsonb -> 'affected' -> 'draft' ->> 'page:home'), '1',
  'affected.draft: one');

-- Live A + draft B (hero, words changed). Delete B → the section stays with A.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf3/original.jpg');
reset role;
select pg_temp.fixture_home_draft(jsonb_build_object(
  'hero', jsonb_build_object('heading', 'Anden overskrift', 'intro', 'Intro', 'image_id', pg_temp.img('test.b')),
  'featured_dish_ids', '[]'::jsonb));
select pg_temp.become_owner();

select set_config('test.del_b3',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text,
  true);
select is(
  pg_temp.home_draft() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'the pending selection returns to the live image A');
select is(
  pg_temp.home_draft() #>> '{hero,heading}', 'Anden overskrift',
  'and the pending words stay');
select is(
  pg_temp.home_draft() -> 'featured_dish_ids', '[]'::jsonb,
  'an unrelated pending section is byte-identical');

-- The same image live and pending (A/A). Delete A → both clear, the section leaves.
reset role;
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(jsonb_build_object(
  'hero', jsonb_build_object('heading', 'Levende forside', 'intro', 'Intro', 'image_id', pg_temp.img('test.a'))));
select pg_temp.become_owner();

select set_config('test.del_aa',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text,
  true);
select is(
  pg_temp.home_published() -> 'hero' -> 'image_id', 'null'::jsonb,
  'same image live and pending: the live slot clears');
select is(pg_temp.home_draft(), null,
  'and the draft is NULL — nothing pending is left, and no dangling id anywhere');
select is(
  (current_setting('test.del_aa')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '1',
  'affected.live: one');
select is(
  (current_setting('test.del_aa')::jsonb -> 'affected' -> 'draft' ->> 'page:home'), '1',
  'affected.draft: one');
select is(
  (select count(*) from public.image_references where kind = 'page:home'),
  0::bigint,
  'the view agrees: no Forside reference is left');

-- ===========================================================================
-- 5. replace_image() over the Forside
-- ===========================================================================

reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaf4/original.jpg');
select pg_temp.make_image('test.d', 'dddddddd-dddd-4ddd-8ddd-ddddddddddf4/original.jpg');
reset role;

-- A: live on the hero, live on Thor, pending on the award; C is the successor.
select pg_temp.fixture_home_published(pg_temp.home_doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_home_draft(jsonb_build_object(
  'award', jsonb_build_object('title', 'Ny titel', 'text', 'Tekst', 'image_id', pg_temp.img('test.a'))));
select pg_temp.fixture_live_dish_image(pg_temp.img('test.a'));

-- a) Staff: refused as owner_only, nothing written
select pg_temp.become_staff();
select set_config('test.rep_staff',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), pg_temp.img('test.c')))::text,
  true);
select is(
  (current_setting('test.rep_staff')::jsonb ->> 'status'), 'owner_only',
  'Staff is refused a replacement of an image the Forside uses');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.a'),
  'and not even Thor moved — the refusal comes before any write');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'the live hero still carries A');

-- b) Staff may still replace an image the Forside does not use
select set_config('test.rep_d',
  (select public.replace_image(pg_temp.img('test.d'), pg_temp.img_version('test.d'), pg_temp.img('test.c')))::text,
  true);
select is(
  (current_setting('test.rep_d')::jsonb ->> 'status'), 'replaced',
  'Staff replaces an image the Forside does not name');
select is(
  (current_setting('test.rep_d')::jsonb -> 'affected' -> 'live' ->> 'page:home'), '0',
  'and the Forside count is zero');

-- c) Owner: everything moves in one call, and affected says so
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.e', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeef4/original.jpg');
reset role;
select pg_temp.become_owner();

select set_config('test.rep_stale',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a') - interval '1 second',
                               pg_temp.img('test.e')))::text,
  true);
select is(
  (current_setting('test.rep_stale')::jsonb ->> 'status'), 'conflict',
  'a stale replacement is a conflict');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.a')::text,
  'and moved nothing');

select set_config('test.rep',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), pg_temp.img('test.e')))::text,
  true);
select is(
  (current_setting('test.rep')::jsonb ->> 'status'), 'replaced',
  'the Owner replaces A with E');
select is(
  pg_temp.home_published() #>> '{hero,image_id}', pg_temp.img('test.e')::text,
  'the live hero now carries E');
select is(
  pg_temp.home_draft() #>> '{award,image_id}', pg_temp.img('test.e')::text,
  'the pending award selection now names E');
select is(
  pg_temp.home_draft() #>> '{award,title}', 'Ny titel',
  'and its pending words are untouched');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.e'),
  'Thor carries E too — one transition, every reference');
select is(
  (current_setting('test.rep')::jsonb ->> 'references'), '3',
  'three references moved in all');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'live'),
  '{"dish": 1, "weekly": 0, "monthly": 0, "news": 0, "page:home": 1, "page:takeaway": 0}'::jsonb,
  'affected.live: Thor and the Forside');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 1, "page:takeaway": 0}'::jsonb,
  'affected.draft: the pending award selection');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.a')), 0::bigint,
  'and A is gone');
select is(
  pg_temp.home_published() - 'hero',
  (pg_temp.home_doc(null, null, null)) - 'hero',
  'every other section of the published document is byte-identical');

-- ===========================================================================
-- 6. Audit
-- ===========================================================================

reset role;
select is(
  (select count(*) from public.audit_log where action = 'delete' and entity = 'image'),
  6::bigint,
  'the six confirmed deletes each wrote one audit row');
select is(
  (select count(*) from public.audit_log where action = 'replace' and entity = 'image'),
  2::bigint,
  'the two replacements each wrote one audit row');
select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'page:home'),
  1::bigint,
  'the one publish wrote one — the refused publishes and the refused transitions wrote none');

-- ===========================================================================
-- 7. Unrelated content, and the 023 guard
-- ===========================================================================

select is(pg_temp.announcement_state(), current_setting('test.announcement_before')::jsonb,
  'the announcement is byte-identical');
select is(pg_temp.hours_state(), current_setting('test.hours_before')::jsonb,
  'the opening hours are byte-identical');
select is(pg_temp.menu_state(), current_setting('test.menu_before'),
  'every dish but Thor is byte-identical');

select pg_temp.become_owner();
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'Owner is still refused a direct clearing of a published dish image (023)');

-- ---------------------------------------------------------------------------
-- Cleanup: the seed's Forside, Thor unreferenced, no images
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.fixture_live_dish_image(null);
select pg_temp.fixture_home_draft(null);

select * from finish();
rollback;
