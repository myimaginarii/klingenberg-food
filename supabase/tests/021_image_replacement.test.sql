-- Klingenberg Food — pgTAP: the image replacement transition (technical plan §5,
-- §7e item 4, §15 phase 10; design 1w "Erstat"). Phase 10B.
--
-- The subject is 20260901160000's one function: replace_image() repoints every
-- image_id reference from an old image to an already-finalized new one and removes
-- the old row, in one transaction, version-checked, audited as 'replace' — and the
-- 10A authority boundary around it stands unchanged: direct writes stay refused,
-- the policies stay the five from phase 1, and no SECURITY DEFINER appears.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–020.

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

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

/* Unrelated content, fingerprinted so "untouched" is a probe rather than a hope. */
create function pg_temp.announcement_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(a) from public.announcement a limit 1
$fn$;

create function pg_temp.week_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

select set_config('test.announcement_before', pg_temp.announcement_state()::text, true);
select set_config('test.week_before', pg_temp.week_state()::text, true);

/* A valid derivatives document for a 1600 x 1200 original. */
create function pg_temp.good_derivatives() returns jsonb
language sql as $fn$
  select '{"formats": ["avif", "webp"],
           "widths": [{"width": 480, "height": 360},
                      {"width": 960, "height": 720},
                      {"width": 1440, "height": 1080}]}'::jsonb
$fn$;

-- ===========================================================================
-- 1. Structure: the function, its grants, and the unchanged 10A boundary
-- ===========================================================================

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'replace_image'
             and not p.prosecdef and p.proconfig = array['search_path=""']),
  'replace_image() exists, SECURITY INVOKER, search_path pinned');

select ok(
  not has_function_privilege('anon',
    'public.replace_image(uuid, timestamptz, uuid)', 'EXECUTE'),
  'anon cannot execute replace_image()');

select ok(
  has_function_privilege('authenticated',
    'public.replace_image(uuid, timestamptz, uuid)', 'EXECUTE'),
  'authenticated holds EXECUTE on replace_image()');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('is_staff', 'is_owner', 'log_audit', 'editor_name',
                            'enforce_owner_invariant')),
  0::bigint,
  'phase 10B adds no SECURITY DEFINER function either');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'images'),
  array['images_delete_staff', 'images_insert_staff', 'images_select_public',
        'images_select_staff', 'images_update_staff'],
  'the five phase-1 images policies still stand unchanged');

-- ===========================================================================
-- 2. Staff: the transition, its refusals, and its atomicity
-- ===========================================================================

reset role;
select pg_temp.become_staff();

select set_config('test.img_a',
  public.create_image(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1/original.jpg', 'image/jpeg',
    1600, 1200, 250000, 'gammelt-foto.jpg', pg_temp.good_derivatives())::text,
  true);
select is(
  (current_setting('test.img_a')::jsonb ->> 'status'),
  'created',
  'the old image is created through the one door in');

select set_config('test.img_b',
  public.create_image(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/original.webp', 'image/webp',
    300, 200, 5000, 'nyt-foto.webp',
    '{"formats": ["avif", "webp"], "widths": [{"width": 300, "height": 200}]}'::jsonb)::text,
  true);
select is(
  (current_setting('test.img_b')::jsonb ->> 'status'),
  'created',
  'the replacement image is created the same way — a finished library row');

-- Thor references the old image, with a pending draft that must survive whole.
update public.dishes
   set image_id = (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
       draft = '{"description": "pgTAP-kladde der skal overleve"}'::jsonb
 where name = 'Thor';

-- 2a. Refusals, none of which move anything.
select is(
  (select public.replace_image(
     (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
     '2020-01-01T00:00:00Z'::timestamptz,
     (current_setting('test.img_b')::jsonb ->> 'id')::uuid) ->> 'status'),
  'conflict',
  'a stale version token is refused as conflict');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
  'the refused replacement moved no reference');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.img_a')::jsonb ->> 'id')::uuid),
  1::bigint,
  'and deleted nothing');

