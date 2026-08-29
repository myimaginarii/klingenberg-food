-- Klingenberg Food — pgTAP: the Tapas lists (technical plan §4 decision 3, §5, §6, §9).
--
-- Phase 5F added **no SQL at all**, and that is the first thing worth proving. A Tapas
-- edit is an ordinary draft change on an ordinary dish: it writes `details` into
-- `dishes.draft` through the same `UPDATE … WHERE updated_at = …` every other draft save
-- uses, and it goes live through `publish_dish`, unchanged since phase 4. There is no
-- Tapas table, no Tapas entity, no Tapas RPC and no per-item row anywhere in the path.
--
-- So this suite asserts the properties the *application* relies on, from real Staff,
-- Owner and anonymous JWTs:
--
--   1. no Tapas-shaped database object exists, and none is needed;
--   2. the column's own CHECK refuses a `details` that is not a JSON object;
--   3. Staff may write a Tapas draft, Owner may, `anon` may not — and `anon` cannot read
--      the draft either, so a guest cannot learn what the board is about to become;
--   4. the write touches `draft` and nothing else: the live `details`, the price, the
--      name, `sold_out_on` and `deleted_at` all stand exactly as they were;
--   5. a colleague's pending price survives a Tapas edit, and the Tapas draft survives a
--      later price edit — the merge property phase 5F most easily breaks;
--   6. a stale version token writes nothing;
--   7. `pending_changes` lists the Tapas dish;
--   8. `publish_dish` moves the document to the live column, clears the draft and logs
--      one audit row attributed to whoever published — and only then does the public read
--      see the new lists.
--
-- The public board is checked through `anon`'s own view of the table throughout, because
-- "the guest still reads the old lists" is the promise phase 5F exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–008.

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
  ('11111111-1111-4111-8111-111111111111', 'tapas', 'Tapas', 1, true);

-- The seeded shape, including the detail that matters: the fixed-contents group carries
-- no `choose` key at all, because there is nothing to choose. The application's schema
-- accepts that and writes it back as an explicit `null`; both are the same board.
insert into public.dishes
  (id, category_id, name, price_ore, labels, details, sort_order, is_new_draft, draft)
values
  ('22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'Tapas', 29500, array[]::text[],
   jsonb_build_object(
     'kind', 'tapas',
     'groups', jsonb_build_array(
       jsonb_build_object('id', 'base', 'heading', 'På bordet — altid med', 'mode', 'fixed',
                          'items', jsonb_build_array('Oliven', 'Frugt')),
       jsonb_build_object('id', 'choose7', 'heading', 'I vælger 7', 'mode', 'choose',
                          'choose', 7, 'items', jsonb_build_array('Brie', 'Chorizo')),
       jsonb_build_object('id', 'dressing', 'heading', 'Og 3 dressinger', 'mode', 'choose',
                          'choose', 3, 'items', jsonb_build_array('Pesto', 'Aioli')))),
   1, false, null),
  -- An ordinary dish beside it, so "the editor appears on the Tapas dish and on no
  -- other" has something to be true *of* at this level too.
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111', 'Odin', 8900, array[]::text[],
   null, 2, false, null);

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

-- The dressings a guest reads, exactly as a guest reads them: through the live column,
-- with no draft anywhere in sight.
create function pg_temp.public_dressings()
returns text
language sql
as $fn$
  select string_agg(item, ', ')
    from public.dishes d,
         lateral jsonb_array_elements(d.details -> 'groups') g,
         lateral jsonb_array_elements_text(g -> 'items') item
   where d.id = '22222222-2222-4222-8222-222222222221'
     and g ->> 'id' = 'dressing'
$fn$;

-- The dressings the administration shows: the draft's document where there is one.
create function pg_temp.draft_dressings()
returns text
language sql
as $fn$
  select string_agg(item, ', ')
    from public.dishes d,
         lateral jsonb_array_elements(
           coalesce(d.draft -> 'details', d.details) -> 'groups') g,
         lateral jsonb_array_elements_text(g -> 'items') item
   where d.id = '22222222-2222-4222-8222-222222222221'
     and g ->> 'id' = 'dressing'
