-- Klingenberg Food — pgTAP: Mad ud af huset's photograph and its published switch
-- (technical plan §4, §5, §6, §7e item 4, §8, §9 E2E 8, §15 phase 11B; migration
-- 20260902160000).
--
-- Proved from real Owner, Staff and anonymous JWTs:
--
--   1. structure — the guard now fires on `is_visible` as well as `published`, every
--      function SECURITY INVOKER with search_path pinned, no new SECURITY DEFINER, the
--      pages policies and grants unchanged;
--   2. `image_references` — a published takeaway image is a live `page:takeaway` row
--      named "Mad ud af huset", a draft one a pending row, a malformed value
--      contributes nothing;
--   3. the switch — a direct write of `is_visible` is refused for Staff and Owner
--      (42501) and for anon; a draft `is_visible` is written by Staff, `publish_page()`
--      moves it into the column and never into the document, the audit row carries
--      both states, anon loses the row, Staff still reads it, and it comes back the
--      same way; a stale publish writes nothing;
--   4. the image path — a direct write of the published image is refused for Staff
--      and Owner, a text-only write still works, a draft image is written by Staff,
--      publish moves it live, and the marker is spent afterwards;
--   5. `delete_image()` over the page — the §19 matrix for a top-level key: live A
--      alone; draft B alone; live A + draft B, delete A; live A + draft B, delete B;
--      the same image live and pending; the unconfirmed refusal counts the page rows;
--      Staff is NOT refused (the page is Staff-writable, unlike the Forside); every
--      unrelated key byte-identical;
--   6. `replace_image()` over the page — live and pending repointed by Staff in one
--      call, `affected` reporting both, a stale replacement a conflict;
--   7. audit — the publishes and the deletes write their rows; refused writes none;
--   8. unrelated content — the Forside document, the announcement and the opening
--      hours are byte-identical.
--
-- Not proved here, on purpose: a draft carrying an unexpected key inside a section.
-- `publish_page()` merges documents and parses nothing (§4: the field-level shape is
-- the application's), so that refusal is `storedDraftIsValid` in
-- `lib/publishing/publish.ts` — unit-tested in `tests/unit/schemas/drafts.test.ts`
-- and driven end to end in `tests/e2e/takeaway-admin.spec.ts`.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–025.

begin;
create extension if not exists pgtap with schema extensions;

select plan(98);

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

/* Fixture doors for the takeaway row, written as the table owner (the guard steps aside). */
create function pg_temp.fixture_published(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set published = p_doc where key = 'takeaway';
end;
$fn$;

create function pg_temp.fixture_draft(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set draft = p_doc where key = 'takeaway';
end;
$fn$;

create function pg_temp.fixture_visible(p_visible boolean) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.pages set is_visible = p_visible where key = 'takeaway';
end;
$fn$;

/* A whole takeaway document with the image as given (null = no image). */
create function pg_temp.doc(p_image uuid) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'heading', 'Mad til fester',
    'intro', 'Intro',
    'image_id', p_image,
    'sections', jsonb_build_array(
      jsonb_build_object('id', 'afsnit-1', 'heading', 'Et', 'body', 'Tekst', 'sort', 1)),
    'cta_label', 'Ring og hør mere')
$fn$;

create function pg_temp.published() returns jsonb
language sql security definer set search_path = '' as $fn$
  select published from public.pages where key = 'takeaway'
$fn$;

create function pg_temp.draft() returns jsonb
language sql security definer set search_path = '' as $fn$
  select draft from public.pages where key = 'takeaway'
$fn$;

create function pg_temp.visible() returns boolean
language sql security definer set search_path = '' as $fn$
  select is_visible from public.pages where key = 'takeaway'
$fn$;

create function pg_temp.version() returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.pages where key = 'takeaway'
$fn$;

create function pg_temp.page_id() returns uuid
language sql security definer set search_path = '' as $fn$
  select id from public.pages where key = 'takeaway'
$fn$;

/* Unrelated content, fingerprinted. */
create function pg_temp.home_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(p) - 'updated_at' from public.pages p where key = 'home'
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

/* The newest publish audit row's after-state, read past audit_log's Owner-only policy. */
create function pg_temp.last_publish_after() returns jsonb
language sql security definer set search_path = '' as $fn$
  select a.after from public.audit_log a
   where a.action = 'publish' and a.entity = 'page:takeaway'
   order by a.created_at desc limit 1
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

-- The seed leaves the page visible with no image and no draft.
select pg_temp.fixture_published(pg_temp.doc(null));
select pg_temp.fixture_draft(null);
select pg_temp.fixture_visible(true);

-- ===========================================================================
-- 1. Structure
-- ===========================================================================

select ok(
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_guard_image_reference_write' and not t.tgisinternal
             and t.tgattr @> array[(select attnum from pg_attribute
                                     where attrelid = c.oid and attname = 'is_visible')]::int2vector),
  'the page guard fires on is_visible as well as published');

select ok(
  exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'pages'
             and t.tgname = 'pages_consume_image_reference_write' and not t.tgisinternal),
  'the statement-level marker consumer is still attached to pages');

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'takeaway_page_names_image'
             and not p.prosecdef),
  'takeaway_page_names_image() is SECURITY INVOKER');

