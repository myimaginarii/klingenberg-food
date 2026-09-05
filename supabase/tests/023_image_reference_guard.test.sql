-- Klingenberg Food — pgTAP: the published image reference is moved only by its
-- transitions (technical plan §5, §6, §7e item 4, §8, §15 phase 10C-1 hardening;
-- migration 20260901200000).
--
-- The subject is the one 10C-1 finding that was not accepted: a Staff or Owner
-- JWT held direct UPDATE on `dishes.image_id`, `weekly_special.image_id` and
-- `monthly_burger.image_id`, so a PostgREST write could skip Kladde → Forhåndsvis
-- → Offentliggør and change the guest's photo at once, with no version check, no
-- audit row and no cache expiry. This suite proves, from real Staff, Owner and
-- anonymous JWTs, that the door is shut and that every legitimate way through it
-- still works exactly as before:
--
--   1. structure — the guard and consumer triggers, the unchanged grants and
--      policies, SECURITY INVOKER everywhere, no guard on news;
--   2. the direct bypass is refused for Staff, for Owner and for anon — on all
--      three tables, for a change, for a clearing, and for an INSERT that arrives
--      with a photo — while every unrelated column and the draft stay writable;
--   3. publish — live A + draft B → B, live A + draft null → null, live null +
--      draft B → B, on each of the three entities, with unrelated columns
--      byte-identical and the audit row written; a stale publish writes nothing;
--   4. replace_image() — a multi-row replacement (two dishes, the two singletons,
--      a news article and a pending draft, in one transition) stays atomic, a
--      draft naming a different image is untouched, and the audit is one row;
--   5. delete_image() — a confirmed delete detaches every live and pending
--      reference and leaves no dangling id; unconfirmed and stale deletes write
--      nothing; a stale sold-out date on a referencing dish breaks neither;
--   6. marker hygiene — no transition, successful, refused or raised mid-way,
--      leaves a marker behind; a marker authorises exactly one statement, rows
--      moved or not; each transition word admits only its own shape of movement;
--      the images marker and the reference marker do not stand in for each other;
--      and the referential action's privilege context is measured, not assumed.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–022.

begin;
create extension if not exists pgtap with schema extensions;

select plan(142);

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
 * way seed.sql would, which is the one way left for a test to put a live
 * reference in place without walking a whole publish. SECURITY DEFINER here is
 * the test's own privilege, never the application's; the guard steps aside for
 * the owner exactly as it does for a migration.
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

/*
 * A stale sold-out date — the state §7b leaves behind when days pass after a dish
 * was marked Udsolgt. It cannot be *written*: the sold-out guard validates every
 * changed value against today's Copenhagen date, for every role, so the only
 * honest way to a five-day-old date is five days, which a test does not have.
 * The fixture therefore steps around that one trigger for one statement, as the
 * table owner, inside a transaction that rolls back.
 */
create function pg_temp.fixture_sold_out(p_name text, p_date date) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  alter table public.dishes disable trigger dishes_sold_out_guard;
  update public.dishes set sold_out_on = p_date where name = p_name;
  alter table public.dishes enable trigger dishes_sold_out_guard;
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

/* One row's content apart from the columns a transition is allowed to move. */
create function pg_temp.dish_state(p_name text) returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(d) - 'image_id' - 'draft' - 'updated_at' - 'updated_by'
    from public.dishes d where d.name = p_name
$fn$;

create function pg_temp.weekly_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(w) - 'image_id' - 'draft' - 'updated_at' - 'updated_by' - 'name'
    from public.weekly_special w limit 1
$fn$;

create function pg_temp.monthly_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(m) - 'image_id' - 'draft' - 'updated_at' - 'updated_by' - 'price_ore'
    from public.monthly_burger m limit 1
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

/* The three entities' identity and version, read through the caller's own RLS. */
create function pg_temp.dish_id(p_name text) returns uuid language sql as $fn$
  select id from public.dishes where name = p_name
$fn$;
create function pg_temp.dish_version(p_name text) returns timestamptz language sql as $fn$
  select updated_at from public.dishes where name = p_name
$fn$;
create function pg_temp.dish_image(p_name text) returns uuid language sql as $fn$
  select image_id from public.dishes where name = p_name
$fn$;
create function pg_temp.weekly_id() returns uuid language sql as $fn$
  select id from public.weekly_special limit 1
