-- Klingenberg Food — pgTAP: the image storage foundation (technical plan §1
-- adjustments 2 and 3, §4, §5, §8; §15 phase 10). Phase 10A.
--
-- The subject is the authority boundary 20260901140000 built: an images row is
-- created only by create_image() and removed only by delete_image(); every column
-- except alt_text is out of the direct-UPDATE grant; the two storage buckets exist
-- with the visibility and limits the pipeline depends on; and storage.objects has
-- no policy at all for browser roles, so a session can write storage only through
-- the one signed upload token the server mints.
--
-- What pgTAP deliberately does NOT cover here: the storage HTTP surface itself —
-- signed-token scope, actual object bytes, public derivative reads. Those run
-- against the real storage service in tests/integration/images.test.ts, because a
-- database test pretending to cover an HTTP service would be coverage theatre.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–019.

begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

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
 * The fixture door for a LIVE image reference. Since 20260901200000 a Staff or
 * Owner JWT cannot move dishes/weekly_special/monthly_burger.image_id directly —
 * only publish, replace_image() and a confirmed delete_image() may (023 proves
 * it) — so a fixture that needs a live reference in place sets it as the table
 * owner, the way seed.sql would. SECURITY DEFINER here is the test's own
 * privilege, never the application's; the guard steps aside for the owner
 * exactly as it does for a migration.
 */
create function pg_temp.fixture_live_image(p_kind text, p_image uuid) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  case p_kind
    when 'dish'    then update public.dishes set image_id = p_image where name = 'Thor';
    when 'weekly'  then update public.weekly_special set image_id = p_image;
    when 'monthly' then update public.monthly_burger set image_id = p_image;
  end case;
end;
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

-- Thor is this suite's designated reference fixture (section 4 points its
-- image_id at the created image and the confirmed delete nulls it back), so the
-- fingerprint covers every dish except the one the suite deliberately touches.
create function pg_temp.menu_state() returns text
language sql security definer set search_path = '' as $fn$
  select md5(string_agg(d.id::text || d.name || d.updated_at::text, ',' order by d.id))
    from public.dishes d
   where d.name <> 'Thor'
$fn$;

select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.week_before', pg_temp.week_state()::text, true);
select set_config('test.menu_before', pg_temp.menu_state(), true);

/* A valid derivatives document for a 1600 x 1200 original. */
create function pg_temp.good_derivatives() returns jsonb
language sql as $fn$
  select '{"formats": ["avif", "webp"],
           "widths": [{"width": 480, "height": 360},
                      {"width": 960, "height": 720},
                      {"width": 1440, "height": 1080}]}'::jsonb
$fn$;

-- ===========================================================================
-- 1. Structure: buckets, policies, functions, triggers, grants
-- ===========================================================================

-- The two buckets, exactly as the pipeline and the public read model need them.
select is(
  (select public from storage.buckets where id = 'media'),
  true,
  'the media bucket exists and is public — the derivative read model');
select is(
  (select public from storage.buckets where id = 'media-originals'),
  false,
  'the media-originals bucket exists and is private');
select is(
  (select file_size_limit from storage.buckets where id = 'media-originals'),
  10485760::bigint,
  'originals are capped at 10 MiB by the bucket itself');
select is(
  (select allowed_mime_types from storage.buckets where id = 'media-originals'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'the originals bucket accepts only the three upload types at the door');
select is(
  (select allowed_mime_types from storage.buckets where id = 'media'),
  array['image/avif', 'image/webp'],
  'the derivatives bucket accepts only what the pipeline emits');

-- No storage policy for browser roles: the signed token is the only write path.
select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'),
  0::bigint,
  'storage.objects has no policy at all — anon and authenticated write nothing directly');

-- The images table keeps exactly its five phase-1 policies.
select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'images'),
  array['images_delete_staff', 'images_insert_staff', 'images_select_public',
        'images_select_staff', 'images_update_staff'],
  'the five phase-1 images policies stand unchanged');

-- The two doors exist, SECURITY INVOKER, with an empty search_path.
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'create_image'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'create_image() exists, SECURITY INVOKER, search_path pinned');
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'delete_image'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'delete_image() exists, SECURITY INVOKER, search_path pinned');

