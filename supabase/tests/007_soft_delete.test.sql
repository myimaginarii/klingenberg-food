-- Klingenberg Food — pgTAP: soft delete and restore (technical plan §4, §5, §6, §8).
--
-- Phase 5D put the deletion in the database because §6 requires it to be one
-- transaction, and because the promises that matter most about it are *negative* ones:
--
--   * this operation may change `deleted_at` and its attribution column, and nothing
--     else on the dish — not the price, not the draft, not `sold_out_on`;
--   * it may not, under any circumstance, become a way for a Staff member to write the
--     Owner-only Forside document (§5);
--   * it never removes a row, so Fortryd has something to restore and `audit_log` has
--     something to point at.
--
-- A promise about what a statement cannot do is only worth having if something tries.
-- So this suite tries, from real Staff, Owner and anonymous JWTs.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005 and 006.

begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

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

-- Three dishes, because deletion has three shapes worth proving separately:
--   Odin  — published, carrying a draft *and* a sold-out marking, and featured on the
--           Forside. The case where the most could go wrong.
--   Thor  — published and ordinary. The control.
--   Loke  — never published (`is_new_draft`). Invisible before deletion and after it.
insert into public.dishes
  (id, category_id, name, description, secondary_note, price_ore, labels, sort_order,
   sold_out_on, is_new_draft, draft)
values
  ('22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111',
   'Odin', 'Dry aged bøf, sennepsmayo, bacon.', 'Som menu 124 kr.', 8900, array['Populær'], 1,
   (now() at time zone 'Europe/Copenhagen')::date, false,
   jsonb_build_object('price_ore', 9900, 'description', 'Ny beskrivelse afventer')),
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111',
   'Thor', 'Oksekød, bacon, cheddar.', null, 12900, array[]::text[], 2, null, false, null),
  ('22222222-2222-4222-8222-222222222223',
   '11111111-1111-4111-8111-111111111111',
   'Loke', 'Endnu ikke offentliggjort.', null, 9900, array[]::text[], 3, null, true,
   jsonb_build_object('name', 'Loke'));

-- The Forside features Odin. This is the row the deletion must leave alone.
update public.pages
   set published = jsonb_build_object(
     'hero', jsonb_build_object('heading', 'Klingenberg Food', 'intro', 'Placeholder'),
     'award', jsonb_build_object('title', 'Danmarks Bedste Burger 2026', 'text', 'Placeholder'),
     'featured_dish_ids', jsonb_build_array('22222222-2222-4222-8222-222222222221'),
     'about_excerpt', jsonb_build_object('heading', 'Om os', 'text', 'Placeholder')),
       draft = null
 where key = 'home';

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

/** The current version token of a dish, for the next call. */
create function pg_temp.version_of(p_id uuid) returns timestamptz language sql stable as $fn$
  select updated_at from public.dishes where id = p_id;
$fn$;

/**
 * Everything about a dish that this operation must never touch.
 *
 * Named column by column rather than taken as `to_jsonb(row)`: the two columns the
 * operation *does* change would otherwise make every comparison fail, and hiding them
 * behind an exclusion list is how a third column quietly joins them. `draft` and
 * `sold_out_on` are deliberately *in* the list — preserving them is the promise.
 */
create function pg_temp.untouched(p_id uuid) returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'category_id', d.category_id, 'name', d.name, 'description', d.description,
    'secondary_note', d.secondary_note, 'price_ore', d.price_ore, 'labels', to_jsonb(d.labels),
    'details', d.details, 'image_id', d.image_id, 'sort_order', d.sort_order,
    'sold_out_on', d.sold_out_on, 'sold_out_changed_by', d.sold_out_changed_by,
    'is_new_draft', d.is_new_draft, 'draft', d.draft, 'created_at', d.created_at)
  from public.dishes d where d.id = p_id;
$fn$;

/** The published Forside document, which no deletion may alter. */
create function pg_temp.home_document() returns jsonb language sql stable as $fn$
  select published from public.pages where key = 'home';
$fn$;


-- ===========================================================================
-- 1. The shape of the functions themselves (§8)
-- ===========================================================================

select ok(
  not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_dish_deleted'),
  'set_dish_deleted is SECURITY INVOKER, so RLS re-checks the caller');