$fn$;
create function pg_temp.weekly_version() returns timestamptz language sql as $fn$
  select updated_at from public.weekly_special limit 1
$fn$;
create function pg_temp.weekly_image() returns uuid language sql as $fn$
  select image_id from public.weekly_special limit 1
$fn$;
create function pg_temp.monthly_id() returns uuid language sql as $fn$
  select id from public.monthly_burger limit 1
$fn$;
create function pg_temp.monthly_version() returns timestamptz language sql as $fn$
  select updated_at from public.monthly_burger limit 1
$fn$;
create function pg_temp.monthly_image() returns uuid language sql as $fn$
  select image_id from public.monthly_burger limit 1
$fn$;

-- ===========================================================================
-- 1. Structure: the guard, the consumer, and everything that did not change
-- ===========================================================================

select is(
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public'
      and trigger_name in ('dishes_guard_image_reference',
                           'weekly_special_guard_image_reference',
                           'monthly_burger_guard_image_reference')
      and action_timing = 'BEFORE' and action_orientation = 'ROW'
      and event_manipulation in ('INSERT', 'UPDATE')),
  6::bigint,
  'the reference guard fires BEFORE INSERT and BEFORE UPDATE, per row, on the three draft entities');

select is(
  (select count(*)
     from pg_trigger t
     join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
    where t.tgname like '%\_guard\_image\_reference' and a.attname = 'image_id'),
  3::bigint,
  'and each UPDATE guard is declared OF image_id — a write of any other column never reaches it');

select is(
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public'
      and trigger_name in ('dishes_consume_image_reference',
                           'weekly_special_consume_image_reference',
                           'monthly_burger_consume_image_reference')
      and action_timing = 'AFTER' and action_orientation = 'STATEMENT'
      and event_manipulation in ('INSERT', 'UPDATE')),
  6::bigint,
  'the consumer fires AFTER each INSERT or UPDATE statement on the same three tables');

select is(
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public' and event_object_table = 'news'
      and trigger_name like '%image_reference%'),
  0::bigint,
  'news carries no reference guard — its direct-edit model stands as phase 9 locked it');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_dish', 'publish_weekly_special', 'publish_monthly_burger',
                        'delete_image', 'replace_image',
                        'tg_guard_image_reference_write', 'tg_consume_image_reference_write')
      and not p.prosecdef and p.proconfig = array['search_path=""']),
  7::bigint,
  'the five transitions and the two trigger functions are SECURITY INVOKER with search_path pinned');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname not in ('is_staff', 'is_owner', 'log_audit', 'editor_name',
                            'enforce_owner_invariant',
                            'list_accounts', 'revoke_account_sessions',
                            -- phase 13B: the rate limiter's doors (§0ai, pgTAP 029)
                            'rate_limit_resolve', 'consume_rate_limit', 'peek_rate_limit')),
  0::bigint,
  'the hardening adds no SECURITY DEFINER function');

select ok(
  not has_function_privilege('authenticated', 'public.tg_guard_image_reference_write()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.tg_guard_image_reference_write()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.tg_consume_image_reference_write()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.tg_consume_image_reference_write()', 'EXECUTE'),
  'neither trigger function is executable by a browser role');

select ok(
  has_table_privilege('authenticated', 'public.dishes', 'UPDATE')
  and has_table_privilege('authenticated', 'public.weekly_special', 'UPDATE')
  and has_table_privilege('authenticated', 'public.monthly_burger', 'UPDATE')
  and has_column_privilege('authenticated', 'public.dishes', 'image_id', 'UPDATE'),
  'the phase-1 table grants stand — the transition is constrained, not the privilege (§5)');

select ok(
  not has_table_privilege('anon', 'public.dishes', 'UPDATE')
  and not has_table_privilege('anon', 'public.weekly_special', 'UPDATE')
  and not has_table_privilege('anon', 'public.monthly_burger', 'UPDATE'),
  'anon still holds no UPDATE at all');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'dishes'),
  array['dishes_delete_staff', 'dishes_insert_staff', 'dishes_select_public',
        'dishes_select_staff', 'dishes_update_staff'],
  'the dishes policies are unchanged');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'weekly_special'),
  array['weekly_special_select_public', 'weekly_special_select_staff',
        'weekly_special_update_staff'],
  'the weekly_special policies are unchanged');

