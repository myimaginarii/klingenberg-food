-- Klingenberg Food — pgTAP: Om os owns three photographs (technical plan §4, §5, §6,
-- §7e item 4, §8, §15 phase 14B1; migration 20260906120000).
--
-- The subject is what phase 14B1 added to the image reference model: the Om os
-- document's three image paths — the top-level `venue_image_id`, and `team.image_id`
-- and `method.image_id` inside their sections — in `pages.published` (live) and
-- `pages.draft` (pending). Proved from real Owner, Staff and anonymous JWTs:
--
--   1. structure — the three path functions SECURITY INVOKER with search_path pinned,
--      no new SECURITY DEFINER, the pages policies, grants and triggers unchanged;
--   2. `image_references` — each published path is a live `page:about` row named
--      "Om os", each draft path a pending one, three slots naming one image are three
--      rows, a malformed value contributes nothing, anon is refused;
--   3. the guard — a direct write of `published` that MOVES any of the three paths is
--      refused for Staff and Owner (42501) and for anon, a text-only write of
--      `published` by Staff still works (002's promise stands), a draft with three
--      images is written by Staff, `publish_page()` moves them live under the marker,
--      a stale publish writes nothing, and the marker is spent afterwards;
--   4. `delete_image()` over the page — the §19 matrix for the top-level key (the
--      Mad ud af huset rule: the key leaves the draft) and for the nested keys (the
--      Forside rule: the pending path returns to the published value, an unchanged
--      section leaves the draft); the same image in all three slots; the unconfirmed
--      refusal counts the page rows; Staff is NOT refused (the page is Staff-writable,
--      unlike the Forside); every unrelated key byte-identical;
--   5. `replace_image()` over the page — the three live and three pending paths
--      repointed by Staff in one call, `affected` reporting both, a stale replacement
--      a conflict;
--   6. audit — the publishes, the deletes and the replacement write their rows;
--      refused writes none;
--   7. unrelated content — the Forside row, the Mad ud af huset row, the announcement
--      and the opening hours are byte-identical.
--
-- Not proved here, on purpose: a draft carrying an unexpected key inside a section, or
-- a malformed image id. `publish_page()` merges documents and parses nothing (§4: the
-- field-level shape is the application's), so those refusals are `storedDraftIsValid`
-- in `lib/publishing/publish.ts` — unit-tested in `tests/unit/schemas/drafts.test.ts`
-- and driven end to end in `tests/e2e/about-admin.spec.ts`.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–030.

begin;
create extension if not exists pgtap with schema extensions;

select plan(82);

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

/* Fixture doors for the about row, written as the table owner (the guard steps aside). */
create function pg_temp.fixture_published(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set published = p_doc where key = 'about';
end;
$fn$;

create function pg_temp.fixture_draft(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set draft = p_doc where key = 'about';
end;
$fn$;

/* A whole about document with the three images as given (null = no image). */
create function pg_temp.doc(p_venue uuid, p_team uuid, p_kitchen uuid) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'heading', 'Vores historie',
    'story_blocks', jsonb_build_array('Første afsnit.', 'Andet afsnit.'),
    'venue_image_id', p_venue,
    'team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', p_team),
    'method', jsonb_build_object(
      'heading', 'Sådan laver vi burgere', 'text', 'Råvarer, brød og tilberedning.', 'image_id', p_kitchen))
$fn$;

create function pg_temp.published() returns jsonb
language sql security definer set search_path = '' as $fn$
  select published from public.pages where key = 'about'
$fn$;

create function pg_temp.draft() returns jsonb
language sql security definer set search_path = '' as $fn$
  select draft from public.pages where key = 'about'
$fn$;

create function pg_temp.version() returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.pages where key = 'about'
$fn$;

create function pg_temp.page_id() returns uuid
language sql security definer set search_path = '' as $fn$
  select id from public.pages where key = 'about'
$fn$;

/* Unrelated content, fingerprinted. */
create function pg_temp.home_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(p) - 'updated_at' from public.pages p where key = 'home'
$fn$;

create function pg_temp.takeaway_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(p) - 'updated_at' from public.pages p where key = 'takeaway'
$fn$;

create function pg_temp.announcement_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(a) from public.announcement a limit 1
$fn$;

create function pg_temp.hours_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

select set_config('test.home_before', pg_temp.home_state()::text, true);
select set_config('test.takeaway_before', pg_temp.takeaway_state()::text, true);
select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.hours_before', pg_temp.hours_state()::text, true);

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

-- The seed leaves the page with no image and no draft.
select pg_temp.fixture_published(pg_temp.doc(null, null, null));
select pg_temp.fixture_draft(null);

-- ===========================================================================
-- 1. Structure
-- ===========================================================================

select ok(
  (select bool_and(not p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('about_page_names_image', 'about_page_image_moved', 'about_page_draft_detached',
                        'publish_page', 'delete_image', 'replace_image',
                        'tg_guard_page_image_reference_write')),
  'the three about path functions, publish_page(), delete_image(), replace_image() and the page guard are SECURITY INVOKER with search_path pinned');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('is_staff', 'is_owner', 'log_audit', 'editor_name',
                            'enforce_owner_invariant',
                            'list_accounts', 'revoke_account_sessions',
                            'rate_limit_resolve', 'consume_rate_limit', 'peek_rate_limit',
                            'reserve_sign_in_attempt', 'release_sign_in_attempt')),
  0::bigint,
  'phase 14B1 adds no SECURITY DEFINER function');

select ok(
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_guard_image_reference_write' and not t.tgisinternal)
  and exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_consume_image_reference_write' and not t.tgisinternal),
  'the row guard and the statement-level marker consumer are still attached to pages');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'pages'),
  array['pages_select_public', 'pages_select_staff', 'pages_update_scoped'],
  'the three phase-1 pages policies still stand unchanged');

