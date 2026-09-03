-- Klingenberg Food — pgTAP: the draft-aware image reference model (technical plan
-- §4, §6, §7e item 4, §15 phase 10C-1; migration 20260901180000).
--
-- The subject is the revisit delete_image()'s 10A comment reserved: once an
-- editor can put an image_id inside pending draft JSON, the live foreign keys
-- stop being the whole truth. This suite proves the three pieces the migration
-- added, from real Staff, Owner and anonymous JWTs:
--
--   * `image_references` — the one definition of "referenced": four live columns
--     plus three draft keys, SECURITY INVOKER, so the count the delete refuses
--     with and the caption the library shows are the same rows;
--   * `delete_image()` — counts draft references, and a confirmed delete clears
--     exactly the image_id key out of every draft that names the image, leaving
--     every other pending field byte-identical, in the same transaction the FKs
--     null the live columns;
--   * `replace_image()` — moves draft references old→new exactly as it moves the
--     live ones, and leaves a draft naming a *different* image alone.
--
-- Every §13/§14 live-versus-draft combination from the phase brief is walked, and
-- every refused transition is fingerprinted to have written nothing.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–021.

begin;
create extension if not exists pgtap with schema extensions;

select plan(86);

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

create function pg_temp.hours_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

/* The menu apart from Thor — the designated reference fixture, as in 020. */
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
language sql as $fn$
  select updated_at from public.images where id = pg_temp.img(setting)
$fn$;

-- ===========================================================================
-- 1. Structure: the view, its grants, and the unchanged boundary
-- ===========================================================================

select ok(
  exists (select 1 from pg_views
           where schemaname = 'public' and viewname = 'image_references'),
  'image_references exists');

select ok(
  exists (select 1
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace,
            lateral pg_options_to_table(c.reloptions) o
           where n.nspname = 'public' and c.relname = 'image_references'
             and o.option_name = 'security_invoker'
             and o.option_value in ('true', 'on')),
  'image_references is SECURITY INVOKER — RLS decides every row for the caller');

select ok(
  has_table_privilege('authenticated', 'public.image_references', 'SELECT'),
  'authenticated may read image_references');

select ok(
  not has_table_privilege('anon', 'public.image_references', 'SELECT'),
  'anon may not read image_references');

select ok(
  not has_table_privilege('authenticated', 'public.image_references', 'INSERT')
  and not has_table_privilege('authenticated', 'public.image_references', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.image_references', 'DELETE'),
  'the view is read-only for authenticated');

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
                            'list_accounts', 'revoke_account_sessions')),
  0::bigint,
  'phase 10C-1 adds no SECURITY DEFINER function');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'images'),
  array['images_delete_staff', 'images_insert_staff', 'images_select_public',
        'images_select_staff', 'images_update_staff'],
  'the five phase-1 images policies still stand unchanged');

-- ===========================================================================
-- 2. The view: live and pending references, one definition
-- ===========================================================================

reset role;
select pg_temp.become_staff();

select pg_temp.make_image('test.img_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1/original.jpg');
select pg_temp.make_image('test.img_b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1/original.jpg');
select pg_temp.make_image('test.img_c', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2/original.jpg');

select is(
  (current_setting('test.img_a')::jsonb ->> 'status'), 'created',
  'fixture image A is created through the one door in');
select is(
  (current_setting('test.img_b')::jsonb ->> 'status'), 'created',
  'fixture image B likewise');
select is(
  (current_setting('test.img_c')::jsonb ->> 'status'), 'created',
  'fixture image C likewise');

select is(
  (select count(*) from public.image_references),
  0::bigint,
  'nothing references anything yet');

-- A live reference is one row, not pending.
select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_a'));

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.img_a') and kind = 'dish'
      and name = 'Thor' and not pending),
  1::bigint,
  'a live dish reference appears, named and not pending');

-- A draft reference is one row, pending — beside other pending fields.
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text,
                                  'description', 'kladdetekst der skal overleve')
 where name = 'Thor';
update public.weekly_special
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text);
update public.monthly_burger
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text,
                                  'price_ore', 9500);

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.img_b') and pending),
  3::bigint,
  'three pending draft references appear for image B');

select is(
  (select array_agg(kind order by kind) from public.image_references
    where image_id = pg_temp.img('test.img_b')),
  array['dish', 'monthly', 'weekly'],
  'one per draft-bearing entity, by kind');

