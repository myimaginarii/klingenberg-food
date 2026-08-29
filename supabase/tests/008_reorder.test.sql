-- Klingenberg Food — pgTAP: reordering dishes (technical plan §4, §5, §6, §9).
--
-- Phase 5E added **no SQL at all**, and that is the first thing worth proving. A reorder
-- is an ordinary draft change: it writes `sort_order` into `dishes.draft` through the
-- same `UPDATE … WHERE updated_at = …` every other draft save uses, and it goes live
-- through `publish_dish`, unchanged since phase 4. There is no reorder function, no
-- ordering table, no trigger and no live `sort_order` write anywhere in the path.
--
-- So this suite asserts the properties the *application* relies on, from real Staff,
-- Owner and anonymous JWTs:
--
--   1. a reorder touches `draft` and nothing else — the live `sort_order`, the price,
--      the name, `sold_out_on` and `deleted_at` all stand exactly as they were;
--   2. a colleague's pending price or description survives a reorder of the same dish;
--   3. Staff may do it, Owner may do it, `anon` may not — and cannot read the draft
--      either;
--   4. a stale version token writes nothing, rather than winning over a newer order;
--   5. `pending_changes` lists exactly the dishes whose position moved;
--   6. publishing moves the position to the live column and clears the draft, and only
--      then does the public read see the new order.
--
-- The public order is checked through `anon`'s own view of the table throughout, because
-- "the guest still sees the old order" is the promise phase 5E exists to keep and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005, 006 and 007.

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

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

insert into public.menu_categories (id, slug, name, sort_order, visible) values
  ('11111111-1111-4111-8111-111111111111', 'burgere', 'Burgere', 1, true);

-- The phase brief's own worked example: Odin, Frigg, Ragnar, published in that order.
-- Ragnar also carries an unrelated pending price edit, because "a reorder must not erase
-- another person's draft" is the property most easily broken by a careless merge.
insert into public.dishes
  (id, category_id, name, description, price_ore, labels, sort_order, is_new_draft, draft)
values
  ('22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'Odin',   'Dry aged bøf.', 8900,
   array['Populær'], 1, false, null),
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111', 'Frigg',  'Panko-kylling.', 8900,
   array[]::text[], 2, false, null),
  ('22222222-2222-4222-8222-222222222223',
   '11111111-1111-4111-8111-111111111111', 'Ragnar', 'Sliced oksefilet.', 9700,
   array[]::text[], 3, false,
   jsonb_build_object('price_ore', 9900, 'description', 'Ny beskrivelse afventer'));

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

-- The public order, read exactly as a guest reads it: through `anon`, from the live
-- column, with no draft anywhere in sight.
create function pg_temp.public_order()
returns text
language sql
as $fn$
  select string_agg(name, ', ' order by sort_order)
    from public.dishes
   where deleted_at is null
$fn$;

-- The order the administration shows: the draft's position where there is one.
create function pg_temp.draft_order()
returns text
language sql
as $fn$
  select string_agg(name, ', ' order by coalesce((draft ->> 'sort_order')::int, sort_order))
    from public.dishes
   where deleted_at is null
$fn$;


-- ===========================================================================
-- 0. The starting point
-- ===========================================================================

select is(pg_temp.public_order(), 'Odin, Frigg, Ragnar', 'the public order starts as seeded');
select is(pg_temp.draft_order(), 'Odin, Frigg, Ragnar', 'and the administration agrees');


-- ===========================================================================
-- 1. Phase 5E added no database object (§4)
-- ===========================================================================
--
-- The negative assertion first, because it is the one that rots silently: a later phase
-- that "helps" by adding a reorder function or an ordering table would make every other
-- assertion in this file true about the wrong system.

select is_empty(
  $$ select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname ~ '(reorder|sort_order|move_dish)' $$,
  'there is no reorder function in the database — a reorder is a draft write');

select is_empty(
  $$ select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname ~ '(order|position|rank)' $$,
  'there is no second ordering table');


-- ===========================================================================
-- 2. Anonymous can neither reorder nor see that anybody has (§5, §8)
-- ===========================================================================

select pg_temp.become_anon();