select is(
  (select array_agg(policyname::text order by policyname)
     from pg_policies where schemaname = 'public' and tablename = 'monthly_burger'),
  array['monthly_burger_select_public', 'monthly_burger_select_staff',
        'monthly_burger_update_staff'],
  'the monthly_burger policies are unchanged');

-- ===========================================================================
-- 2. The direct bypass is refused — Staff
-- ===========================================================================

reset role;
select pg_temp.become_staff();

select pg_temp.make_image('test.img_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaad1/original.jpg');
select pg_temp.make_image('test.img_b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbd1/original.jpg');
select pg_temp.make_image('test.img_c', 'cccccccc-cccc-4ccc-8ccc-ccccccccccd1/original.jpg');

select is(
  (current_setting('test.img_a')::jsonb ->> 'status'), 'created',
  'fixture image A is created through the one door in');
select is(
  (current_setting('test.img_b')::jsonb ->> 'status'), 'created',
  'fixture image B likewise');
select is(
  (current_setting('test.img_c')::jsonb ->> 'status'), 'created',
  'fixture image C likewise');

select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_a'));
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_a'),
  'Thor publishes image A (set as the table owner — the fixture door)');

select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  'Staff: a direct change of a published dish image is refused');
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'Staff: a direct clearing of a published dish image is refused — a removal is a publish too');
select throws_ok(
  $$ update public.weekly_special set image_id = pg_temp.img('test.img_b') $$,
  '42501', null,
  'Staff: a direct write of the weekly special''s published image is refused');
select throws_ok(
  $$ update public.monthly_burger set image_id = pg_temp.img('test.img_b') $$,
  '42501', null,
  'Staff: a direct write of the monthly burger''s published image is refused');
select throws_ok(
  $$ insert into public.dishes (category_id, name, image_id)
     values ((select id from public.menu_categories order by sort_order limit 1),
             'pgTAP-guardret', pg_temp.img('test.img_b')) $$,
  '42501', null,
  'Staff: a dish cannot be created with a published image — a new dish is a draft');

select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_a'),
  'and Thor''s published image did not move');
select is(
  (select image_id from public.weekly_special limit 1), null::uuid,
  'nor did the weekly special''s');
select is(
  (select image_id from public.monthly_burger limit 1), null::uuid,
  'nor did the monthly burger''s');

-- The guard looks at image_id and nothing else: every other column, the draft
-- and a same-value echo of the column stay ordinary writes.
select lives_ok(
  $$ update public.dishes set description = 'Beskrivelse ændret direkte' where name = 'Thor' $$,
  'an unrelated column is still directly writable — the guard is one column wide');
select lives_ok(
  $$ update public.dishes set image_id = image_id, secondary_note = 'ekko' where name = 'Thor' $$,
  'a payload that names image_id with its current value is not a write of it');
select lives_ok(
  $$ update public.dishes
        set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text)
      where name = 'Thor' $$,
  'the draft is still the editor''s to write — a pending selection is an ordinary draft change');
select lives_ok(
  $$ update public.weekly_special
        set draft = jsonb_build_object('image_id', pg_temp.img('test.img_a')::text,
                                       'name', 'Stegt flæsk') $$,
  'and so is the weekly special''s draft');
select lives_ok(
  $$ update public.monthly_burger
        set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text,
                                       'price_ore', 9500) $$,
  'and the monthly burger''s');
select lives_ok(
  $$ insert into public.dishes (category_id, name)
     values ((select id from public.menu_categories order by sort_order limit 1),
             'pgTAP-guardret') $$,
  'a dish is still created without a photo, exactly as lib/publishing/create.ts does');
delete from public.dishes where name = 'pgTAP-guardret';

-- ===========================================================================
-- 3. The direct bypass is refused — Owner
-- ===========================================================================

reset role;
select pg_temp.become_owner();

select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  'Owner: a direct change of a published dish image is refused — authority to publish is not authority to bypass');
select throws_ok(
  $$ update public.weekly_special set image_id = pg_temp.img('test.img_b') $$,
  '42501', null,
  'Owner: the weekly special likewise');
select throws_ok(
  $$ update public.monthly_burger set image_id = pg_temp.img('test.img_b') $$,
  '42501', null,
  'Owner: the monthly burger likewise');
select throws_ok(
  $$ insert into public.dishes (category_id, name, image_id)
     values ((select id from public.menu_categories order by sort_order limit 1),
             'pgTAP-guardret', pg_temp.img('test.img_b')) $$,
  '42501', null,
  'Owner: nor can a dish be created with a published image');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_a'),
  'and nothing moved');