-- A draft whose image_id is JSON null (a pending removal) is not a reference.
update public.weekly_special set draft = '{"image_id": null}'::jsonb;

select is(
  (select count(*) from public.image_references where kind = 'weekly'),
  0::bigint,
  'a pending removal (image_id: null) is not a reference');

-- A draft whose image_id is not shaped like a uuid contributes nothing rather
-- than blowing up the view (a fixture or migration could write anything).
update public.weekly_special set draft = '{"image_id": "ikke-en-uuid"}'::jsonb;

select lives_ok(
  $$ select count(*) from public.image_references $$,
  'a malformed draft value does not make the view throw');
select is(
  (select count(*) from public.image_references where kind = 'weekly'),
  0::bigint,
  'and contributes no reference');

update public.weekly_special
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text);

-- A news reference: the live column, pending while the article is a draft.
insert into public.news (title, slug, body, status, image_id)
values ('pgTAP-kladdenyhed', 'pgtap-kladdenyhed', '{"blocks": []}'::jsonb, 'draft',
        pg_temp.img('test.img_c'));

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.img_c') and kind = 'news'
      and name = 'pgTAP-kladdenyhed' and pending),
  1::bigint,
  'a draft article''s reference is pending — no guest can see it');

update public.news set status = 'published', published_at = now()
 where slug = 'pgtap-kladdenyhed';

select is(
  (select count(*) from public.image_references
    where image_id = pg_temp.img('test.img_c') and kind = 'news' and not pending),
  1::bigint,
  'publishing the article makes the same reference live');

-- The view answers through the caller's own RLS.
reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ select count(*) from public.image_references $$,
  '42501', null,
  'anon is refused the view outright');

-- ===========================================================================
-- 3. delete_image(): the in_use count includes drafts
-- ===========================================================================

reset role;
select pg_temp.become_staff();

-- Image B is referenced by three drafts and nothing live.
select set_config('test.del_b_unconfirmed',
  (select public.delete_image(pg_temp.img('test.img_b'),
                              pg_temp.img_version('test.img_b'), false))::text,
  true);

select is(
  (current_setting('test.del_b_unconfirmed')::jsonb ->> 'status'),
  'in_use',
  'an image referenced only by pending drafts still refuses unconfirmed (§13 B)');
select is(
  (current_setting('test.del_b_unconfirmed')::jsonb ->> 'references'),
  '3',
  'and counts all three draft references');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.img_b')),
  1::bigint,
  'the unconfirmed refusal deleted nothing');
select is(
  (select draft ->> 'description' from public.dishes where name = 'Thor'),
  'kladdetekst der skal overleve',
  'and detached nothing');

-- A stale token writes nothing either — drafts included.
select is(
  (select public.delete_image(pg_temp.img('test.img_b'),
                              '2020-01-01T00:00:00Z'::timestamptz, true) ->> 'status'),
  'conflict',
  'a stale confirmed delete is refused as conflict');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.img_b')::text),
  'and the pending reference is still there — a refused transition writes nothing');

-- ===========================================================================
-- 4. delete_image(): §13 case B — draft references only
-- ===========================================================================

select set_config('test.del_b',
  (select public.delete_image(pg_temp.img('test.img_b'),
                              pg_temp.img_version('test.img_b'), true))::text,
  true);

select is(
  (current_setting('test.del_b')::jsonb ->> 'status'),
  'deleted',
  'the confirmed delete of a draft-only image goes through');

select is(
  (select draft from public.dishes where name = 'Thor'),
  '{"description": "kladdetekst der skal overleve"}'::jsonb,
  'the dish draft lost exactly the image_id key — every other pending field is byte-identical (§16)');
select is(
  (select draft from public.weekly_special limit 1),
  null::jsonb,
  'a draft holding only the image reference becomes NULL again — not an empty object');
select is(
  (select draft from public.monthly_burger limit 1),
  '{"price_ore": 9500}'::jsonb,
  'the monthly draft kept its other pending field');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  pg_temp.img('test.img_a'),
  'the dish''s LIVE image is untouched — only the pending reference was cleared (§13 D)');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.img_b')),
  0::bigint,
  'the image row is gone');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_b')),
  0::bigint,
  'and no reference to it survives anywhere — no dangling id');

reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'delete' and entity = 'image'
      and entity_id = (select pg_temp.img('test.img_b'))
      and actor_id = current_setting('test.staff_uid')::uuid
      and (before -> 'references' ->> 'draft') = '3'
      and (before -> 'references' ->> 'live') = '0'
      and before ->> 'storage_path' is not null),
  1::bigint,
  'the deletion is audited once, recording the live and draft reference counts');
select pg_temp.become_staff();

-- ===========================================================================
-- 5. delete_image(): §13 cases C and E — live and draft together
-- ===========================================================================

-- Case C: the same image live AND in the same row's draft.
select pg_temp.make_image('test.img_d', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2/original.jpg');
select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_d'));
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_d')::text,
                                  'name', 'Thor med nyt navn')
 where name = 'Thor';

select is(
  (select public.delete_image(pg_temp.img('test.img_d'),
                              pg_temp.img_version('test.img_d'), false) ->> 'references'),
  '2',
  'the same image live + draft counts as two references (§13 C)');

select is(
  (select public.delete_image(pg_temp.img('test.img_d'),
                              pg_temp.img_version('test.img_d'), true) ->> 'status'),
  'deleted',
  'and the confirmed delete goes through');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  null::uuid,
  'the live reference was nulled by the FK');
select is(
  (select draft from public.dishes where name = 'Thor'),
  '{"name": "Thor med nyt navn"}'::jsonb,
  'and the draft lost exactly the image key — the pending rename survives');

-- Case E: live A, draft B — deleting A clears the live pointer, keeps draft B.
select pg_temp.make_image('test.img_e', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2/original.jpg');
select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_a'));
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_e')::text)
 where name = 'Thor';

select is(
  (select public.delete_image(pg_temp.img('test.img_a'),
                              pg_temp.img_version('test.img_a'), true) ->> 'status'),
  'deleted',
  'live A / draft B: deleting A goes through confirmed (§13 E)');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  null::uuid,
  'the live reference to A is cleared');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.img_e')::text),
  'and the draft''s selection of B remains B — unrelated pending work is not destroyed');

-- Case A restated (live only): covered exhaustively by 020; one probe here that
-- the behaviour still stands after the 10C-1 replacement of the function.
select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_e'));
update public.dishes set draft = null where name = 'Thor';

select is(
  (select public.delete_image(pg_temp.img('test.img_e'),
                              pg_temp.img_version('test.img_e'), true) ->> 'status'),
  'deleted',
  'a live-only confirmed delete still behaves as 020 pinned it (§13 A)');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  null::uuid,
  'and nulls the live reference through the FK');

-- ===========================================================================
-- 6. replace_image(): §14 — every live/draft combination
-- ===========================================================================

select pg_temp.make_image('test.rep_old', '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaa3/original.jpg');
select pg_temp.make_image('test.rep_new', '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbb3/original.jpg');
select pg_temp.make_image('test.rep_other', '33333333-cccc-4ccc-8ccc-ccccccccccc3/original.jpg');

-- §14 "draft only": the pending selection moves old→new.
select pg_temp.fixture_live_image('dish', null);
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_old')::text,
                                  'description', 'kladde ved erstatning')
 where name = 'Thor';

select set_config('test.rep1',
  (select public.replace_image(pg_temp.img('test.rep_old'),
                               pg_temp.img_version('test.rep_old'),
                               pg_temp.img('test.rep_new')))::text,
  true);

select is(
  (current_setting('test.rep1')::jsonb ->> 'status'),
  'replaced',
  'replacing an image referenced only by a draft goes through');
select is(
  (current_setting('test.rep1')::jsonb ->> 'references'),
  '1',
  'and reports the moved draft reference');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.rep_new')::text),
  'the pending selection now names the successor — no stale id in draft JSON');
select is(
  (select draft ->> 'description' from public.dishes where name = 'Thor'),
  'kladde ved erstatning',
  'and the draft''s other pending field is untouched (§16)');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.rep_old')),
  0::bigint,
  'the old row is gone');

-- §14 "live same old": live A + draft A, replace A→B moves both.
select pg_temp.make_image('test.rep_old2', '44444444-dddd-4ddd-8ddd-ddddddddddd3/original.jpg');
select pg_temp.fixture_live_image('dish', pg_temp.img('test.rep_old2'));
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_old2')::text)
 where name = 'Thor';