select ok(
  (select coalesce(p.proconfig, '{}') @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_dish_deleted'),
  'set_dish_deleted pins search_path to the empty string');

select is_empty(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('set_dish_deleted', 'dish_deletion')
        and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon holds EXECUTE on neither the deletion function nor its audit shape');

-- The deletion path must stay out of the publish machinery, and out of the availability
-- one, in both directions.
select ok(
  (select prosrc not like '%deleted\_at%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'publish_dish'),
  'publish_dish still does not mention deleted_at — the paths stay separate');

-- With its explanatory comments stripped, so the assertion is about the statements the
-- database runs rather than about the prose beside them.
select ok(
  (select regexp_replace(prosrc, '--.*', '', 'gn') !~ '(sold_out_on|draft|is_new_draft|price_ore)'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_dish_deleted'),
  'no statement in set_dish_deleted names sold_out_on, draft, is_new_draft or price_ore');

-- The permission boundary, at the level of the SQL itself: no function in this schema
-- may give a Staff member a privilege-elevated way to write pages.home. Every
-- SECURITY DEFINER function in the schema is listed and checked for it.
select is_empty(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and p.prosrc like '%public.pages%' $$,
  'no SECURITY DEFINER function in the schema writes public.pages');

select ok(
  (select prosrc not like '%pages%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_dish_deleted'),
  'set_dish_deleted does not mention pages at all');

select ok(
  (select prosrc !~* '\mdelete\s+from\M'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_dish_deleted'),
  'set_dish_deleted contains no DELETE statement — the row always survives');


-- ===========================================================================
-- 2. Anonymous can reach none of it (§5, §8)
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  $$ select public.set_dish_deleted(
       '22222222-2222-4222-8222-222222222221'::uuid, true, now()) $$,
  '42501', null, 'anon cannot call set_dish_deleted');

select throws_ok(
  $$ update public.dishes set deleted_at = now() $$,
  '42501', null, 'anon cannot write dishes.deleted_at directly either');

select throws_ok(
  $$ delete from public.dishes $$,
  '42501', null, 'anon cannot delete a dish row');

reset role;

select is(
  (select deleted_at from public.dishes where name = 'Odin'),
  null::timestamptz,
  'the dish is still present after the anonymous attempts');


-- ===========================================================================
-- 3. Staff soft-deletes the featured, draft-bearing, sold-out dish (§6)
-- ===========================================================================

select set_config('test.odin_before', pg_temp.untouched('22222222-2222-4222-8222-222222222221')::text, true);
select set_config('test.home_before', pg_temp.home_document()::text, true);

select pg_temp.become_staff();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222221'::uuid, true,
     pg_temp.version_of('22222222-2222-4222-8222-222222222221')) ->> 'status'),
  'deleted',
  'staff can soft-delete a dish');

reset role;

select isnt(
  (select deleted_at from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'deleted_at was stamped');

select is(
  (select deleted_by from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  current_setting('test.staff_uid')::uuid,
  'deleted_by is the staff member from the JWT, not a parameter');

-- The row is still there. That is the whole of "soft".
select is(
  (select count(*) from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  1::bigint,
  'the row itself still exists');

-- The negative promise: everything else about the dish is exactly as it was, including
-- the draft somebody left in progress and the sold-out marking from earlier today.
select is(
  pg_temp.untouched('22222222-2222-4222-8222-222222222221'),
  current_setting('test.odin_before')::jsonb,
  'no other column moved — not price, name, category, labels, sold_out_on or draft');

select isnt(
  (select draft from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'the draft is still stored, whole');

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  (now() at time zone 'Europe/Copenhagen')::date,
  'and so is the sold-out marking');


-- ===========================================================================
-- 4. The Forside document is untouched — the permission boundary (§5, §7e item 4)
-- ===========================================================================

select is(
  pg_temp.home_document(),
  current_setting('test.home_before')::jsonb,
  'pages.home is byte-identical after a staff member deleted a dish it features');

select is(
  (select jsonb_array_length(published -> 'featured_dish_ids') from public.pages where key = 'home'),
  1,
  'the Forside still names three-of-three references — nothing was nulled behind the Owner''s back');

select is(
  (select published -> 'featured_dish_ids' ->> 0 from public.pages where key = 'home'),
  '22222222-2222-4222-8222-222222222221',
  'and the stale reference is still exactly the id the Owner wrote');

-- Tried directly, not merely reasoned about: a Staff member cannot write the row.
select pg_temp.become_staff();

select is(
  (select count(*) from public.pages where key = 'home'),
  1::bigint,
  'staff may READ the Forside document — which is all the warning needs');

-- RLS filters rows rather than raising: a policy whose USING clause is false makes the
-- row invisible to the UPDATE, so the statement succeeds and changes nothing. That is
-- the shape of the refusal, and it is what is asserted — an assertion that expected an
-- exception would pass for the wrong reason the day the policy disappeared.
update public.pages
   set published = published || jsonb_build_object('featured_dish_ids', '[]'::jsonb)
 where key = 'home';

select is(
  (select published -> 'featured_dish_ids' ->> 0 from public.pages where key = 'home'),
  '22222222-2222-4222-8222-222222222221',
  'a staff UPDATE of pages.home matches no row — the Owner''s value stands, before or after deleting a dish it features');

select is(
  (select public.publish_page(
     (select id from public.pages where key = 'home'),
     (select updated_at from public.pages where key = 'home')) ->> 'status'),
  'nothing_to_publish',
  'and staff cannot reach the Forside through the publish function either');

reset role;

select is(
  pg_temp.home_document(),
  current_setting('test.home_before')::jsonb,
  'the Forside document is still exactly as the Owner left it');


-- ===========================================================================
-- 5. The audit row (§8, §10)
-- ===========================================================================

select is(
  (select count(*) from public.audit_log where action = 'delete'),
  1::bigint,
  'exactly one delete audit row was written');

select is(
  (select actor_id from public.audit_log where action = 'delete'),
  current_setting('test.staff_uid')::uuid,
  'the audit actor is the staff member, taken from the JWT');

select is(
  (select entity from public.audit_log where action = 'delete'),
  'dish',
  'the audit row names the dish entity');

select is(
  (select entity_id from public.audit_log where action = 'delete'),
  '22222222-2222-4222-8222-222222222221'::uuid,
  'the audit row names the dish that was deleted');

select is(
  (select before ->> 'deleted_at' from public.audit_log where action = 'delete'),
  null,
  'the before value records that the dish was present');

select isnt(
  (select after ->> 'deleted_at' from public.audit_log where action = 'delete'),
  null,
  'the after value records the instant it was removed');

select set_config('test.delete_audit_id',
  (select id from public.audit_log where action = 'delete')::text, true);

-- Staff must not gain general read access to the log by being able to write to it (§5).
select pg_temp.become_staff();
select is_empty(
  $$ select id from public.audit_log $$,
  'staff still cannot read audit_log');
reset role;

select pg_temp.become_owner();
select isnt_empty(
  $$ select id from public.audit_log where action = 'delete' $$,
  'the owner can read the deletion entry');
reset role;


-- ===========================================================================
-- 6. The public site, and the pending list (§4, §6)
-- ===========================================================================

select pg_temp.become_anon();

select is_empty(
  $$ select id from public.dishes where name = 'Odin' $$,
  'a soft-deleted dish is invisible to an anonymous reader');

select isnt_empty(
  $$ select id from public.dishes where name = 'Thor' $$,
  'and the dishes beside it are unaffected');

reset role;

select pg_temp.become_staff();

select is_empty(
  $$ select entity_id from public.pending_changes
      where entity = 'dish' and entity_id = '22222222-2222-4222-8222-222222222221' $$,
  'a deleted dish is not a pending change, even though it still carries a draft');

reset role;


-- ===========================================================================
-- 7. Pressing it twice is one decision, and a conflict changes nothing (§6)
-- ===========================================================================

select pg_temp.become_staff();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222221'::uuid, true,
     pg_temp.version_of('22222222-2222-4222-8222-222222222221')) ->> 'status'),
  'unchanged',
  'deleting an already-deleted dish reports unchanged');

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222221'::uuid, false,
     now() - interval '1 hour') ->> 'status'),
  'conflict',
  'a version token from an hour ago is refused');

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222221'::uuid, false, null) ->> 'status'),
  'conflict',
  'a missing version token is refused rather than treated as a match');