-- ===========================================================================
-- 4. anon reaches none of it, as before
-- ===========================================================================

reset role;
select pg_temp.become_anon();

select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null, 'anon cannot write a dish image');
select throws_ok(
  $$ update public.weekly_special set image_id = null $$,
  '42501', null, 'anon cannot write the weekly special''s');
select throws_ok(
  $$ update public.monthly_burger set image_id = null $$,
  '42501', null, 'anon cannot write the monthly burger''s');

-- ===========================================================================
-- 5. Publish still moves it — every live/draft combination, every entity
-- ===========================================================================

reset role;
select pg_temp.become_staff();

-- --- dish: live A + draft B → B ---------------------------------------------------
select set_config('test.thor_state', pg_temp.dish_state('Thor')::text, true);

select is(
  (select public.publish_dish(pg_temp.dish_id('Thor'), pg_temp.dish_version('Thor')) ->> 'status'),
  'published',
  'dish: live A + draft B publishes');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_b'),
  'and the published image is now B');
select is(
  (select draft from public.dishes where name = 'Thor'), null::jsonb,
  'the draft is cleared');
select is(
  pg_temp.dish_state('Thor')::text, current_setting('test.thor_state'),
  'every other column of the dish is byte-identical');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_c') where name = 'Thor' $$,
  '42501', null,
  'and the publish left no marker behind — the very next direct write is refused');

-- --- dish: live B + draft null → null ---------------------------------------------
update public.dishes set draft = '{"image_id": null}'::jsonb where name = 'Thor';
select is(
  (select public.publish_dish(pg_temp.dish_id('Thor'), pg_temp.dish_version('Thor')) ->> 'status'),
  'published',
  'dish: live B + draft null (a pending removal) publishes');
select is(
  pg_temp.dish_image('Thor'), null::uuid,
  'and the published image is cleared');

-- --- dish: live null + draft C → C ------------------------------------------------
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_c')::text)
 where name = 'Thor';
select is(
  (select public.publish_dish(pg_temp.dish_id('Thor'), pg_temp.dish_version('Thor')) ->> 'status'),
  'published',
  'dish: live null + draft C publishes');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_c'),
  'and the published image is now C');

reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'publish' and entity = 'dish' and entity_id = pg_temp.dish_id('Thor')
      and actor_id = current_setting('test.staff_uid')::uuid),
  3::bigint,
  'each dish publish wrote its audit row');
select is(
  (select count(*) from public.audit_log
    where action = 'publish' and entity = 'dish' and entity_id = pg_temp.dish_id('Thor')
      and before ->> 'image_id' = pg_temp.img('test.img_a')::text
      and after  ->> 'image_id' = pg_temp.img('test.img_b')::text),
  1::bigint,
  'and the first one records A → B');
select pg_temp.become_staff();

-- --- weekly: live null + draft A → A (with another pending field) -----------------
select set_config('test.weekly_state', pg_temp.weekly_state()::text, true);
select is(
  (select public.publish_weekly_special(pg_temp.weekly_id(), pg_temp.weekly_version()) ->> 'status'),
  'published',
  'weekly: live null + draft A publishes');
select is(
  pg_temp.weekly_image(), pg_temp.img('test.img_a'),
  'and the published image is now A');
select is(
  (select name from public.weekly_special limit 1), 'Stegt flæsk',
  'the other pending field moved with it, as phase 4 defined');
select is(
  pg_temp.weekly_state()::text, current_setting('test.weekly_state'),
  'every other column of the weekly special is byte-identical');
select throws_ok(
  $$ update public.weekly_special set image_id = null $$,
  '42501', null,
  'and the weekly publish left no marker behind');

-- --- weekly: live A + draft B → B -------------------------------------------------
update public.weekly_special
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_b')::text);
select is(
  (select public.publish_weekly_special(pg_temp.weekly_id(), pg_temp.weekly_version()) ->> 'status'),
  'published',
  'weekly: live A + draft B publishes');
select is(
  pg_temp.weekly_image(), pg_temp.img('test.img_b'),
  'and the published image is now B');