select set_config('test.rep2',
  (select public.replace_image(pg_temp.img('test.rep_old2'),
                               pg_temp.img_version('test.rep_old2'),
                               pg_temp.img('test.rep_other')))::text,
  true);

select is(
  (current_setting('test.rep2')::jsonb ->> 'references'),
  '2',
  'live A + draft A: both references count as moved');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  pg_temp.img('test.rep_other'),
  'the live column moved to the successor');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.rep_other')::text),
  'and so did the pending selection');

-- §14 "live old + draft different": live A, draft C, replace A→B.
select pg_temp.make_image('test.rep_a3', '55555555-eeee-4eee-8eee-eeeeeeeeeee3/original.jpg');
select pg_temp.make_image('test.rep_b3', '66666666-ffff-4fff-8fff-fffffffffff3/original.jpg')
;
select pg_temp.fixture_live_image('dish', pg_temp.img('test.rep_a3'));
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_other')::text)
 where name = 'Thor';

select is(
  (select public.replace_image(pg_temp.img('test.rep_a3'),
                               pg_temp.img_version('test.rep_a3'),
                               pg_temp.img('test.rep_b3')) ->> 'references'),
  '1',
  'live A / draft C, replace A→B: exactly one reference moves');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  pg_temp.img('test.rep_b3'),
  'the live column moved to B');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.rep_other')::text),
  'and the draft''s different selection C stayed C');

-- §14 "live different + draft old": live C, draft A, replace A→B.
select pg_temp.make_image('test.rep_a4', '77777777-aaaa-4aaa-8aaa-aaaaaaaaaaa4/original.jpg');
select pg_temp.make_image('test.rep_b4', '88888888-bbbb-4bbb-8bbb-bbbbbbbbbbb4/original.jpg');
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_a4')::text)
 where name = 'Thor';

select is(
  (select public.replace_image(pg_temp.img('test.rep_a4'),
                               pg_temp.img_version('test.rep_a4'),
                               pg_temp.img('test.rep_b4')) ->> 'references'),
  '1',
  'live C / draft A, replace A→B: exactly one reference moves');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  pg_temp.img('test.rep_b3'),
  'the live column''s different image C stayed C');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.rep_b4')::text),
  'and the pending selection moved to B');

-- A stale replace with a draft reference in play writes nothing at all.
select pg_temp.make_image('test.rep_b5', '99999999-cccc-4ccc-8ccc-ccccccccccc4/original.jpg');
select is(
  (select public.replace_image(pg_temp.img('test.rep_b4'),
                               '2020-01-01T00:00:00Z'::timestamptz,
                               pg_temp.img('test.rep_b5')) ->> 'status'),
  'conflict',
  'a stale replacement is refused as conflict');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.rep_b4')::text),
  'and moved no draft reference');

-- The weekly and monthly drafts move through the same transition.
update public.weekly_special
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_b4')::text,
                                  'name', 'Stegt flæsk');
update public.monthly_burger
   set draft = jsonb_build_object('image_id', pg_temp.img('test.rep_b4')::text);
select pg_temp.fixture_live_image('dish', null);
update public.dishes set draft = null where name = 'Thor';

select is(
  (select public.replace_image(pg_temp.img('test.rep_b4'),
                               pg_temp.img_version('test.rep_b4'),
                               pg_temp.img('test.rep_b5')) ->> 'references'),
  '2',
  'weekly and monthly draft references move together in one transition');
select is(
  (select draft from public.weekly_special limit 1),
  jsonb_build_object('image_id', pg_temp.img('test.rep_b5')::text,
                     'name', 'Stegt flæsk'),
  'the weekly draft moved its selection and kept its other pending field');
select is(
  (select draft -> 'image_id' from public.monthly_burger limit 1),
  to_jsonb(pg_temp.img('test.rep_b5')::text),
  'the monthly draft moved its selection');

-- ===========================================================================
-- 7. The trusted transitions still hold their guard
-- ===========================================================================

select throws_ok(
  $$ delete from public.images $$,
  '42501', null,
  'a direct DELETE is still refused — the marker is single-use and consumed');