-- Phase 10A adds no SECURITY DEFINER function anywhere.
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
  'the only SECURITY DEFINER functions are the five that predate phase 10, plus the two phase-11C functions list_accounts() and revoke_account_sessions()');

-- The guard is wired to both operations.
select has_trigger('public', 'images', 'images_guard_insert',
  'the INSERT guard trigger is installed');
select has_trigger('public', 'images', 'images_guard_delete',
  'the DELETE guard trigger is installed');

-- anon holds no door at all.
select ok(
  not has_function_privilege('anon',
    'public.create_image(text, text, integer, integer, bigint, text, jsonb)', 'EXECUTE'),
  'anon cannot execute create_image()');
select ok(
  not has_function_privilege('anon',
    'public.delete_image(uuid, timestamptz, boolean)', 'EXECUTE'),
  'anon cannot execute delete_image()');

-- The direct UPDATE grant is exactly one column.
select ok(
  has_column_privilege('authenticated', 'public.images', 'alt_text', 'UPDATE'),
  'authenticated may update alt_text directly — the one person-authored column');
select ok(
  not has_column_privilege('authenticated', 'public.images', 'width', 'UPDATE'),
  'width is out of the direct-UPDATE grant');
select ok(
  not has_column_privilege('authenticated', 'public.images', 'storage_path', 'UPDATE'),
  'storage_path is out of the direct-UPDATE grant');
select ok(
  not has_column_privilege('authenticated', 'public.images', 'derivatives', 'UPDATE'),
  'derivatives is out of the direct-UPDATE grant');
select ok(
  not has_column_privilege('authenticated', 'public.images', 'uploaded_by', 'UPDATE'),
  'uploaded_by is out of the direct-UPDATE grant');

-- ===========================================================================
-- 2. Anonymous: reads derivative metadata, writes nothing, calls nothing
-- ===========================================================================

reset role;
insert into public.images (id, storage_path, alt_text, width, height)
values ('66666666-6666-4666-8666-666666666661', 'media/anon-probe.avif', 'Probe', 100, 100);

select pg_temp.become_anon();

select lives_ok(
  $$ select id, storage_path, alt_text, width, height, bytes, mime, derivatives, updated_at
       from public.images $$,
  'anon can read the public image columns');
select throws_ok(
  $$ select original_filename from public.images $$,
  '42501', null,
  'anon cannot read original_filename');
select throws_ok(
  $$ select uploaded_by from public.images $$,
  '42501', null,
  'anon cannot read uploaded_by');
select throws_ok(
  $$ insert into public.images (storage_path)
     values ('99999999-9999-4999-8999-999999999999/original.jpg') $$,
  '42501', null,
  'anon cannot insert an image row');
select throws_ok(
  $$ select public.create_image('99999999-9999-4999-8999-999999999999/original.jpg',
       'image/jpeg', 100, 100, 1000, null, pg_temp.good_derivatives()) $$,
  '42501', null,
  'anon cannot call create_image()');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('media', 'forged/object.avif') $$,
  '42501', null,
  'anon cannot write a storage object directly');

-- ===========================================================================
-- 3. Staff: the trusted doors work; every direct write is refused
-- ===========================================================================

reset role;
select pg_temp.become_staff();

-- 3a. The one door in.
select set_config('test.created',
  public.create_image(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg', 'image/jpeg',
    1600, 1200, 250000, 'IMG_2024 fra telefonen.jpg', pg_temp.good_derivatives())::text,
  true);

select is(
  (current_setting('test.created')::jsonb ->> 'status'),
  'created',
  'staff can create an image through create_image()');