select ok(
  has_table_privilege('authenticated', 'public.pages', 'UPDATE')
  and not has_table_privilege('anon', 'public.pages', 'UPDATE'),
  'the pages UPDATE grant is unchanged');

select ok(
  not has_function_privilege('anon', 'public.about_page_names_image(jsonb, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.about_page_names_image(jsonb, uuid)', 'EXECUTE'),
  'the path helpers are executable by authenticated and not by anon');

-- ===========================================================================
-- 2. image_references: the page's six rows
-- ===========================================================================

select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1/original.jpg');
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1/original.jpg');
select pg_temp.make_image('test.c', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1/original.jpg');
reset role;

select is(
  (select count(*) from public.image_references where kind = 'page:about'),
  0::bigint,
  'the seeded page names no image');

select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.b'), pg_temp.img('test.c')));
select pg_temp.become_staff();

select is(
  (select count(*) from public.image_references
    where kind = 'page:about' and name = 'Om os' and entity_id = pg_temp.page_id() and not pending),
  3::bigint,
  'three published paths are three live page:about rows named Om os');
select ok(
  exists (select 1 from public.image_references where image_id = pg_temp.img('test.a') and kind = 'page:about' and not pending)
  and exists (select 1 from public.image_references where image_id = pg_temp.img('test.b') and kind = 'page:about' and not pending)
  and exists (select 1 from public.image_references where image_id = pg_temp.img('test.c') and kind = 'page:about' and not pending),
  'one row per path: the facade, the team and the kitchen');

update public.pages
   set draft = jsonb_build_object(
     'venue_image_id', pg_temp.img('test.b'),
     'team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.b')),
     'method', jsonb_build_object('heading', 'S', 'text', null, 'image_id', pg_temp.img('test.b')))
 where key = 'about';

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:about' and pending),
  3::bigint,
  'three draft paths naming one image are three pending page:about rows — written by Staff');

reset role;
select pg_temp.fixture_published(
  jsonb_set(jsonb_set(pg_temp.doc(null, null, null), '{venue_image_id}', '"ikke-en-uuid"'::jsonb),
            '{team,image_id}', '"../etc/passwd"'::jsonb));
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();

select lives_ok(
  $$ select count(*) from public.image_references $$,
  'malformed published values do not make the view throw');
select is(
  (select count(*) from public.image_references where kind = 'page:about'),
  0::bigint,
  'and contribute no reference');

reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ select count(*) from public.image_references $$,
  '42501', null,
  'anon may not read the view');

-- ===========================================================================
-- 3. The guard: moved only through a transition
-- ===========================================================================

reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.b'), pg_temp.img('test.c')));
select pg_temp.fixture_draft(null);