-- --- weekly: live B + draft null → null -------------------------------------------
update public.weekly_special set draft = '{"image_id": null}'::jsonb;
select is(
  (select public.publish_weekly_special(pg_temp.weekly_id(), pg_temp.weekly_version()) ->> 'status'),
  'published',
  'weekly: live B + draft null publishes');
select is(
  pg_temp.weekly_image(), null::uuid,
  'and the published image is cleared');

-- --- monthly: live null + draft B → B (with another pending field) ----------------
select set_config('test.monthly_state', pg_temp.monthly_state()::text, true);
select is(
  (select public.publish_monthly_burger(pg_temp.monthly_id(), pg_temp.monthly_version()) ->> 'status'),
  'published',
  'monthly: live null + draft B publishes');
select is(
  pg_temp.monthly_image(), pg_temp.img('test.img_b'),
  'and the published image is now B');
select is(
  (select price_ore from public.monthly_burger limit 1), 9500,
  'the other pending field moved with it');
select is(
  pg_temp.monthly_state()::text, current_setting('test.monthly_state'),
  'every other column of the monthly burger is byte-identical');
select throws_ok(
  $$ update public.monthly_burger set image_id = null $$,
  '42501', null,
  'and the monthly publish left no marker behind');

-- --- monthly: live B + draft A → A -------------------------------------------------
update public.monthly_burger
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_a')::text);
select is(
  (select public.publish_monthly_burger(pg_temp.monthly_id(), pg_temp.monthly_version()) ->> 'status'),
  'published',
  'monthly: live B + draft A publishes');
select is(
  pg_temp.monthly_image(), pg_temp.img('test.img_a'),
  'and the published image is now A');

-- --- monthly: live A + draft null → null ------------------------------------------
update public.monthly_burger set draft = '{"image_id": null}'::jsonb;
select is(
  (select public.publish_monthly_burger(pg_temp.monthly_id(), pg_temp.monthly_version()) ->> 'status'),
  'published',
  'monthly: live A + draft null publishes');
select is(
  pg_temp.monthly_image(), null::uuid,
  'and the published image is cleared');

reset role;
select is(
  (select count(*) from public.audit_log where action = 'publish'
      and entity in ('weekly_special', 'monthly_burger')),
  6::bigint,
  'each singleton publish wrote its audit row');
select pg_temp.become_staff();

-- --- a stale publish writes nothing and leaves nothing --------------------------
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_a')::text)
 where name = 'Thor';
select is(
  (select public.publish_dish(pg_temp.dish_id('Thor'), '2020-01-01T00:00:00Z'::timestamptz) ->> 'status'),
  'conflict',
  'a publish with a stale version token is refused as conflict');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_c'),
  'the published image did not move');
select is(
  (select draft -> 'image_id' from public.dishes where name = 'Thor'),
  to_jsonb(pg_temp.img('test.img_a')::text),
  'and the pending selection is still pending');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_a') where name = 'Thor' $$,
  '42501', null,
  'and a conflict is not an opening — the next direct write is refused');

-- --- Owner walks the same door -----------------------------------------------------
reset role;
select pg_temp.become_owner();
select is(
  (select public.publish_dish(pg_temp.dish_id('Thor'), pg_temp.dish_version('Thor')) ->> 'status'),
  'published',
  'Owner publishes the pending selection through the same transition');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_a'),
  'and the published image is now A');

-- ===========================================================================
-- 6. replace_image(): a multi-row transition stays atomic
-- ===========================================================================
--
-- Image A is referenced live by two dishes (Thor, Odin — one statement, two
-- rows) and by both singletons, by a draft news article (a live column, but
-- pending in the view: no guest can see a draft article), and pending by Thor's
-- draft. The weekly draft names a different image, C, and must not move. Odin also
-- carries a stale sold-out date, written days ago the way §7b writes it: the
-- image transition must not re-validate a column it does not touch.

reset role;
select pg_temp.become_staff();

select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_a'), 'Odin');
select pg_temp.fixture_live_image('weekly', pg_temp.img('test.img_a'));
select pg_temp.fixture_live_image('monthly', pg_temp.img('test.img_a'));
select pg_temp.fixture_sold_out('Odin', (now() at time zone 'Europe/Copenhagen')::date - 5);
insert into public.news (title, slug, body, status, image_id)
values ('pgTAP-guardnyhed', 'pgtap-guardnyhed', '{"blocks": []}'::jsonb, 'draft',
        pg_temp.img('test.img_a'));