select is(
  (select mime from public.images
    where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'),
  'image/jpeg',
  'the row stores the sniffed MIME the server passed');
select is(
  (select uploaded_by from public.images
    where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'),
  current_setting('test.staff_uid')::uuid,
  'uploaded_by is the caller''s auth.uid(), never a parameter');
select is(
  (select derivatives from public.images
    where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'),
  pg_temp.good_derivatives(),
  'the derivative record survives byte for byte');
-- The audit log is owner-eyes-only (§5), so its assertions read as superuser.
reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'upload' and entity = 'image'
      and actor_id = current_setting('test.staff_uid')::uuid),
  1::bigint,
  'the creation wrote one upload audit row attributed to the caller');
select pg_temp.become_staff();

-- 3b. Replay: the same finalized upload is one row, once.
select is(
  (select public.create_image(
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg', 'image/jpeg',
     1600, 1200, 250000, 'IMG_2024 fra telefonen.jpg', pg_temp.good_derivatives())
     ->> 'status'),
  'exists',
  'a replayed create_image() reports the existing row instead of creating one');
select is(
  (select public.create_image(
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg', 'image/jpeg',
     1600, 1200, 250000, null, pg_temp.good_derivatives()) ->> 'id'),
  (current_setting('test.created')::jsonb ->> 'id'),
  'the replay answers with the same row id');
select is(
  (select count(*) from public.images
    where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'),
  1::bigint,
  'the replay created no second row');
reset role;
select is(
  (select count(*) from public.audit_log where action = 'upload' and entity = 'image'),
  1::bigint,
  'the replay wrote no second audit row');
select pg_temp.become_staff();

-- 3c. The metadata cannot be forged — every invalid claim is refused whole.
select throws_ok(
  $q$ select public.create_image('../../etc/passwd', 'image/jpeg',
        100, 100, 1000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'a traversal path is refused');
select throws_ok(
  $q$ select public.create_image('media/handpicked.jpg', 'image/jpeg',
        100, 100, 1000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'a hand-picked non-upload path is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/png', 1600, 1200, 250000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'a MIME that contradicts the stored extension is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/svg+xml', 100, 100, 1000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'SVG is not an accepted type');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 20000, 100, 1000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'a width past 10000 px is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 6000, 6000, 1000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'more than 30 megapixels is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 1600, 1200, 20000000, null, pg_temp.good_derivatives()) $q$,
  '22023', null,
  'more than 10 MiB is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 1600, 1200, 250000, null,
        '{"formats": ["avif", "webp"],
          "widths": [{"width": 480, "height": 360}, {"width": 960, "height": 720},
                     {"width": 1440, "height": 1080}, {"width": 2160, "height": 1620}]}'::jsonb) $q$,
  '22023', null,
  'an upscaled rung — 2160 for a 1600 px source — is refused');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 1600, 1200, 250000, null,
        '{"formats": ["avif", "webp"], "widths": [{"width": 480, "height": 360}],
          "paths": ["somewhere/else"]}'::jsonb) $q$,
  '22023', null,
  'an unknown key in the derivatives document is refused — no stored paths, ever');
select throws_ok(
  $q$ select public.create_image('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/original.jpg',
        'image/jpeg', 1600, 1200, 250000,
        'evil' || chr(10) || 'name.jpg', pg_temp.good_derivatives()) $q$,
  '22023', null,
  'a control character in the display filename is refused');

-- 3d. Direct writes stay refused for the browser roles.
select throws_ok(
  $$ insert into public.images (storage_path)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/original.jpg') $$,
  '42501', null,
  'staff cannot insert an image row directly — create_image() is the only door');
select throws_ok(
  $$ update public.images set width = 1
      where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg' $$,
  '42501', null,
  'staff cannot rewrite a measurement column directly');
select throws_ok(
  $$ update public.images
        set storage_path = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1/original.jpg'
      where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg' $$,
  '42501', null,
  'staff cannot repoint a row at other files');
select lives_ok(
  $$ update public.images set alt_text = 'Burgeren fra siden'
      where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg' $$,
  'staff can edit alt_text directly — the one person-authored column');
select throws_ok(
  $$ delete from public.images
      where storage_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg' $$,
  '42501', null,
  'staff cannot delete an image row directly — delete_image() is the only door');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('media', 'forged/staff.avif') $$,
  '42501', null,
  'staff cannot write a storage object directly either');

-- 3e. The guard marker is single-use, as in 016 and 018.
select set_config('app.image_write', 'create', true);
select lives_ok(
  $$ insert into public.images (storage_path, mime, width, height, bytes)
     values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1/original.jpg',
             'image/jpeg', 10, 10, 100) $$,
  'a manually set marker admits exactly one statement (the mechanism, not a door)');
select throws_ok(
  $$ insert into public.images (storage_path, mime, width, height, bytes)
     values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2/original.jpg',
             'image/jpeg', 10, 10, 100) $$,
  '42501', null,
  'the marker was consumed — it cannot be held open for a second statement');