select ok(
  (select bool_and(not p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_page', 'delete_image', 'replace_image',
                        'tg_guard_page_image_reference_write')),
  'publish_page(), delete_image(), replace_image() and the page guard are SECURITY INVOKER with search_path pinned');

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
  'phase 11B adds no SECURITY DEFINER function');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'pages'),
  array['pages_select_public', 'pages_select_staff', 'pages_update_scoped'],
  'the three phase-1 pages policies still stand unchanged');

select ok(
  has_table_privilege('authenticated', 'public.pages', 'UPDATE')
  and not has_table_privilege('anon', 'public.pages', 'UPDATE'),
  'the pages UPDATE grant is unchanged');

-- ===========================================================================
-- 2. image_references: the page's two rows
-- ===========================================================================

select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1/original.jpg');
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/original.jpg');
select pg_temp.make_image('test.c', 'cccccccc-cccc-4ccc-8ccc-ccccccccccb1/original.jpg');
reset role;

select is(
  (select count(*) from public.image_references where kind = 'page:takeaway'),
  0::bigint,
  'the seeded page names no image');

select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.become_staff();

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.a') and kind = 'page:takeaway'
      and name = 'Mad ud af huset' and entity_id = pg_temp.page_id() and not pending),
  1::bigint,
  'a published image is one live page:takeaway row named Mad ud af huset');

update public.pages
   set draft = jsonb_build_object('image_id', pg_temp.img('test.b'))
 where key = 'takeaway';

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:takeaway' and pending),
  1::bigint,
  'a draft image is one pending page:takeaway row — written by Staff');

reset role;
select pg_temp.fixture_published(jsonb_set(pg_temp.doc(null), '{image_id}', '"ikke-en-uuid"'::jsonb));
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();

select lives_ok(
  $$ select count(*) from public.image_references $$,
  'a malformed published value does not make the view throw');
select is(
  (select count(*) from public.image_references where kind = 'page:takeaway'),
  0::bigint,
  'and contributes no reference');

-- ===========================================================================
-- 3. The switch: a draft field, moved by publish_page() alone
-- ===========================================================================

reset role;
select pg_temp.fixture_published(pg_temp.doc(null));
select pg_temp.fixture_visible(true);

-- a) direct writes of the column are refused for every browser role
select pg_temp.become_staff();
select throws_ok(
  $$ update public.pages set is_visible = false where key = 'takeaway' $$,
  '42501', null,
  'Staff is refused a direct write of the switch');
select throws_ok(
  $$ update public.pages set is_visible = false, published = published where key = 'takeaway' $$,
  '42501', null,
  'and a direct write that moves the switch beside the document');

reset role;
select pg_temp.become_owner();
select throws_ok(
  $$ update public.pages set is_visible = false where key = 'takeaway' $$,
  '42501', null,
  'the Owner is refused the same direct write — authority to publish is not authority to bypass');

reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ update public.pages set is_visible = false where key = 'takeaway' $$,
  '42501', null,
  'anon holds no UPDATE at all');
select is(pg_temp.visible(), true, 'and the column is exactly as it was');

-- b) the draft is the door in, for Staff (§5)
reset role;
select pg_temp.become_staff();
select is(
  pg_temp.rows_moved($$ update public.pages set draft = '{"is_visible": false}'::jsonb where key = 'takeaway' $$),
  1,
  'Staff writes a draft that switches the page off');
select is(pg_temp.visible(), true, 'the column has not moved — a guest still gets the page');
select is(
  (select count(*) from public.pending_changes where entity = 'page:takeaway'),
  1::bigint,
  'the page is pending');

-- c) a stale publish writes nothing
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version() - interval '1 second') ->> 'status'),
  'conflict',
  'a stale publish is a conflict');
select is(pg_temp.visible(), true, 'and moved nothing');
select is(pg_temp.draft(), '{"is_visible": false}'::jsonb, 'and left the draft intact');