select is(
  (select public.set_dish_deleted(
     '00000000-0000-4000-8000-000000000000'::uuid, true, now()) ->> 'status'),
  'not_found',
  'a dish id that names nothing is refused without touching anything');

reset role;

select isnt(
  (select deleted_at from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null,
  'the conflicted restore left the dish deleted');

select is(
  (select count(*) from public.audit_log where action in ('delete', 'restore')),
  1::bigint,
  'and neither the repeat nor the conflicts wrote a false success into the log');


-- ===========================================================================
-- 8. Restore — the Owner may do it, and it is an ordinary second write (§5, §6)
-- ===========================================================================

select pg_temp.become_owner();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222221'::uuid, false,
     pg_temp.version_of('22222222-2222-4222-8222-222222222221')) ->> 'status'),
  'restored',
  'the owner can restore a dish a staff member deleted');

reset role;

select is(
  (select deleted_at from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null::timestamptz,
  'deleted_at is cleared');

select is(
  (select deleted_by from public.dishes where id = '22222222-2222-4222-8222-222222222221'),
  null::uuid,
  'and so is the attribution, so the row does not claim to be deleted by anyone');

select is(
  pg_temp.untouched('22222222-2222-4222-8222-222222222221'),
  current_setting('test.odin_before')::jsonb,
  'after a delete and a restore the rest of the dish is exactly as it started');

select is(
  (select count(*) from public.audit_log where action = 'restore'),
  1::bigint,
  'the restore is a real write and has its own audit row');

select is(
  (select actor_id from public.audit_log where action = 'restore'),
  current_setting('test.owner_uid')::uuid,
  'attributed to the owner who made it');

select isnt(
  (select before ->> 'deleted_at' from public.audit_log where action = 'restore'),
  null,
  'the restore records what it undid');

select is(
  (select after ->> 'deleted_at' from public.audit_log where action = 'restore'),
  null,
  'and what it left behind');

select pg_temp.become_anon();
select isnt_empty(
  $$ select id from public.dishes where name = 'Odin' $$,
  'a restored published dish is public again');
reset role;

select pg_temp.become_staff();
select isnt_empty(
  $$ select entity_id from public.pending_changes
      where entity = 'dish' and entity_id = '22222222-2222-4222-8222-222222222221' $$,
  'and its draft is a pending change again');
reset role;

select is(
  pg_temp.home_document(),
  current_setting('test.home_before')::jsonb,
  'the Forside document was not touched by the restore either — so the old reference resolves again');


-- ===========================================================================
-- 9. A dish that was never published (§4, §8 of the phase brief)
-- ===========================================================================

select set_config('test.loke_before', pg_temp.untouched('22222222-2222-4222-8222-222222222223')::text, true);

select pg_temp.become_anon();
select is_empty(
  $$ select id from public.dishes where name = 'Loke' $$,
  'an unpublished dish is invisible before it is deleted');
reset role;

select pg_temp.become_staff();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222223'::uuid, true,
     pg_temp.version_of('22222222-2222-4222-8222-222222222223')) ->> 'status'),
  'deleted',
  'an unpublished dish is soft-deleted, not removed');