-- Refused by the grant, before RLS is even consulted: `anon` holds no UPDATE on the
-- table at all, so there is no policy to get wrong.
select throws_ok(
  $$ update public.dishes
        set draft = jsonb_build_object('sort_order', 1)
      where id = '22222222-2222-4222-8222-222222222223' $$,
  '42501', null, 'anon cannot write a draft position — no UPDATE grant exists');

select throws_ok(
  $$ select draft from public.dishes $$,
  '42501', null, 'anon cannot read a draft, so it cannot learn the pending order');

select throws_ok(
  $$ select entity from public.pending_changes $$,
  '42501', null, 'anon cannot read pending_changes');

-- What `anon` *can* read is the published order, which is the whole of what a guest is
-- entitled to know about where a dish sits.
select is(
  (select string_agg(name, ', ' order by sort_order) from public.dishes),
  'Odin, Frigg, Ragnar',
  'a guest reads the published order and only that');

reset role;

select is(pg_temp.public_order(), 'Odin, Frigg, Ragnar', 'the public order is untouched');


-- ===========================================================================
-- 3. Staff move Ragnar above Frigg — as a draft (§6)
-- ===========================================================================
--
-- Two rows change, because a move is not one dish's business: Ragnar takes position 2
-- and Frigg takes 3. Each write names its own `updated_at`, exactly as the Server Action
-- performs it, and each writes `draft` and nothing else.

select pg_temp.become_staff();

select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb) || jsonb_build_object('sort_order', 2)
      where d.id = '22222222-2222-4222-8222-222222222223'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222223') $$,
  'staff may write a draft position on Ragnar');

select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb) || jsonb_build_object('sort_order', 3)
      where d.id = '22222222-2222-4222-8222-222222222222'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222222') $$,
  'staff may write a draft position on Frigg');

reset role;

select is(pg_temp.draft_order(), 'Odin, Ragnar, Frigg',
  'the administration now shows the new order');

select is(pg_temp.public_order(), 'Odin, Frigg, Ragnar',
  'and the public order is still the old one — nothing was published');


-- ===========================================================================
-- 4. The reorder touched the draft and nothing else (§4)
-- ===========================================================================

select is(
  (select sort_order from public.dishes where id = '22222222-2222-4222-8222-222222222223'),
  3, 'Ragnar''s live sort_order is exactly as it was');

select is(
  (select sort_order from public.dishes where id = '22222222-2222-4222-8222-222222222222'),
  2, 'Frigg''s live sort_order is exactly as it was');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222223'),
  9700, 'the live price did not move');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222223'),
  'Ragnar', 'the live name did not move');

select is(
  (select count(*) from public.dishes where deleted_at is not null),
  0::bigint, 'nothing was deleted');

select is(
  (select count(*) from public.dishes where sold_out_on is not null),
  0::bigint, 'nothing became sold out');


-- ===========================================================================
-- 5. A colleague's pending edit survived the reorder (§4, §6)
-- ===========================================================================
--
-- This is the property `mode: 'merge'` exists for. Ragnar's draft held a price and a
-- description before the move; it must hold all three afterwards, not just the position.