-- d) Staff publishes: the column moves, the document does not carry the key
select set_config('test.pub_off',
  (select public.publish_page(pg_temp.page_id(), pg_temp.version()))::text, true);
select is(
  (current_setting('test.pub_off')::jsonb ->> 'status'), 'published',
  'Staff publishes the switch');
select is(pg_temp.visible(), false, 'the column is now false');
select ok(
  not (pg_temp.published() ? 'is_visible'),
  'the published document does NOT carry is_visible — it is a draft key, never a document key');
select is(pg_temp.published(), pg_temp.doc(null), 'and the document is byte-identical otherwise');
select is(pg_temp.draft(), null, 'the draft is cleared');
select is(
  (current_setting('test.pub_off')::jsonb -> 'before' -> 'is_visible'), 'true'::jsonb,
  'the audit before-state records the page as visible');
select is(
  (current_setting('test.pub_off')::jsonb -> 'after' -> 'is_visible'), 'false'::jsonb,
  'and the after-state as hidden');
select is(
  pg_temp.last_publish_after() -> 'is_visible',
  'false'::jsonb,
  'the audit_log row carries the same after-state');

-- e) the page has left the public read; Staff still sees it
reset role;
select pg_temp.become_anon();
select is(
  (select count(*) from public.pages where key = 'takeaway'),
  0::bigint,
  'anon no longer sees the row — the route 404s and the navigation drops the item');
reset role;
select pg_temp.become_staff();
select is(
  (select count(*) from public.pages where key = 'takeaway'),
  1::bigint,
  'Staff still reads the row, so the editor can switch it back on');

-- f) and back on, the same way
select is(
  pg_temp.rows_moved($$ update public.pages set draft = '{"is_visible": true}'::jsonb where key = 'takeaway' $$),
  1,
  'Staff writes a draft that switches the page back on');
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version()) ->> 'status'),
  'published',
  'and publishes it');
select is(pg_temp.visible(), true, 'the column is true again');
reset role;
select pg_temp.become_anon();
select is(
  (select count(*) from public.pages where key = 'takeaway'),
  1::bigint,
  'anon sees the row again');

-- g) a draft that says nothing about the switch leaves the column alone
reset role;
select pg_temp.become_staff();
select is(
  pg_temp.rows_moved($$ update public.pages set draft = '{"heading": "Ny overskrift"}'::jsonb where key = 'takeaway' $$),
  1,
  'Staff writes a text-only draft');
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version()) ->> 'status'),
  'published',
  'and publishes it');
select is(pg_temp.visible(), true, 'the switch is untouched');
select is(pg_temp.published() ->> 'heading', 'Ny overskrift', 'and the heading moved');

-- ===========================================================================
-- 4. The image path: moved only through a transition
-- ===========================================================================

reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.fixture_draft(null);

select pg_temp.become_staff();
select throws_ok(
  format($$ update public.pages set published = jsonb_set(published, '{image_id}', %L::jsonb)
             where key = 'takeaway' $$, to_jsonb(pg_temp.img('test.b'))::text),
  '42501', null,
  'Staff is refused a direct change of the published image');
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{image_id}', 'null'::jsonb)
      where key = 'takeaway' $$,
  '42501', null,
  'and a direct clearing of it');
select throws_ok(
  $$ update public.pages set published = '{"heading": "Alt erstattet"}'::jsonb where key = 'takeaway' $$,
  '42501', null,
  'a whole-document replacement that drops the live image is a clearing, and refused');
select is(
  pg_temp.published() ->> 'image_id', pg_temp.img('test.a')::text,
  'and the published image is exactly as it was');

select lives_ok(
  $$ update public.pages set published = jsonb_set(published, '{heading}', '"Rettet direkte"'::jsonb)
      where key = 'takeaway' $$,
  'Staff may still write the published document when the image path does not move (002''s promise)');
select is(pg_temp.published() ->> 'heading', 'Rettet direkte', 'and the text write took effect');

reset role;
select pg_temp.become_owner();
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{image_id}', 'null'::jsonb)
      where key = 'takeaway' $$,
  '42501', null,
  'the Owner is refused the same direct clearing');

reset role;
select pg_temp.become_staff();
select lives_ok(
  format($$ update public.pages set draft = jsonb_build_object('image_id', %L::uuid) where key = 'takeaway' $$,
         pg_temp.img('test.b')::text),
  'Staff writes a draft naming image B');
select is(
  (select public.publish_page(pg_temp.page_id(), pg_temp.version()) ->> 'status'),
  'published',
  'Staff publishes it');
select is(
  pg_temp.published() ->> 'image_id', pg_temp.img('test.b')::text,
  'the image is B on the hjemmeside');