reset role;

select is(
  (select count(*) from public.dishes where id = '22222222-2222-4222-8222-222222222223'),
  1::bigint,
  'its row survives, so Fortryd has something to restore');

select pg_temp.become_staff();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222223'::uuid, false,
     pg_temp.version_of('22222222-2222-4222-8222-222222222223')) ->> 'status'),
  'restored',
  'and it can be restored');

reset role;

select is(
  pg_temp.untouched('22222222-2222-4222-8222-222222222223'),
  current_setting('test.loke_before')::jsonb,
  'restored to exactly the unpublished draft state it was in, is_new_draft included');

select pg_temp.become_anon();
select is_empty(
  $$ select id from public.dishes where name = 'Loke' $$,
  'a restored unpublished dish stays non-public — restoring is not publishing');
reset role;


-- ===========================================================================
-- 10. The sold-out guard does not block a write to a different column (§4, §7b)
-- ===========================================================================
--
-- §7b lets `sold_out_on` go stale by design. Before phase 5D the ±1-day guard read the
-- new row unconditionally, so a dish marked sold out last week could not be deleted,
-- restored or published at all. The guard now checks a value only when that value is
-- changing — which is what its own header always said it did.

-- Putting a ten-day-old date in the column is exactly what the guard forbids *writing*,
-- so the fixture is created with the guard suspended — the situation being tested is a
-- value that arrived legitimately ten days ago and has sat there since (§7b). Suspended
-- inside this transaction only; the rollback at the end restores it either way.
alter table public.dishes disable trigger dishes_sold_out_guard;
update public.dishes
   set sold_out_on = (now() at time zone 'Europe/Copenhagen')::date - 10
 where id = '22222222-2222-4222-8222-222222222222';
alter table public.dishes enable trigger dishes_sold_out_guard;

select pg_temp.become_staff();

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222222'::uuid, true,
     pg_temp.version_of('22222222-2222-4222-8222-222222222222')) ->> 'status'),
  'deleted',
  'a dish marked sold out ten days ago can still be deleted');

select is(
  (select public.set_dish_deleted(
     '22222222-2222-4222-8222-222222222222'::uuid, false,
     pg_temp.version_of('22222222-2222-4222-8222-222222222222')) ->> 'status'),
  'restored',
  'and restored');

-- The guard itself is unchanged for a value that *is* being written.
select throws_ok(
  $$ update public.dishes
        set sold_out_on = (now() at time zone 'Europe/Copenhagen')::date + 400
      where id = '22222222-2222-4222-8222-222222222222' $$,
  '23514', null,
  'writing a sold-out date far from today is still refused');

reset role;

select is(
  (select sold_out_on from public.dishes where id = '22222222-2222-4222-8222-222222222222'),
  (now() at time zone 'Europe/Copenhagen')::date - 10,
  'and the stale date is still exactly where it was');


-- ===========================================================================
-- 11. `anon` cannot read the new attribution column (§8)
-- ===========================================================================

select is_empty(
  $$ select 1
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'dishes'
        and column_name = 'deleted_by' and grantee = 'anon' $$,
  'anon holds no privilege on dishes.deleted_by');


select * from finish();
rollback;