update public.dishes
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_a')::text,
                                  'description', 'kladde der skal overleve')
 where name = 'Thor';
update public.weekly_special
   set draft = jsonb_build_object('image_id', pg_temp.img('test.img_c')::text);

select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_a')),
  6::bigint,
  'fixture: image A has six references — four live, plus Thor''s draft and the draft article as pending');
select is(
  (select sold_out_on from public.dishes where name = 'Odin'),
  (now() at time zone 'Europe/Copenhagen')::date - 5,
  'fixture: Odin was marked sold out five days ago');

select pg_temp.make_image('test.img_d', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1/original.jpg');

-- A stale replacement writes nothing at all.
select is(
  (select public.replace_image(pg_temp.img('test.img_a'), '2020-01-01T00:00:00Z'::timestamptz,
                               pg_temp.img('test.img_d')) ->> 'status'),
  'conflict',
  'a stale replacement is refused as conflict');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_a')),
  6::bigint,
  'and moved nothing');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_d') where name = 'Odin' $$,
  '42501', null,
  'and left no marker behind');

select set_config('test.rep',
  (select public.replace_image(pg_temp.img('test.img_a'), pg_temp.img_version('test.img_a'),
                               pg_temp.img('test.img_d')))::text,
  true);

select is(
  (current_setting('test.rep')::jsonb ->> 'status'), 'replaced',
  'replacing A with D goes through');
select is(
  (current_setting('test.rep')::jsonb ->> 'references'), '6',
  'and reports all six moved references');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_d'),
  'Thor''s published image moved to D');
select is(
  pg_temp.dish_image('Odin'), pg_temp.img('test.img_d'),
  'and Odin''s — two rows in one statement, under one marker');
select is(
  pg_temp.weekly_image(), pg_temp.img('test.img_d'),
  'the weekly special''s moved to D');
select is(
  pg_temp.monthly_image(), pg_temp.img('test.img_d'),
  'the monthly burger''s moved to D');
select is(
  (select image_id from public.news where slug = 'pgtap-guardnyhed'), pg_temp.img('test.img_d'),
  'the news article''s moved to D — unguarded, unchanged behaviour');
select is(
  (select draft from public.dishes where name = 'Thor'),
  jsonb_build_object('image_id', pg_temp.img('test.img_d')::text,
                     'description', 'kladde der skal overleve'),
  'Thor''s pending selection moved to D and its other pending field survived');
select is(
  (select draft -> 'image_id' from public.weekly_special limit 1),
  to_jsonb(pg_temp.img('test.img_c')::text),
  'the weekly draft''s different selection C stayed C');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.img_a')), 0::bigint,
  'the old row is gone');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_a')),
  0::bigint,
  'and no reference to A survives anywhere — no dangling id');
select is(
  (select sold_out_on from public.dishes where name = 'Odin'),
  (now() at time zone 'Europe/Copenhagen')::date - 5,
  'Odin''s stale sold-out date is untouched — the image transition validated nothing it did not write');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_c') where name = 'Odin' $$,
  '42501', null,
  'the replacement left no marker behind — the next direct write is refused');

reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'replace' and entity = 'image'
      and entity_id = pg_temp.img('test.img_a')
      and actor_id = current_setting('test.staff_uid')::uuid
      and before ->> 'storage_path' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaad1/original.jpg'
      and after  ->> 'storage_path' = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1/original.jpg'),
  1::bigint,
  'the replacement is one audit row naming both storage paths');
select is(
  (select count(*) from public.audit_log where entity = 'image'),
  5::bigint,
  'and no other image audit row appeared beside the four uploads');
select pg_temp.become_staff();

-- ===========================================================================
-- 7. delete_image(): a confirmed delete detaches every reference
-- ===========================================================================
--
-- The state is the one the replacement left: D is referenced live by Thor, Odin
-- and both singletons, by the draft article (pending in the view), and pending
-- by Thor's draft; the weekly draft still names C.

select set_config('test.del_unconfirmed',
  (select public.delete_image(pg_temp.img('test.img_d'), pg_temp.img_version('test.img_d'), false))::text,
  true);
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'status'), 'in_use',
  'an unconfirmed delete of a referenced image refuses with in_use');
select is(
  (current_setting('test.del_unconfirmed')::jsonb ->> 'references'), '6',
  'naming all six references, live and pending alike');