select is(
  (select public.replace_image(
     '99999999-9999-4999-8999-999999999999'::uuid, now(),
     (current_setting('test.img_b')::jsonb ->> 'id')::uuid) ->> 'status'),
  'not_found',
  'an unknown old image reports not_found');

select is(
  (select public.replace_image(
     (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
     (current_setting('test.img_a')::jsonb ->> 'updated_at')::timestamptz,
     (current_setting('test.img_a')::jsonb ->> 'id')::uuid) ->> 'status'),
  'invalid_replacement',
  'replacing an image with itself is refused');

select is(
  (select public.replace_image(
     (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
     (current_setting('test.img_a')::jsonb ->> 'updated_at')::timestamptz,
     '99999999-9999-4999-8999-999999999999'::uuid) ->> 'status'),
  'missing_replacement',
  'a replacement id naming no finished row is refused');

-- 2b. The real transition.
select set_config('test.b_updated_before',
  (select updated_at::text from public.images
    where id = (current_setting('test.img_b')::jsonb ->> 'id')::uuid), true);

select set_config('test.replaced',
  (select public.replace_image(
     (current_setting('test.img_a')::jsonb ->> 'id')::uuid,
     (current_setting('test.img_a')::jsonb ->> 'updated_at')::timestamptz,
     (current_setting('test.img_b')::jsonb ->> 'id')::uuid))::text,
  true);

select is(
  (current_setting('test.replaced')::jsonb ->> 'status'),
  'replaced',
  'the replacement goes through');
select is(
  (current_setting('test.replaced')::jsonb ->> 'references'),
  '1',
  'and reports how many references moved');
select is(
  (current_setting('test.replaced')::jsonb ->> 'storage_path'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1/original.jpg',
  'and returns the OLD storage path so the server can remove the old files');
select is(
  (current_setting('test.replaced')::jsonb ->> 'new_id'),
  (current_setting('test.img_b')::jsonb ->> 'id'),
  'and names the successor');

select is(
  (select image_id from public.dishes where name = 'Thor'),
  (current_setting('test.img_b')::jsonb ->> 'id')::uuid,
  'the dish now references the new image — moved, never nulled (§7e item 4)');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.img_a')::jsonb ->> 'id')::uuid),
  0::bigint,
  'the old row is gone');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.img_b')::jsonb ->> 'id')::uuid),
  1::bigint,
  'the new row is untouched');
select is(
  (select updated_at::text from public.images
    where id = (current_setting('test.img_b')::jsonb ->> 'id')::uuid),
  current_setting('test.b_updated_before'),
  'including its version token — the transition writes nothing on the successor');
select is(
  (select draft from public.dishes where name = 'Thor'),
  '{"description": "pgTAP-kladde der skal overleve"}'::jsonb,
  'the dish''s pending draft is byte-identical — repointing touches one column');

-- The audit trail: one 'replace' row naming both storage paths, and no separate
-- 'delete' row — the transition is one event.
reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'replace' and entity = 'image'
      and actor_id = current_setting('test.staff_uid')::uuid
      and before ->> 'storage_path' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1/original.jpg'
      and after ->> 'storage_path' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/original.webp'),
  1::bigint,
  'the replacement is audited once, before/after naming both storage paths');
select is(
  (select count(*) from public.audit_log where action = 'delete' and entity = 'image'),
  0::bigint,
  'and writes no separate delete row — one operation, one audit event');
select pg_temp.become_staff();

-- The guard is intact afterwards: the marker was consumed inside the function.
select throws_ok(
  $$ delete from public.images
      where storage_path = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1/original.webp' $$,
  '42501', null,
  'a direct DELETE is still refused after a replacement — the marker is single-use');

-- ===========================================================================
-- 3. All four relationships move together
-- ===========================================================================

select set_config('test.img_f',
  public.create_image(
    'ffffffff-ffff-4fff-8fff-fffffffffff1/original.jpg', 'image/jpeg',
    1600, 1200, 250000, null, pg_temp.good_derivatives())::text,
  true);
