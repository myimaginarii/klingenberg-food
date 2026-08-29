-- Klingenberg Food — pgTAP: the immediate Udsolgt path (technical plan §5, §6, §7b, §8).
--
-- Phase 5C put the availability change in the database because §6 requires it to be one
-- transaction, and because the promise that matters most about it is a *negative* one:
-- this operation may change `sold_out_on` and nothing else. A promise about what a
-- statement cannot do is only worth having if something tries.
--
-- So this suite proves, from real Staff, Owner and anonymous JWTs:
--
--   1. Staff and Owner may both change availability; anon may not reach the function;
--   2. exactly three columns move, and every other column on the dish is untouched;
--   3. the audit row is written with the actor from the JWT and a truthful before/after;
--   4. a date that is not today in Copenhagen is refused;
--   5. a stale version token is a conflict — the row is unchanged and no audit row is
--      written, so a refusal can never leave a false success in the log;
--   6. the immediate path creates no draft and puts nothing in `pending_changes`.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005.

begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.dishes;
delete from public.menu_categories;
delete from public.audit_log;

insert into public.menu_categories (id, slug, name, sort_order) values
  ('11111111-1111-4111-8111-111111111111', 'burgere', 'Burgere', 1);

insert into public.dishes
  (id, category_id, name, description, secondary_note, price_ore, labels, sort_order)
values
  ('22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111',
   'Thor', 'Oksekød, bacon, cheddar.', 'Som menu 164 kr.', 12900, array['Populær'], 3);

select set_config('test.staff_uid',
  (select id from auth.users where email = 'staff@example.test')::text, true);
select set_config('test.owner_uid',
  (select id from auth.users where email = 'owner@example.test')::text, true);

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

/** Today in Copenhagen, the only date this operation may write (§7b). */
create function pg_temp.today_cph() returns date language sql stable as $fn$
  select (now() at time zone 'Europe/Copenhagen')::date;
$fn$;

/** The current version token of the fixture dish, for the next call. */
create function pg_temp.thor_version() returns timestamptz language sql stable as $fn$
  select updated_at from public.dishes where id = '22222222-2222-4222-8222-222222222221';
$fn$;

/**
 * Everything about the dish that this operation must never touch.
 *
 * One row, compared before and after. Naming the columns rather than taking `to_jsonb`
 * of the whole row is deliberate: the three the operation *does* change would otherwise
 * make every comparison fail, and hiding them behind an exclusion list is how a fourth
 * column quietly joins them.
 */
create function pg_temp.thor_untouched() returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'category_id', d.category_id, 'name', d.name, 'description', d.description,
    'secondary_note', d.secondary_note, 'price_ore', d.price_ore, 'labels', to_jsonb(d.labels),
    'details', d.details, 'image_id', d.image_id, 'sort_order', d.sort_order,
    'is_new_draft', d.is_new_draft, 'deleted_at', d.deleted_at, 'draft', d.draft,
    'created_at', d.created_at)
  from public.dishes d where d.id = '22222222-2222-4222-8222-222222222221';
$fn$;


-- ===========================================================================
-- 1. The shape of the function itself (§8)
-- ===========================================================================

select ok(
  not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_dish_sold_out'),
  'set_dish_sold_out is SECURITY INVOKER, so RLS re-checks the caller');

select ok(
  (select coalesce(p.proconfig, '{}') @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_dish_sold_out'),
  'set_dish_sold_out pins search_path to the empty string');

select is_empty(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('set_dish_sold_out', 'dish_availability')
        and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon holds EXECUTE on neither the availability function nor its audit shape');

-- The immediate path must stay out of the publish machinery: `publish_dish` may not
-- learn to write `sold_out_on`, or a draft could carry availability after all (§6).
select ok(
  (select prosrc not like '%sold\_out\_on%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_dish'),
  'publish_dish still does not mention sold_out_on — the paths stay separate');


-- ===========================================================================
-- 2. Anonymous can reach none of it (§5, §8)
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  $$ select public.set_dish_sold_out(
       '22222222-2222-4222-8222-222222222221'::uuid, current_date, now()) $$,
  '42501', null, 'anon cannot call set_dish_sold_out');

select throws_ok(
  $$ update public.dishes set sold_out_on = current_date $$,
  '42501', null, 'anon cannot write dishes.sold_out_on directly either');

reset role;

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null::date,
  'the dish is still available after the anonymous attempts');


-- ===========================================================================
-- 3. Staff marks it Udsolgt i dag — the whole transaction (§6, §7b)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  pg_temp.thor_untouched(),
  pg_temp.thor_untouched(),
  'the untouched-columns fixture is stable across two reads');

-- Kept for the comparison after the write.
select set_config('test.before_untouched', pg_temp.thor_untouched()::text, true);

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     pg_temp.today_cph(),
     pg_temp.thor_version()) ->> 'status'),
  'updated',
  'staff can mark a dish udsolgt');

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  pg_temp.today_cph(),
  'sold_out_on now holds today''s Copenhagen date');