select is(
  pg_temp.dish_image('Thor'), pg_temp.img('test.img_d'),
  'and detached nothing');
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'and left no marker behind');

select is(
  (select public.delete_image(pg_temp.img('test.img_d'), '2020-01-01T00:00:00Z'::timestamptz, true) ->> 'status'),
  'conflict',
  'a stale confirmed delete is refused as conflict');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_d')),
  6::bigint,
  'and detached nothing either');

select set_config('test.del',
  (select public.delete_image(pg_temp.img('test.img_d'), pg_temp.img_version('test.img_d'), true))::text,
  true);
select is(
  (current_setting('test.del')::jsonb ->> 'status'), 'deleted',
  'the confirmed delete goes through');
select is(
  (current_setting('test.del')::jsonb ->> 'storage_path'),
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1/original.jpg',
  'and returns the storage path for the trusted file cleanup');
select is(
  pg_temp.dish_image('Thor'), null::uuid,
  'Thor''s published image is detached');
select is(
  pg_temp.dish_image('Odin'), null::uuid,
  'and Odin''s — two rows in one detach statement');
select is(
  pg_temp.weekly_image(), null::uuid,
  'the weekly special''s is detached');
select is(
  pg_temp.monthly_image(), null::uuid,
  'the monthly burger''s is detached');
select is(
  (select image_id from public.news where slug = 'pgtap-guardnyhed'), null::uuid,
  'the news article''s is nulled by its FK, exactly as before');
select is(
  (select draft from public.dishes where name = 'Thor'),
  '{"description": "kladde der skal overleve"}'::jsonb,
  'Thor''s draft lost exactly the image key — the other pending field is byte-identical');
select is(
  (select draft -> 'image_id' from public.weekly_special limit 1),
  to_jsonb(pg_temp.img('test.img_c')::text),
  'the weekly draft''s selection of C is untouched');
select is(
  (select count(*) from public.images where id = pg_temp.img('test.img_d')), 0::bigint,
  'the image row is gone');
select is(
  (select count(*) from public.image_references where image_id = pg_temp.img('test.img_d')),
  0::bigint,
  'and no reference to it survives anywhere');
select is(
  (select sold_out_on from public.dishes where name = 'Odin'),
  (now() at time zone 'Europe/Copenhagen')::date - 5,
  'Odin''s stale sold-out date survived the detach as well');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_c') where name = 'Thor' $$,
  '42501', null,
  'the delete left no marker behind — the next direct write is refused');

reset role;
select is(
  (select count(*) from public.audit_log
    where action = 'delete' and entity = 'image'
      and entity_id = pg_temp.img('test.img_d')
      and actor_id = current_setting('test.staff_uid')::uuid
      and (before -> 'references' ->> 'live') = '4'
      and (before -> 'references' ->> 'draft') = '2'),
  1::bigint,
  'the deletion is audited once, recording four live and two pending references (the draft article counts as pending)');
select pg_temp.become_staff();

-- ===========================================================================
-- 8. Marker hygiene: one statement, one shape, nothing left behind
-- ===========================================================================
--
-- A PostgREST request is one transaction holding one statement, so a browser
-- session can neither set this marker nor reach a second statement in which to
-- spend it. This suite is one long transaction, which makes it exactly the place
-- to check what the marker would and would not admit if it were set by hand.

-- The mechanism: a marker admits one statement — however many rows — and is spent.
select set_config('app.image_reference_write', 'publish', true);
select lives_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_c') where name in ('Thor', 'Odin') $$,
  'a manually raised marker admits exactly one statement, two rows (the mechanism, not a door)');
select is(
  (select count(*) from public.dishes where name in ('Thor', 'Odin')
      and image_id = pg_temp.img('test.img_c')),
  2::bigint,
  'and both rows moved under it');
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'the marker was spent by that statement — it cannot be held open for a second one');

-- A statement that finds nothing to move spends the marker all the same.
select set_config('app.image_reference_write', 'publish', true);
select lives_ok(
  $$ update public.dishes set image_id = null where name = 'ingen ret hedder dette' $$,
  'a zero-row statement runs');
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'and spent the marker although it moved nothing');

-- A marker raised on one table is spent by the statement on that table only —
-- and, being one statement, admits nothing on another.
select set_config('app.image_reference_write', 'publish', true);
select lives_ok(
  $$ update public.weekly_special set draft = draft $$,
  'a statement on another table runs (its own consumer spends the marker)');
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  'and the dish write that follows is refused');