select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.b') and kind = 'page:takeaway' and not pending),
  1::bigint,
  'the reference is live in the view now');
select throws_ok(
  $$ update public.pages set published = jsonb_set(published, '{image_id}', 'null'::jsonb)
      where key = 'takeaway' $$,
  '42501', null,
  'after the publish the marker is spent — a direct clearing is refused again');

-- ===========================================================================
-- 5. delete_image() over the page — the §19 matrix, Staff-operated
-- ===========================================================================

-- Live A alone. Delete A, as Staff.
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();
select set_config('test.pub_before', pg_temp.published()::text, true);

select set_config('test.del_unconfirmed',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), false))::text, true);
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'status'), 'in_use',
  'an image the page uses refuses an unconfirmed delete');
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'references'), '1',
  'and counts the one page reference');

select set_config('test.del_a',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is(
  (current_setting('test.del_a')::jsonb ->> 'status'), 'deleted',
  'Staff''s confirmed delete goes through — the page is Staff-writable, no owner_only');
select is(pg_temp.published() -> 'image_id', 'null'::jsonb, 'the published image is cleared to JSON null');
select is(
  pg_temp.published() - 'image_id', current_setting('test.pub_before')::jsonb - 'image_id',
  'every other key of the published document is byte-identical');
select is(
  (current_setting('test.del_a')::jsonb -> 'affected' -> 'live' ->> 'page:takeaway'), '1',
  'affected.live names the one page row a guest could see');
select is(
  (current_setting('test.del_a')::jsonb -> 'affected' -> 'draft' ->> 'page:takeaway'), '0',
  'and no pending one');
select is(pg_temp.draft(), null, 'the draft stays NULL');

-- Draft B alone (with a pending heading beside it). Delete B.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(null));
select pg_temp.fixture_draft(jsonb_build_object('heading', 'Ny overskrift', 'image_id', pg_temp.img('test.b')));
select pg_temp.become_staff();

select set_config('test.del_b',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is((current_setting('test.del_b')::jsonb ->> 'status'), 'deleted', 'a draft-only page image deletes');
select is(pg_temp.draft(), '{"heading": "Ny overskrift"}'::jsonb,
  'the image_id key leaves the draft; the pending heading is byte-identical');
select is(pg_temp.published(), pg_temp.doc(null), 'the published document is byte-identical');
select is((current_setting('test.del_b')::jsonb -> 'affected' -> 'live' ->> 'page:takeaway'), '0',
  'affected.live: nothing a guest could see');
select is((current_setting('test.del_b')::jsonb -> 'affected' -> 'draft' ->> 'page:takeaway'), '1',
  'affected.draft: the one pending row');

-- Draft B alone, nothing else pending. Delete B → the draft is NULL.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/original.jpg');
reset role;
select pg_temp.fixture_draft(jsonb_build_object('image_id', pg_temp.img('test.b')));
select pg_temp.become_staff();
select set_config('test.del_b_only',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is(pg_temp.draft(), null, 'an emptied draft becomes NULL — the phase-4 empty-draft rule');

-- Live A + draft B. Delete A → live clears, pending B remains.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.fixture_draft(jsonb_build_object('image_id', pg_temp.img('test.b')));
select pg_temp.become_staff();

select set_config('test.del_a2',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is((current_setting('test.del_a2')::jsonb ->> 'status'), 'deleted', 'live A with draft B: deleting A goes through');
select is(pg_temp.published() -> 'image_id', 'null'::jsonb, 'the live image clears');
select is(pg_temp.draft() ->> 'image_id', pg_temp.img('test.b')::text, 'and the pending selection of B remains');
select is((current_setting('test.del_a2')::jsonb -> 'affected' -> 'live' ->> 'page:takeaway'), '1', 'affected.live: one');
select is((current_setting('test.del_a2')::jsonb -> 'affected' -> 'draft' ->> 'page:takeaway'), '0', 'affected.draft: zero');

-- Live A + draft B. Delete B → live A remains, the pending selection clears.
reset role;
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.fixture_draft(jsonb_build_object('image_id', pg_temp.img('test.b')));
select pg_temp.become_staff();

select set_config('test.del_b2',
  (select public.delete_image(pg_temp.img('test.b'), pg_temp.img_version('test.b'), true))::text, true);
select is(pg_temp.published() ->> 'image_id', pg_temp.img('test.a')::text, 'live A remains');
select is(pg_temp.draft(), null, 'the draft is NULL: the pending selection cleared and nothing else was pending');
select is((current_setting('test.del_b2')::jsonb -> 'affected' -> 'live' ->> 'page:takeaway'), '0', 'affected.live: zero');
select is((current_setting('test.del_b2')::jsonb -> 'affected' -> 'draft' ->> 'page:takeaway'), '1', 'affected.draft: one');

-- The same image live and pending (A/A). Delete A → both clear.
reset role;
select pg_temp.fixture_draft(jsonb_build_object('image_id', pg_temp.img('test.a'), 'cta_label', 'Ring nu'));
select pg_temp.become_staff();

select set_config('test.del_aa',
  (select public.delete_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), true))::text, true);
select is(pg_temp.published() -> 'image_id', 'null'::jsonb, 'same image live and pending: the live slot clears');
select is(pg_temp.draft(), '{"cta_label": "Ring nu"}'::jsonb, 'the pending key leaves; the pending button label stays');
select is((current_setting('test.del_aa')::jsonb -> 'affected' -> 'live' ->> 'page:takeaway'), '1', 'affected.live: one');
select is((current_setting('test.del_aa')::jsonb -> 'affected' -> 'draft' ->> 'page:takeaway'), '1', 'affected.draft: one');
select is(
  (select count(*) from public.image_references where kind = 'page:takeaway'),
  0::bigint,
  'the view agrees: no page reference is left');

-- ===========================================================================
-- 6. replace_image() over the page — Staff, one call, both references
-- ===========================================================================

reset role;
select pg_temp.fixture_draft(null);
select pg_temp.become_staff();
select pg_temp.make_image('test.a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab4/original.jpg');
select pg_temp.make_image('test.e', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeb4/original.jpg');
reset role;
select pg_temp.fixture_published(pg_temp.doc(pg_temp.img('test.a')));
select pg_temp.fixture_draft(jsonb_build_object('image_id', pg_temp.img('test.a'), 'heading', 'Pending'));
select pg_temp.become_staff();

select set_config('test.rep_stale',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a') - interval '1 second',
                               pg_temp.img('test.e')))::text, true);