-- ===========================================================================
-- 4. delete_image(): version-checked, reference-aware, audited
-- ===========================================================================

-- A dish that uses the image. Since 20260901200000 the live column is written
-- only by the publish, replace and detach transitions (023 proves it), so the
-- fixture sets it as the table owner.
select lives_ok(
  $$ select pg_temp.fixture_live_image('dish',
       (current_setting('test.created')::jsonb ->> 'id')::uuid) $$,
  'a dish can reference the image (set as the table owner — the fixture door)');

select is(
  (select public.delete_image(
     (current_setting('test.created')::jsonb ->> 'id')::uuid,
     '2020-01-01T00:00:00Z'::timestamptz) ->> 'status'),
  'conflict',
  'a stale version token is refused as conflict');
select is(
  (select public.delete_image(
     '99999999-9999-4999-8999-999999999999'::uuid, now()) ->> 'status'),
  'not_found',
  'an unknown image id reports not_found');

select set_config('test.in_use',
  (select public.delete_image(
     (current_setting('test.created')::jsonb ->> 'id')::uuid,
     (select updated_at from public.images
       where id = (current_setting('test.created')::jsonb ->> 'id')::uuid)))::text,
  true);
select is(
  (current_setting('test.in_use')::jsonb ->> 'status'),
  'in_use',
  'an unconfirmed delete of a referenced image refuses with in_use');
select is(
  (current_setting('test.in_use')::jsonb ->> 'references'),
  '1',
  'and names how many places use it');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.created')::jsonb ->> 'id')::uuid),
  1::bigint,
  'the refused delete removed nothing');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  (current_setting('test.created')::jsonb ->> 'id')::uuid,
  'and the dish still points at the image');

select set_config('test.deleted',
  (select public.delete_image(
     (current_setting('test.created')::jsonb ->> 'id')::uuid,
     (select updated_at from public.images
       where id = (current_setting('test.created')::jsonb ->> 'id')::uuid),
     p_confirmed => true))::text,
  true);
select is(
  (current_setting('test.deleted')::jsonb ->> 'status'),
  'deleted',
  'the confirmed delete goes through');
select is(
  (current_setting('test.deleted')::jsonb ->> 'storage_path'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg',
  'and returns the storage path so the server can remove the files');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  null::uuid,
  'the dish reference is nulled in the same transaction — never a dangling id (§7e item 4)');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.created')::jsonb ->> 'id')::uuid),
  0::bigint,
  'the row is gone');
reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'delete' and entity = 'image'
      and before ->> 'storage_path' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'
      and after is null),
  1::bigint,
  'the deletion is audited with the content as the recovery story');
select pg_temp.become_staff();

-- ===========================================================================
-- 5. Owner: the same two doors, the same refusals
-- ===========================================================================

reset role;
select pg_temp.become_owner();

select set_config('test.owner_img',
  public.create_image(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/original.webp', 'image/webp',
    300, 200, 5000, null,
    '{"formats": ["avif", "webp"], "widths": [{"width": 300, "height": 200}]}'::jsonb)::text,
  true);
select is(
  (current_setting('test.owner_img')::jsonb ->> 'status'),
  'created',
  'owner can create an image through create_image()');
select is(
  (select derivatives -> 'widths' -> 0 ->> 'width' from public.images
    where storage_path = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/original.webp'),
  '300',
  'a source below the smallest rung records its own width — never upscaled');
select throws_ok(
  $$ insert into public.images (storage_path)
     values ('ffffffff-ffff-4fff-8fff-fffffffffff1/original.jpg') $$,
  '42501', null,
  'owner cannot insert an image row directly either');
select is(
  (select public.delete_image(
     (current_setting('test.owner_img')::jsonb ->> 'id')::uuid,
     (current_setting('test.owner_img')::jsonb ->> 'updated_at')::timestamptz) ->> 'status'),
  'deleted',
  'owner can delete an unreferenced image without confirmation');

-- ===========================================================================
-- 6. Nothing else moved
-- ===========================================================================

reset role;

select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — image writes touch no other content');
select is(
  pg_temp.week_state()::text,
  current_setting('test.week_before'),
  'the opening hours are byte-identical');
select is(
  pg_temp.menu_state(),
  current_setting('test.menu_before'),
  'every dish except the designated fixture is byte-identical');

select * from finish();
rollback;