select set_config('test.img_g',
  public.create_image(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1/original.jpg', 'image/jpeg',
    1600, 1200, 250000, null, pg_temp.good_derivatives())::text,
  true);

update public.dishes
   set image_id = (current_setting('test.img_f')::jsonb ->> 'id')::uuid
 where name = 'Thor';
update public.weekly_special
   set image_id = (current_setting('test.img_f')::jsonb ->> 'id')::uuid;
update public.monthly_burger
   set image_id = (current_setting('test.img_f')::jsonb ->> 'id')::uuid;
insert into public.news (title, slug, body, status, image_id)
values ('pgTAP-billedtest', 'pgtap-billedtest', '{"blocks": []}'::jsonb, 'draft',
        (current_setting('test.img_f')::jsonb ->> 'id')::uuid);

select is(
  (select public.replace_image(
     (current_setting('test.img_f')::jsonb ->> 'id')::uuid,
     (current_setting('test.img_f')::jsonb ->> 'updated_at')::timestamptz,
     (current_setting('test.img_g')::jsonb ->> 'id')::uuid) ->> 'references'),
  '4',
  'a replacement across all four relationships reports four moved references');

select is(
  (select image_id from public.dishes where name = 'Thor'),
  (current_setting('test.img_g')::jsonb ->> 'id')::uuid,
  'the dish reference moved');
select is(
  (select image_id from public.weekly_special limit 1),
  (current_setting('test.img_g')::jsonb ->> 'id')::uuid,
  'the weekly-special reference moved');
select is(
  (select image_id from public.monthly_burger limit 1),
  (current_setting('test.img_g')::jsonb ->> 'id')::uuid,
  'the monthly-burger reference moved');
select is(
  (select image_id from public.news where slug = 'pgtap-billedtest'),
  (current_setting('test.img_g')::jsonb ->> 'id')::uuid,
  'the news reference moved');

-- ===========================================================================
-- 4. Anonymous
-- ===========================================================================

reset role;
select pg_temp.become_anon();

select throws_ok(
  $$ select public.replace_image(
       '99999999-9999-4999-8999-999999999999'::uuid, now(),
       '99999999-9999-4999-8999-999999999998'::uuid) $$,
  '42501', null,
  'anon cannot call replace_image()');

-- ===========================================================================
-- 5. Owner: the same door
-- ===========================================================================

reset role;
select pg_temp.become_owner();

select set_config('test.img_h',
  public.create_image(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd9/original.png', 'image/png',
    400, 400, 9000, null,
    '{"formats": ["avif", "webp"], "widths": [{"width": 400, "height": 400}]}'::jsonb)::text,
  true);
select is(
  (current_setting('test.img_h')::jsonb ->> 'status'),
  'created',
  'owner can create the outgoing image');

select set_config('test.img_i',
  public.create_image(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9/original.png', 'image/png',
    400, 400, 9000, null,
    '{"formats": ["avif", "webp"], "widths": [{"width": 400, "height": 400}]}'::jsonb)::text,
  true);
select is(
  (current_setting('test.img_i')::jsonb ->> 'status'),
  'created',
  'owner can create the incoming image');

select is(
  (select public.replace_image(
     (current_setting('test.img_h')::jsonb ->> 'id')::uuid,
     (current_setting('test.img_h')::jsonb ->> 'updated_at')::timestamptz,
     (current_setting('test.img_i')::jsonb ->> 'id')::uuid) ->> 'status'),
  'replaced',
  'owner can replace an unreferenced image');
select is(
  (select count(*) from public.images
    where id = (current_setting('test.img_h')::jsonb ->> 'id')::uuid),
  0::bigint,
  'and the outgoing row is gone');

-- ===========================================================================
-- 6. Nothing else moved
-- ===========================================================================

reset role;

select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — image replacement touches no other content');
select is(
  pg_temp.week_state()::text,
  current_setting('test.week_before'),
  'the opening hours are byte-identical');

select * from finish();
rollback;