$fn$;

-- One edited board: Aioli removed, Urtemayo added, the other two groups untouched.
create function pg_temp.edited_board()
returns jsonb
language sql
as $fn$
  select jsonb_build_object(
    'kind', 'tapas',
    'groups', jsonb_build_array(
      jsonb_build_object('id', 'base', 'heading', 'På bordet — altid med', 'mode', 'fixed',
                         'choose', null, 'items', jsonb_build_array('Oliven', 'Frugt')),
      jsonb_build_object('id', 'choose7', 'heading', 'I vælger 7', 'mode', 'choose',
                         'choose', 7, 'items', jsonb_build_array('Brie', 'Chorizo')),
      jsonb_build_object('id', 'dressing', 'heading', 'Og 3 dressinger', 'mode', 'choose',
                         'choose', 3, 'items', jsonb_build_array('Pesto', 'Urtemayo'))))
$fn$;


-- ===========================================================================
-- 0. The starting point
-- ===========================================================================

select is(pg_temp.public_dressings(), 'Pesto, Aioli', 'the public board starts as seeded');
select is(pg_temp.draft_dressings(), 'Pesto, Aioli', 'and the administration agrees');


-- ===========================================================================
-- 1. Phase 5F added no database object (§4)
-- ===========================================================================
--
-- The negative assertion first, because it is the one that rots silently: a later phase
-- that "helps" by adding a tapas table or a tapas publish function would make every
-- other assertion in this file true about the wrong system.

select is_empty(
  $$ select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname ~ 'tapas' $$,
  'there is no tapas function in the database — a tapas edit is a draft write');

select is_empty(
  $$ select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and c.relname ~ '(tapas|dish_item|dish_option)' $$,
  'there is no tapas table and no tapas view');

select has_column('public', 'dishes', 'details',
  'the whole of the storage is one jsonb column on the dish');


-- ===========================================================================
-- 2. The column's own shape rule (§4)
-- ===========================================================================
--
-- The document's *contents* are validated by Zod in the application, twice — once when
-- the editor submits and once when the stored draft is re-parsed before publication.
-- What the database itself guarantees is narrower and worth stating: `details` is an
-- object or nothing. A scalar or an array is refused by a CHECK, not by a convention.

select throws_ok(
  $$ update public.dishes set details = '"tapas"'::jsonb
      where id = '22222222-2222-4222-8222-222222222221' $$,
  '23514', null, 'a scalar details is refused by dishes_details_shape');

select throws_ok(
  $$ update public.dishes set details = '[]'::jsonb
      where id = '22222222-2222-4222-8222-222222222221' $$,
  '23514', null, 'an array details is refused too');

select lives_ok(
  $$ update public.dishes set details = details
      where id = '22222222-2222-4222-8222-222222222221' $$,
  'and the seeded object is accepted, unchanged');


-- ===========================================================================
-- 3. Anonymous can neither edit the lists nor see that anybody has (§5, §8)
-- ===========================================================================

select pg_temp.become_anon();

-- Refused by the grant, before RLS is even consulted: `anon` holds no UPDATE on the
-- table at all, so there is no policy to get wrong.
select throws_ok(
  $$ update public.dishes
        set draft = jsonb_build_object('details', '{"kind":"tapas"}'::jsonb)
      where id = '22222222-2222-4222-8222-222222222221' $$,
  '42501', null, 'anon cannot write a tapas draft — no UPDATE grant exists');

select throws_ok(
  $$ select draft from public.dishes $$,
  '42501', null, 'anon cannot read a draft, so it cannot learn the coming board');

select throws_ok(
  $$ select entity from public.pending_changes $$,
  '42501', null, 'anon cannot read pending_changes');