select pg_temp.become_staff();
select throws_ok(
  format($$ update public.pages set published = jsonb_set(published, '{venue_image_id}', %L::jsonb)
             where key = 'about' $$, to_jsonb(pg_temp.img('test.b'))::text),
  '42501', null,
  'Staff is refused a direct change of the published facade');
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{team,image_id}', 'null'::jsonb)
      where key = 'about' $$,
  '42501', null,
  'and a direct clearing of the team photograph');
select throws_ok(
  format($$ update public.pages set published = jsonb_set(published, '{method,image_id}', %L::jsonb)
             where key = 'about' $$, to_jsonb(pg_temp.img('test.a'))::text),
  '42501', null,
  'and a direct change of the kitchen photograph');
select throws_ok(
  $$ update public.pages set published = '{"heading": "Alt erstattet"}'::jsonb where key = 'about' $$,
  '42501', null,
  'a whole-document replacement that drops the live images is a clearing, and refused');
select is(
  pg_temp.published(),
  pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.b'), pg_temp.img('test.c')),
  'and the published document is exactly as it was');

select lives_ok(
  $$ update public.pages set published = jsonb_set(published, '{heading}', '"Rettet direkte"'::jsonb)
      where key = 'about' $$,
  'Staff may still write the published document when no image path moves (002''s promise)');
select is(pg_temp.published() ->> 'heading', 'Rettet direkte', 'and the text write took effect');

reset role;
select pg_temp.become_owner();
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{venue_image_id}', 'null'::jsonb)
      where key = 'about' $$,
  '42501', null,
  'the Owner is refused the same direct clearing — authority to publish is not authority to bypass');

reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ update public.pages set published = '{}'::jsonb where key = 'about' $$,
  '42501', null,
  'anon holds no UPDATE at all');

-- The draft is the door in, for Staff; publish_page() moves all three live under the marker.
reset role;
select pg_temp.fixture_published(pg_temp.doc(null, null, null));
select pg_temp.become_staff();
select is(
  pg_temp.rows_moved(format($$ update public.pages set draft = %L::jsonb where key = 'about' $$,
    jsonb_build_object(
      'venue_image_id', pg_temp.img('test.a'),
      'team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.b')),
      'method', jsonb_build_object('heading', 'Sådan laver vi burgere', 'text', 'Råvarer, brød og tilberedning.',
                                   'image_id', pg_temp.img('test.c')))::text)),
  1,
  'Staff writes a draft naming three images');
select is(
  (select count(*) from public.pending_changes where entity = 'page:about'),
  1::bigint,
  'the page is pending');
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version() - interval '1 second') ->> 'status'),
  'conflict',
  'a stale publish is a conflict');
select is(pg_temp.published(), pg_temp.doc(null, null, null), 'and moved nothing');
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version()) ->> 'status'),
  'published',
  'Staff publishes it');
select is(
  pg_temp.published(),
  pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.b'), pg_temp.img('test.c')),
  'the three images are live, the words byte-identical');
select is(pg_temp.draft(), null, 'the draft is cleared');
select is(
  (select count(*) from public.image_references where kind = 'page:about' and not pending),
  3::bigint,
  'the three references are live in the view now');
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{venue_image_id}', 'null'::jsonb)
      where key = 'about' $$,
  '42501', null,
  'after the publish the marker is spent — a direct clearing is refused again');

-- ===========================================================================
-- 4. delete_image() over the page — the §19 matrix, Staff-operated
-- ===========================================================================

-- Live A in the facade alone. Delete A, as Staff.
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a'), null, null));
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();

select set_config('test.del_unconfirmed',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), false))::text, true);
select is((current_setting('test.del_unconfirmed')::jsonb ->> 'status'), 'in_use',
  'an image the page uses refuses an unconfirmed delete');
select is((current_setting('test.del_unconfirmed')::jsonb ->> 'references'), '1',
  'and counts the one page reference');