-- The §28 measurement, re-taken after 20260901200000: a staff JWT can NOT move a
-- live image_id column directly any more — the reference guard refuses it, and
-- 023 walks the whole property from every JWT. Here it is enough that the door
-- is shut, that the FK is still the final gate on the trusted path, and that
-- anon can move nothing at all.
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.rep_b5') where name = 'Thor' $$,
  '42501', null,
  'measured: a staff JWT is refused a direct write of live image_id (20260901200000)');
select is(
  (select image_id from public.dishes where name = 'Thor'),
  null::uuid,
  'and the column did not move');

-- A draft naming an image that does not exist is refused by the constraint at
-- publish, so no dangling live id arrives through the door either.
update public.dishes
   set draft = '{"image_id": "99999999-9999-4999-8999-999999999997"}'::jsonb
 where name = 'Thor';
create function pg_temp.publish_thor_nowhere() returns void
language sql as $fn$
  select public.publish_dish((select id from public.dishes where name = 'Thor'),
                             (select updated_at from public.dishes where name = 'Thor'))
$fn$;
select throws_ok(
  'select pg_temp.publish_thor_nowhere()',
  '23503', null,
  'the FK refuses an image that does not exist at publish — no dangling live id through the door');
update public.dishes set draft = null where name = 'Thor';

reset role;
select pg_temp.become_anon();

select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'anon cannot touch a live image_id at all');
select throws_ok(
  $$ select public.delete_image('99999999-9999-4999-8999-999999999999'::uuid, now(), true) $$,
  '42501', null,
  'anon cannot call delete_image()');

-- ===========================================================================
-- 8. Owner walks the same doors
-- ===========================================================================

reset role;
select pg_temp.become_owner();

select pg_temp.make_image('test.own_a', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa5/original.jpg');
select pg_temp.make_image('test.own_b', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb5/original.jpg');

update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.own_a')::text)
 where name = 'Thor';

select is(
  (select public.replace_image(pg_temp.img('test.own_a'),
                               pg_temp.img_version('test.own_a'),
                               pg_temp.img('test.own_b')) ->> 'status'),
  'replaced',
  'owner can replace a draft-referenced image');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.own_b')::text),
  'and the draft moved for owner exactly as for staff');

select is(
  (select public.delete_image(pg_temp.img('test.own_b'),
                              pg_temp.img_version('test.own_b'), true) ->> 'status'),
  'deleted',
  'owner can delete it confirmed');
select is(
  (select draft from public.dishes where name = 'Thor'),
  null::jsonb,
  'and the draft reference was detached, reducing the draft to NULL');

-- ===========================================================================
-- 9. Cleanup of this suite's rows, then: nothing else moved
-- ===========================================================================

reset role;
select pg_temp.become_staff();

select is(
  (select public.delete_image(pg_temp.img('test.img_c'),
                              pg_temp.img_version('test.img_c'), true) ->> 'status'),
  'deleted',
  'the news fixture''s image deletes confirmed');
select is(
  (select image_id from public.news where slug = 'pgtap-kladdenyhed'),
  null::uuid,
  'and the article''s reference was nulled by the FK');

select is(
  (select public.delete_image(pg_temp.img('test.rep_other'),
                              pg_temp.img_version('test.rep_other'), true) ->> 'status'),
  'deleted',
  'the remaining C fixture deletes');
select is(
  (select public.delete_image(pg_temp.img('test.rep_b5'),
                              pg_temp.img_version('test.rep_b5'), true) ->> 'status'),
  'deleted',
  'the remaining B fixture deletes');
select is(
  (select public.delete_image(pg_temp.img('test.rep_new'),
                              pg_temp.img_version('test.rep_new'), true) ->> 'status'),
  'deleted',
  'the first successor deletes');

select is(
  (select count(*) from public.image_references),
  0::bigint,
  'no reference of any kind survives the suite — live or pending');

select is(
  (select draft from public.weekly_special limit 1),
  '{"name": "Stegt flæsk"}'::jsonb,
  'the weekly draft kept its other pending field through the final detach');
select is(
  (select draft from public.monthly_burger limit 1),
  null::jsonb,
  'the monthly draft — image reference only — ended NULL');

reset role;

select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — the reference model touches no other content');
select is(
  pg_temp.hours_state()::text,
  current_setting('test.hours_before'),
  'the opening hours are byte-identical');
select is(
  pg_temp.menu_state(),
  current_setting('test.menu_before'),
  'every dish except the Thor fixture is byte-identical');

select * from finish();
rollback;