-- What `anon` *can* read is the published board, which is the whole of what a guest is
-- entitled to know about what is on the table.
select is(pg_temp.public_dressings(), 'Pesto, Aioli',
  'a guest reads the published lists and only those');

reset role;


-- ===========================================================================
-- 4. Staff edit one list — as a draft (§6)
-- ===========================================================================
--
-- One row changes, and one column of it. The write names its own `updated_at`, exactly
-- as the Server Action performs it, and merges into whatever the draft already held.

select pg_temp.become_staff();

-- A colleague's pending price, written first, because "a tapas edit must not erase
-- another person's draft" is the property most easily broken by a careless replace.
select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb) || jsonb_build_object('price_ore', 30500)
      where d.id = '22222222-2222-4222-8222-222222222221'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222221') $$,
  'staff may write a pending price on the tapas dish');

select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb)
                 || jsonb_build_object('details', pg_temp.edited_board())
      where d.id = '22222222-2222-4222-8222-222222222221'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222221') $$,
  'staff may then write the edited board into the same draft');

reset role;

select is(pg_temp.draft_dressings(), 'Pesto, Urtemayo',
  'the administration now shows the edited list');

select is(pg_temp.public_dressings(), 'Pesto, Aioli',
  'and the public list is still the old one — nothing was published');


-- ===========================================================================
-- 5. The edit touched the draft and nothing else (§4)
-- ===========================================================================

select is(
  (select details -> 'groups' -> 2 -> 'items' ->> 1 from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'),
  'Aioli', 'the live document is exactly as it was');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  29500, 'the live price did not move');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Tapas', 'the live name did not move');

select is(
  (select count(*) from public.dishes where sold_out_on is not null or deleted_at is not null),
  0::bigint, 'nothing became sold out and nothing was deleted');

select is(
  (select details from public.dishes where id = '22222222-2222-4222-8222-222222222222'),
  null, 'the ordinary dish beside it still has no details at all');


-- ===========================================================================
-- 6. Both drafts are there, and both survive the other being written (§4, §6)
-- ===========================================================================