select is((current_setting('test.rep_stale')::jsonb ->> 'status'), 'conflict', 'a stale replacement is a conflict');
select is(pg_temp.published() ->> 'image_id', pg_temp.img('test.a')::text, 'and moved nothing');

select set_config('test.rep',
  (select public.replace_image(pg_temp.img('test.a'), pg_temp.img_version('test.a'), pg_temp.img('test.e')))::text, true);
select is((current_setting('test.rep')::jsonb ->> 'status'), 'replaced', 'Staff replaces A with E — no owner_only for this page');
select is(pg_temp.published() ->> 'image_id', pg_temp.img('test.e')::text, 'the live image now carries E');
select is(pg_temp.draft() ->> 'image_id', pg_temp.img('test.e')::text, 'the pending selection now names E');
select is(pg_temp.draft() ->> 'heading', 'Pending', 'and its pending words are untouched');
select is((current_setting('test.rep')::jsonb ->> 'references'), '2', 'two references moved in all');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'live'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 1, "page:about": 0}'::jsonb,
  'affected.live: the page');
select is(
  (current_setting('test.rep')::jsonb -> 'affected' -> 'draft'),
  '{"dish": 0, "weekly": 0, "monthly": 0, "news": 0, "page:home": 0, "page:takeaway": 1, "page:about": 0}'::jsonb,
  'affected.draft: the pending selection');
select is((select count(*) from public.images where id = pg_temp.img('test.a')), 0::bigint, 'and A is gone');

-- ===========================================================================
-- 7. Audit
-- ===========================================================================

reset role;
select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'page:takeaway'),
  4::bigint,
  'the four publishes each wrote one row — the stale one wrote none');
select is(
  (select count(*) from public.audit_log where action = 'delete' and entity = 'image'),
  6::bigint,
  'the six confirmed deletes each wrote one row — the unconfirmed refusal wrote none');
select is(
  (select count(*) from public.audit_log where action = 'replace' and entity = 'image'),
  1::bigint,
  'the one replacement wrote one row — the stale one wrote none');

-- ===========================================================================
-- 8. Unrelated content
-- ===========================================================================

select is(pg_temp.home_state(), current_setting('test.home_before')::jsonb,
  'the Forside row is byte-identical (updated_at aside)');
select is(pg_temp.announcement_state(), current_setting('test.announcement_before')::jsonb,
  'the announcement is byte-identical');
select is(pg_temp.hours_state(), current_setting('test.hours_before')::jsonb,
  'the opening hours are byte-identical');

-- ---------------------------------------------------------------------------
-- Cleanup: the page as the seed leaves it — visible, no image, no draft
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.fixture_draft(null);
select pg_temp.fixture_visible(true);

select * from finish();