select is(
  (select (draft ->> 'price_ore')::int from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  9900, 'the pending price is still in the draft');

select is(
  (select draft ->> 'description' from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  'Ny beskrivelse afventer', 'and so is the pending description');

select is(
  (select (draft ->> 'sort_order')::int from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  2, 'alongside the new position');

select is(
  (select count(*) from jsonb_object_keys(
     (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222222'))),
  1::bigint, 'a dish that had no draft now has one holding only the position');


-- ===========================================================================
-- 6. `pending_changes` lists exactly the dishes that moved (§4, §6)
-- ===========================================================================

select pg_temp.become_staff();

select bag_eq(
  $$ select entity_id::text from public.pending_changes where entity = 'dish' $$,
  $$ values ('22222222-2222-4222-8222-222222222222'), ('22222222-2222-4222-8222-222222222223') $$,
  'the two moved dishes are pending, and Odin — which did not move — is not');

reset role;


-- ===========================================================================
-- 7. A stale version token writes nothing (§6, §7e item 2)
-- ===========================================================================
--
-- The application checks the order's fingerprint before it writes anything, but that is
-- a courtesy: the guarantee is here, in the predicate every draft write carries. A
-- second staff member who loaded the screen before the move above must not be able to
-- put their order on top of it.

select set_config('test.stale', (now() - interval '1 hour')::text, true);

select pg_temp.become_staff();

select lives_ok(
  $$ update public.dishes
        set draft = jsonb_build_object('sort_order', 99)
      where id = '22222222-2222-4222-8222-222222222223'
        and updated_at = current_setting('test.stale')::timestamptz $$,
  'a stale write raises nothing — it simply matches no row');

reset role;

select is(
  (select (draft ->> 'sort_order')::int from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  2, 'and the newer order stands: the stale position was never written');

select is(
  (select draft ->> 'description' from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  'Ny beskrivelse afventer',
  'nor did the refused write blank the rest of the draft');


-- ===========================================================================
-- 8. The Owner may reorder too (§5, first row of the matrix)
-- ===========================================================================

select pg_temp.become_owner();

select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb) || jsonb_build_object('sort_order', 3)
      where d.id = '22222222-2222-4222-8222-222222222223'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222223') $$,
  'the owner may write a draft position');

reset role;

select is(
  (select (draft ->> 'sort_order')::int from public.dishes
    where id = '22222222-2222-4222-8222-222222222223'),
  3, 'and the owner''s position is what is stored');

-- Put Ragnar back at 2 for the publish below.
update public.dishes
   set draft = draft || jsonb_build_object('sort_order', 2)
 where id = '22222222-2222-4222-8222-222222222223';


-- ===========================================================================
-- 9. Publishing is phase 4's, unchanged (§6)
-- ===========================================================================
--
-- No reorder-specific publish path: the same `publish_dish` a price change goes through
-- moves the position to the live column, clears the draft and writes the audit row.

select pg_temp.become_staff();

select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222223'),
  'published', 'staff can publish the reordered dish');

select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222222'),
  'published', 'and the dish that moved with it');

reset role;

select is(pg_temp.public_order(), 'Odin, Ragnar, Frigg',
  'the public order is now the new one');

select is(
  (select count(*) from public.dishes where draft is not null),
  0::bigint, 'and no draft is left behind');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222223'),
  9900, 'the pending price went live with it — one publish, one dish, every field');

select bag_eq(
  $$ select entity_id::text from public.pending_changes where entity = 'dish' $$,
  $$ select null::text where false $$,
  'nothing is pending any more');

select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'dish'),
  2::bigint, 'two publishes were logged, one per dish that moved');


-- ===========================================================================
-- 10. A published position that is reverted leaves no pending change (§4)
-- ===========================================================================
--
-- The clearing rule, at the database's level: a draft reduced to nothing must be `null`,
-- not `{}`, or the dish stays in `pending_changes` for ever with nothing to publish.

update public.dishes
   set draft = jsonb_build_object('sort_order', 1)
 where id = '22222222-2222-4222-8222-222222222223';

select pg_temp.become_staff();

select is(
  (select count(*) from public.pending_changes where entity = 'dish'),
  1::bigint, 'a draft position makes the dish pending');

reset role;

update public.dishes set draft = null
 where id = '22222222-2222-4222-8222-222222222223';

select pg_temp.become_staff();

select is(
  (select count(*) from public.pending_changes where entity = 'dish'),
  0::bigint, 'and clearing it to NULL makes the dish stop being pending');

reset role;

-- `{}` is the mistake this rule exists to prevent, stated as an assertion so the
-- application's "an empty draft is written as NULL" is not the only place it is true.
update public.dishes set draft = '{}'::jsonb
 where id = '22222222-2222-4222-8222-222222222223';

select pg_temp.become_staff();

select is(
  (select count(*) from public.pending_changes where entity = 'dish'),
  1::bigint, 'an empty object would keep it pending — which is why nothing writes one');

reset role;


-- ===========================================================================
-- 11. `sort_order` is a draft field, and `anon` still cannot see a draft (§4, §8)
-- ===========================================================================

select has_column('public', 'dishes', 'sort_order', 'dishes.sort_order exists');

select is_empty(
  $$ select 1
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'dishes'
        and column_name = 'draft' and grantee = 'anon' $$,
  'anon holds no privilege on dishes.draft, so a pending order is invisible publicly');

select ok(
  (select has_column_privilege('anon', 'public.dishes', 'sort_order', 'SELECT')),
  'anon may read the live sort_order — that is the published order');


select * from finish();
rollback;