select is(
  (select (draft ->> 'price_ore')::int from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'),
  30500, 'the pending price survived the tapas edit');

select is(
  (select draft -> 'details' -> 'groups' -> 2 -> 'items' ->> 1 from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'),
  'Urtemayo', 'alongside the new board');

-- …and the other direction: an ordinary field edit written afterwards leaves the
-- document alone, which is what `mode: 'merge'` plus a named `clear` list buys.
select pg_temp.become_staff();

select lives_ok(
  $$ update public.dishes d
        set draft = coalesce(d.draft, '{}'::jsonb) || jsonb_build_object('name', 'Tapasbord')
      where d.id = '22222222-2222-4222-8222-222222222221'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222221') $$,
  'staff may then edit an ordinary field on the same dish');

reset role;

select is(
  (select draft -> 'details' -> 'groups' -> 2 -> 'items' ->> 1 from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'),
  'Urtemayo', 'and the tapas draft survived that too');

select is(
  (select count(*) from jsonb_object_keys(
     (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222221'))),
  3::bigint, 'the draft holds exactly the three fields somebody edited');


-- ===========================================================================
-- 7. A stale version token writes nothing (§6)
-- ===========================================================================

select set_config('test.stale', (now() - interval '1 hour')::text, true);

select pg_temp.become_staff();

select lives_ok(
  $$ update public.dishes
        set draft = jsonb_build_object('details', '{"kind":"tapas","groups":[]}'::jsonb)
      where id = '22222222-2222-4222-8222-222222222221'
        and updated_at = current_setting('test.stale')::timestamptz $$,
  'a stale write raises nothing — it simply matches no row');

reset role;

select is(
  (select draft -> 'details' -> 'groups' -> 2 -> 'items' ->> 1 from public.dishes
    where id = '22222222-2222-4222-8222-222222222221'),
  'Urtemayo', 'and the newer board stands: the stale document was never written');


-- ===========================================================================
-- 8. The Owner may edit the lists too (§5, "Tapas lists" row of the matrix)
-- ===========================================================================

select pg_temp.become_owner();

select lives_ok(
  $$ update public.dishes d
        set draft = d.draft || jsonb_build_object('details', pg_temp.edited_board())
      where d.id = '22222222-2222-4222-8222-222222222221'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222221') $$,
  'the owner may write a tapas draft');

reset role;


-- ===========================================================================
-- 9. `pending_changes` lists the tapas dish (§4, §6)
-- ===========================================================================

select pg_temp.become_staff();

select bag_eq(
  $$ select entity_id::text from public.pending_changes where entity = 'dish' $$,
  $$ values ('22222222-2222-4222-8222-222222222221') $$,
  'the tapas dish is pending, and the dish beside it — which nobody edited — is not');

reset role;


-- ===========================================================================
-- 10. Publishing is phase 4's, unchanged (§6)
-- ===========================================================================
--
-- No tapas-specific publish path: the same `publish_dish` a price change goes through
-- moves the document to the live column, clears the draft and writes the audit row.

select pg_temp.become_staff();

select is(
  (select public.publish_dish(d.id, d.updated_at) ->> 'status' from public.dishes d
    where d.id = '22222222-2222-4222-8222-222222222221'),
  'published', 'staff can publish the edited board');

reset role;

select is(pg_temp.public_dressings(), 'Pesto, Urtemayo',
  'the public list is now the new one');

select is(
  (select count(*) from public.dishes where draft is not null),
  0::bigint, 'and no draft is left behind');

select is(
  (select price_ore from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  30500, 'the pending price went live with it — one publish, one dish, every field');

select is(
  (select name from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  'Tapasbord', 'and so did the pending name');

select bag_eq(
  $$ select entity_id::text from public.pending_changes where entity = 'dish' $$,
  $$ select null::text where false $$,
  'nothing is pending any more');


-- ===========================================================================
-- 11. The audit row says who did it, and what changed (§4, §8)
-- ===========================================================================

select is(
  (select count(*) from public.audit_log where action = 'publish' and entity = 'dish'),
  1::bigint, 'one publish was logged');

select is(
  (select actor_id::text from public.audit_log where action = 'publish' and entity = 'dish'),
  current_setting('test.staff_uid'),
  'attributed to the staff member who pressed Offentliggør, not to a service role');

select is(
  (select before -> 'details' -> 'groups' -> 2 -> 'items' ->> 1 from public.audit_log
    where action = 'publish' and entity = 'dish'),
  'Aioli', 'the log holds the board as it was');

select is(
  (select after -> 'details' -> 'groups' -> 2 -> 'items' ->> 1 from public.audit_log
    where action = 'publish' and entity = 'dish'),
  'Urtemayo', 'and the board as it became — which is the recovery story (§8)');


-- ===========================================================================
-- 12. Clearing the document again leaves no pending change (§4)
-- ===========================================================================
--
-- A person who removes a dressing and puts it back has changed nothing, and the editor
-- says so by removing `details` from the draft rather than leaving an identical document
-- inside it. A draft with no fields left is `null`, not `{}` — otherwise the dish would
-- stay pending forever, offering a publish with nothing to publish.

select pg_temp.become_staff();

select lives_ok(
  $$ update public.dishes d
        set draft = nullif(
              (coalesce(d.draft, '{}'::jsonb)
                 || jsonb_build_object('details', d.details)) - 'details',
              '{}'::jsonb)
      where d.id = '22222222-2222-4222-8222-222222222221'
        and d.updated_at = (select updated_at from public.dishes
                             where id = '22222222-2222-4222-8222-222222222221') $$,
  'writing the document and taking it out again is one ordinary update');

select bag_eq(
  $$ select entity_id::text from public.pending_changes where entity = 'dish' $$,
  $$ select null::text where false $$,
  'and the dish is not pending, because nothing about it changed');

reset role;

select * from finish();
rollback;