-- Each word admits only its own shape of movement.
select set_config('app.image_reference_write', 'detach', true);
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  '''detach'' cannot set a published image — it only clears');
select set_config('app.image_reference_write', 'replace', true);
select throws_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '42501', null,
  '''replace'' cannot clear a published image — it moves one image to another');
select set_config('app.image_reference_write', 'detach', true);
select lives_ok(
  $$ update public.dishes set image_id = null where name = 'Thor' $$,
  '''detach'' clears');
select set_config('app.image_reference_write', 'replace', true);
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  '''replace'' cannot set a published image where there was none');
select set_config('app.image_reference_write', 'publish', true);
select throws_ok(
  $$ insert into public.dishes (category_id, name, image_id)
     values ((select id from public.menu_categories order by sort_order limit 1),
             'pgTAP-guardret', pg_temp.img('test.img_b')) $$,
  '42501', null,
  'no word admits creating a row with a published image');
select set_config('app.image_reference_write', '', true);

-- The two markers do not stand in for each other.
select set_config('app.image_write', 'delete', true);
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  'the images-row marker admits no reference write');
select set_config('app.image_write', '', true);
select set_config('app.image_reference_write', 'publish', true);
select throws_ok(
  $$ delete from public.images where id = pg_temp.img('test.img_b') $$,
  '42501', null,
  'and the reference marker admits no images-row delete');
select set_config('app.image_reference_write', '', true);

-- A transition that raises mid-way leaves nothing behind: a draft naming an image
-- that does not exist is refused by the FK inside publish, after the marker was
-- raised and before it could be cleared.
update public.dishes
   set draft = '{"image_id": "99999999-9999-4999-8999-999999999997"}'::jsonb
 where name = 'Thor';
create function pg_temp.publish_thor_nowhere() returns void
language sql as $fn$
  select public.publish_dish(pg_temp.dish_id('Thor'), pg_temp.dish_version('Thor'))
$fn$;
select throws_ok(
  'select pg_temp.publish_thor_nowhere()',
  '23503', null,
  'the FK refuses a publish naming an image that does not exist');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_b') where name = 'Thor' $$,
  '42501', null,
  'and the aborted transition left no marker behind either');
update public.dishes set draft = null where name = 'Thor';

-- The referential action, measured rather than assumed: PostgreSQL runs
-- ON DELETE SET NULL as the table owner, so the guard steps aside for it exactly
-- as it does for a migration. delete_image() detaches the guarded columns itself
-- and rests on none of this; the measurement is here so a change in that
-- behaviour is a failing test rather than a surprise.
select pg_temp.fixture_live_image('dish', pg_temp.img('test.img_b'));
select set_config('app.image_write', 'delete', true);
select lives_ok(
  $$ delete from public.images where id = pg_temp.img('test.img_b') $$,
  'measured: with the images marker raised by hand, a referenced image row can be deleted');
select is(
  pg_temp.dish_image('Thor'), null::uuid,
  'and the FK nulled the published reference as the table owner — the guard did not fire for it');
select throws_ok(
  $$ update public.dishes set image_id = pg_temp.img('test.img_c') where name = 'Thor' $$,
  '42501', null,
  'while the very next direct write is still refused');

-- ===========================================================================
-- 9. Cleanup of this suite's rows, then: nothing else moved
-- ===========================================================================

select is(
  (select public.delete_image(pg_temp.img('test.img_c'), pg_temp.img_version('test.img_c'), true) ->> 'status'),
  'deleted',
  'the remaining fixture image deletes confirmed');
select is(
  (select count(*) from public.image_references), 0::bigint,
  'no reference of any kind survives the suite — live or pending');
select is(
  pg_temp.dish_image('Odin'), null::uuid,
  'Odin''s published image is detached');
select is(
  (select draft from public.weekly_special limit 1), null::jsonb,
  'the weekly draft — image reference only — ended NULL');

reset role;
delete from public.news where slug = 'pgtap-guardnyhed';
select pg_temp.fixture_sold_out('Odin', null);
update public.dishes set draft = null where name in ('Thor', 'Odin');

select is(
  (select count(*) from public.images), 0::bigint,
  'the library is empty again');
select is(
  pg_temp.announcement_state()::text,
  current_setting('test.announcement_before'),
  'the announcement row is byte-identical — the guard touches no other content');
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