select set_config('test.del_a',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is((current_setting('test.del_a')::jsonb ->> 'status'), 'deleted',
  'Staff''s confirmed delete goes through — the page is Staff-writable, no owner_only');
select is(pg_temp.published() -> 'venue_image_id', 'null'::jsonb, 'the published facade is cleared to JSON null');
select is(pg_temp.published(), pg_temp.doc(null, null, null), 'every other key of the document is byte-identical');
select is((current_setting('test.del_a')::jsonb -> 'affected' -> 'live' ->> 'page:about'), '1',
  'affected.live names the one page row a guest could see');
select is((current_setting('test.del_a')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '0',
  'and no pending one');
select is(pg_temp.draft(), null, 'the draft stays NULL');

-- Draft facade B alone, beside a pending heading. Delete B → the key leaves, the heading stays.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac2/original.jpg');
reset role;
select pg_temp.fixture_draft(jsonb_build_object('heading', 'Ny overskrift', 'venue_image_id', pg_temp.img('test.b')));
select pg_temp.become_staff();

select set_config('test.del_b',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is((current_setting('test.del_b')::jsonb ->> 'status'), 'deleted', 'a draft-only facade deletes');
select is(pg_temp.draft(), '{"heading": "Ny overskrift"}'::jsonb,
  'the top-level key leaves the draft; the pending heading is byte-identical');
select is(pg_temp.published(), pg_temp.doc(null, null, null), 'the published document is byte-identical');
select is((current_setting('test.del_b')::jsonb -> 'affected' -> 'live' ->> 'page:about'), '0', 'affected.live: nothing a guest could see');
select is((current_setting('test.del_b')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '1', 'affected.draft: the one pending row');

-- Draft team B alone, words unchanged. Delete B → the section returns to published and leaves; draft NULL.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2/original.jpg');
reset role;
select pg_temp.fixture_draft(jsonb_build_object('team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_staff();
select set_config('test.del_b_team',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is(pg_temp.draft(), null,
  'a nested pending selection returns to the published value, the unchanged section leaves, the emptied draft is NULL');
select is((current_setting('test.del_b_team')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '1', 'affected.draft: one');

-- Draft method B with changed words. Delete B → the words stay pending, the image returns to published.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc3/original.jpg');
reset role;
select pg_temp.fixture_draft(jsonb_build_object('method', jsonb_build_object('heading', 'Ny metode', 'text', null, 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_staff();
select set_config('test.del_b_method',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is(pg_temp.draft(), '{"method": {"heading": "Ny metode", "text": null, "image_id": null}}'::jsonb,
  'a section whose words differ stays in the draft with its image returned to the published null');

-- Live A in the team + draft B in the team. Delete A → live clears, pending B remains.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc4/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(null, pg_temp.img('test.a'), null));
select pg_temp.fixture_draft(jsonb_build_object('team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_staff();

select set_config('test.del_a2',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is((current_setting('test.del_a2')::jsonb ->> 'status'), 'deleted', 'live A with draft B: deleting A goes through');
select is(pg_temp.published() #> '{team,image_id}', 'null'::jsonb, 'the live team image clears');
select is(pg_temp.draft() #>> '{team,image_id}', pg_temp.img('test.b')::text, 'and the pending selection of B remains');
select is((current_setting('test.del_a2')::jsonb -> 'affected' -> 'live' ->> 'page:about'), '1', 'affected.live: one');
select is((current_setting('test.del_a2')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '0', 'affected.draft: zero — B was not moved');

-- Live A in the team + draft B in the team. Delete B → live A remains, the section returns to published and leaves.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(null, pg_temp.img('test.a'), null));
select pg_temp.fixture_draft(jsonb_build_object('team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.b'))));
select pg_temp.become_staff();

select set_config('test.del_b2',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is(pg_temp.published() #>> '{team,image_id}', pg_temp.img('test.a')::text, 'live A remains');
select is(pg_temp.draft(), null, 'the draft is NULL: the pending selection returned to A and nothing else was pending');
select is((current_setting('test.del_b2')::jsonb -> 'affected' -> 'live' ->> 'page:about'), '0', 'affected.live: zero');
select is((current_setting('test.del_b2')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '1', 'affected.draft: one');

-- The same image in all three slots, live and pending. Delete A → everything clears, other pending keys stay.
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.a'), pg_temp.img('test.a')));
select pg_temp.fixture_draft(jsonb_build_object(
  'heading', 'Ny overskrift',
  'venue_image_id', pg_temp.img('test.a'),
  'team', jsonb_build_object('text', 'Holdet bag disken.', 'image_id', pg_temp.img('test.a')),
  'method', jsonb_build_object('heading', 'Sådan laver vi burgere', 'text', 'Råvarer, brød og tilberedning.', 'image_id', pg_temp.img('test.a'))));
select pg_temp.become_staff();

select set_config('test.del_unconfirmed3',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), false))::text, true);
select is((current_setting('test.del_unconfirmed3')::jsonb ->> 'references'), '6',
  'the unconfirmed refusal counts every path, live and pending');

select set_config('test.del_aaa',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is(pg_temp.published(), pg_temp.doc(null, null, null), 'all three live slots clear; the words are byte-identical');
select is(pg_temp.draft(), '{"heading": "Ny overskrift"}'::jsonb,
  'the facade key leaves, both unchanged sections leave, the pending heading stays');
select is((current_setting('test.del_aaa')::jsonb -> 'affected' -> 'live' ->> 'page:about'), '1', 'affected.live: the one page row');
select is((current_setting('test.del_aaa')::jsonb -> 'affected' -> 'draft' ->> 'page:about'), '1', 'affected.draft: the one page row');
select is(
  (select count(*) from public.image_references where kind = 'page:about'),
  0::bigint,
  'the view agrees: no page reference is left');

-- ===========================================================================
-- 5. replace_image() over the page — Staff, one call, all six references
-- ===========================================================================

reset role;
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac4/original.jpg');
select pg_temp.make_image('test.e', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeec4/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a'), pg_temp.img('test.a'), null));
select pg_temp.fixture_draft(jsonb_build_object(
  'heading', 'Pending',
  'venue_image_id', pg_temp.img('test.a'),
  'method', jsonb_build_object('heading', 'S', 'text', 'T', 'image_id', pg_temp.img('test.a'))));
select pg_temp.become_staff();

select set_config('test.rep_stale',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a') - interval '1 second',
                               pg_temp.img('test.e')))::text, true);
select is((current_setting('test.rep_stale')::jsonb ->> 'status'), 'conflict', 'a stale replacement is a conflict');
select is(pg_temp.published() ->> 'venue_image_id', pg_temp.img('test.a')::text, 'and moved nothing');

select set_config('test.rep',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), pg_temp.img('test.e')))::text, true);
select is((current_setting('test.rep')::jsonb ->> 'status'), 'replaced', 'Staff replaces A with E — no owner_only for this page');
select is(pg_temp.published(), pg_temp.doc(pg_temp.img('test.e'), pg_temp.img('test.e'), null),
  'the two live slots carry E, the kitchen stays empty, the words are byte-identical');
select is(pg_temp.draft() ->> 'venue_image_id', pg_temp.img('test.e')::text, 'the pending facade names E');
select is(pg_temp.draft() #>> '{method,image_id}', pg_temp.img('test.e')::text, 'the pending kitchen names E');
select is(pg_temp.draft() ->> 'heading', 'Pending', 'and the pending words are untouched');
select is((current_setting('test.rep')::jsonb ->> 'references'), '2', 'two page rows moved in all (one live, one pending)');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'live'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 1}'::jsonb,
  'affected.live: the page');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 0, "page:about": 1}'::jsonb,
  'affected.draft: the pending selections');
select is((select count(*) from public.images where id = pg_temp.img('test.a')), 0::bigint, 'and A is gone');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.e') and kind = 'page:about'),
  4::bigint,
  'the view names E from the two live and the two pending paths');

-- ===========================================================================
-- 6. Audit
-- ===========================================================================

reset role;
select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'page:about'),
  1::bigint,
  'the one publish wrote one row — the stale one wrote none');
select is(
  (select count(*) from public.audit_log where action = 'delete' and entity = 'image'),
  7::bigint,
  'the seven confirmed deletes each wrote one row — the unconfirmed refusals wrote none');
select is(
  (select count(*) from public.audit_log where action = 'replace' and entity = 'image'),
  1::bigint,
  'the one replacement wrote one row — the stale one wrote none');

-- ===========================================================================
-- 7. Unrelated content
-- ===========================================================================

select is(pg_temp.home_state(), current_setting('test.home_before')::jsonb,
  'the Forside row is byte-identical (updated_at aside)');
select is(pg_temp.takeaway_state(), current_setting('test.takeaway_before')::jsonb,
  'the Mad ud af huset row is byte-identical (updated_at aside)');
select is(pg_temp.announcement_state(), current_setting('test.announcement_before')::jsonb,
  'the announcement is byte-identical');
select is(pg_temp.hours_state(), current_setting('test.hours_before')::jsonb,
  'the opening hours are byte-identical');

-- ---------------------------------------------------------------------------
-- Cleanup: the page as the seed leaves it — no image, no draft
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.fixture_draft(null);
select pg_temp.fixture_published(pg_temp.doc(null, null, null));

select * from finish();
rollback;