select isnt(
  (select sold_out_changed_at from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'sold_out_changed_at was stamped');

select is(
  (select sold_out_changed_by from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  current_setting('test.staff_uid')::uuid,
  'sold_out_changed_by is the staff member from the JWT, not a parameter');

-- The negative promise: everything else about the dish is exactly as it was.
select is(
  pg_temp.thor_untouched(),
  current_setting('test.before_untouched')::jsonb,
  'no other column on the dish moved — not price, name, category, labels, draft or deleted_at');


-- ===========================================================================
-- 4. The audit row (§8, §10)
-- ===========================================================================

reset role;

select is(
  (select count(*) from public.audit_log where action = 'availability'),
  1::bigint,
  'exactly one availability audit row was written');

select is(
  (select actor_id from public.audit_log where action = 'availability'),
  current_setting('test.staff_uid')::uuid,
  'the audit actor is the staff member, taken from the JWT');

select is(
  (select entity from public.audit_log where action = 'availability'),
  'dish',
  'the audit row names the dish entity');

select is(
  (select entity_id from public.audit_log where action = 'availability'),
  '22222222-2222-4222-8222-222222222221'::uuid,
  'the audit row names the dish that changed');

select is(
  (select before ->> 'sold_out_on' from public.audit_log where action = 'availability'),
  null,
  'the before value records that it was available');

select is(
  (select (after ->> 'sold_out_on')::date from public.audit_log where action = 'availability'),
  pg_temp.today_cph(),
  'the after value records the date it was marked');

-- The whole file is one transaction, so `created_at` — which is `now()` — is identical
-- for every row it writes. "The latest entry" is therefore not a question the log can
-- answer here, and asking it by `order by created_at` would pick a row at random. The
-- first entry is pinned by id instead, and the second is "the one that is not it".
select set_config('test.first_audit_id',
  (select id from public.audit_log where action = 'availability')::text, true);

-- Staff must not gain general read access to the log by being able to write to it (§5).
select pg_temp.become_staff();
select is_empty(
  $$ select id from public.audit_log $$,
  'staff still cannot read audit_log');
reset role;

select pg_temp.become_owner();
select isnt_empty(
  $$ select id from public.audit_log where action = 'availability' $$,
  'the owner can read the availability entry');
reset role;


-- ===========================================================================
-- 5. Nothing about this is a draft (§4, §6)
-- ===========================================================================

select is(
  (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'marking a dish udsolgt created no draft');

select pg_temp.become_staff();
select is_empty(
  $$ select entity from public.pending_changes where entity = 'dish' $$,
  'the immediate change puts nothing in pending_changes');
reset role;


-- ===========================================================================
-- 6. Pressing it twice is one decision (§6)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     pg_temp.today_cph(),
     pg_temp.thor_version()) ->> 'status'),
  'unchanged',
  'setting the same value again reports unchanged');

reset role;

select is(
  (select count(*) from public.audit_log where action = 'availability'),
  1::bigint,
  'and writes no second audit row');


-- ===========================================================================
-- 7. The date is not the caller's to choose (§7b, rule 4)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     pg_temp.today_cph() - 1,
     pg_temp.thor_version()) ->> 'status'),
  'invalid_date',
  'yesterday is refused');

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     pg_temp.today_cph() + 1,
     pg_temp.thor_version()) ->> 'status'),
  'invalid_date',
  'tomorrow is refused');

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     pg_temp.today_cph() + 400,
     pg_temp.thor_version()) ->> 'status'),
  'invalid_date',
  'a date far outside the trigger''s own ±1 day backstop is refused here first');

reset role;

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  pg_temp.today_cph(),
  'a refused date left the stored value alone');

select is(
  (select count(*) from public.audit_log where action = 'availability'),
  1::bigint,
  'a refused date wrote no audit row');


-- ===========================================================================
-- 8. A stale version token is a conflict, not an overwrite (§6, §7e item 2)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     null,
     now() - interval '1 hour') ->> 'status'),
  'conflict',
  'a version token from an hour ago is refused');

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     null,
     null) ->> 'status'),
  'conflict',
  'a missing version token is refused rather than treated as a match');

reset role;

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  pg_temp.today_cph(),
  'the conflict left the dish exactly as it was');

select is(
  (select count(*) from public.audit_log where action = 'availability'),
  1::bigint,
  'and the conflict wrote no false success into the log');


-- ===========================================================================
-- 9. A dish that is not there (§8)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_dish_sold_out(
     '00000000-0000-4000-8000-000000000000'::uuid,
     pg_temp.today_cph(),
     now()) ->> 'status'),
  'not_found',
  'a dish id that names nothing is refused, and says so without touching anything');

-- A soft-deleted dish is on its way out; its availability is not a thing to change.
update public.dishes
   set deleted_at = now()
 where id = '22222222-2222-4222-8222-222222222221';

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     null,
     pg_temp.thor_version()) ->> 'status'),
  'not_found',
  'a soft-deleted dish is out of reach of the availability operation');

update public.dishes
   set deleted_at = null
 where id = '22222222-2222-4222-8222-222222222221';

reset role;


-- ===========================================================================
-- 10. The Owner may do it too, and Fortryd is an ordinary second write (§5, §6)
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select public.set_dish_sold_out(
     '22222222-2222-4222-8222-222222222221'::uuid,
     null,
     pg_temp.thor_version()) ->> 'status'),
  'updated',
  'the owner can return a dish to tilgængelig');

reset role;

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null::date,
  'the dish is available again');

select is(
  (select count(*) from public.audit_log where action = 'availability'),
  2::bigint,
  'the undo is a real write and has its own audit row');

select is(
  (select actor_id from public.audit_log
    where action = 'availability' and id <> current_setting('test.first_audit_id')::uuid),
  current_setting('test.owner_uid')::uuid,
  'the second entry is attributed to the owner who made it');

select is(
  (select (before ->> 'sold_out_on')::date from public.audit_log
    where action = 'availability' and id <> current_setting('test.first_audit_id')::uuid),
  pg_temp.today_cph(),
  'the undo records what it undid');

select is(
  (select after ->> 'sold_out_on' from public.audit_log
    where action = 'availability' and id <> current_setting('test.first_audit_id')::uuid),
  null,
  'and what it left behind');

select is(
  pg_temp.thor_untouched(),
  current_setting('test.before_untouched')::jsonb,
  'after four availability calls the rest of the dish is still exactly as it started');

select is(
  (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'and it still has no draft');


select * from finish();
rollback;
