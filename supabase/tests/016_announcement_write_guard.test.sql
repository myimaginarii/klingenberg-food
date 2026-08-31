-- Klingenberg Food — pgTAP: who may write which announcement column (§5, §6, §8, §9).
--
-- The 8C-1 hardening pass. 8C-1 shipped `restore_announcement()`, which reads
-- `previous` from the row and publishes whatever it finds there — and the report that
-- accepted it recorded one thing left open:
--
--     "Staff currently have a broad, table-level UPDATE capability on
--      public.announcement. Internal lifecycle fields such as `previous` and
--      `replaced_at` can be modified directly through the database/API, outside the
--      trusted replacement and restore functions."
--
-- This suite is that hole, asserted shut from real Staff and Owner JWTs. It asserts,
-- in order:
--
--    1. **the grant is column-level and closed** — `authenticated` may UPDATE eleven
--       named columns and no others; `id`, `is_singleton`, `created_at`, `updated_at`
--       and `updated_by` are not among them, and `anon` may UPDATE nothing at all;
--    2. **the guard exists and is SECURITY INVOKER**, and none of the five functions
--       involved became SECURITY DEFINER to make any of this work;
--    3. **every published, visibility, provenance and lifecycle column refuses a
--       direct write**, from Staff and from Owner, with the value unchanged after;
--    4. **the identity and attribution columns refuse one at the privilege layer**,
--       while `announcement_touch` goes on stamping them;
--    5. **the attack the brief names, run end to end**: forge a `previous`, then call
--       `restore_announcement()` to publish it. The forge is refused, the row is
--       untouched, nothing is logged, and the restore that follows has nothing to
--       restore;
--    6. **the legitimate draft editor is unharmed** — `saveEntityDraft()`'s exact
--       statement, for Staff and for Owner;
--    7. **SECURITY INVOKER still works**: all four lifecycle functions, from both
--       identities, over a full A → replace → restore cycle with a pending draft
--       surviving it;
--    8. **the marker is single-use and does not leak** — neither a successful RPC nor
--       one that wrote nothing leaves a transaction able to make a direct write.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–015.

begin;
create extension if not exists pgtap with schema extensions;

select plan(82);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;

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

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.announcement limit 1
$fn$;

create function pg_temp.audit_total() returns bigint language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

/*
 * The whole row, minus the two columns a legitimate write is *expected* to move, as
 * one jsonb value. Every refusal below is asserted twice — the raise, and this being
 * identical afterwards — for the reason 002 records: an assertion that only checks
 * "it threw" would pass against a table that had already been written to.
 */
create function pg_temp.row_state() returns jsonb language sql security definer set search_path = ''
as $fn$
  select to_jsonb(a) - 'updated_at' - 'updated_by' from public.announcement a limit 1
$fn$;

/*
 * "Message A": published, visible, manual, with a pending manual draft behind it —
 * the same fixture shape 015 uses, so the two suites describe one system.
 *
 * SECURITY DEFINER, so it runs as the table owner. That is not an exemption the guard
 * grants a session: `tg_guard_announcement_write()` steps aside for `postgres` and
 * `service_role` because a migration, `supabase/seed.sql` and a fixture are not
 * browser sessions — and `authenticated` is a member of neither role, so it cannot
 * put that exemption on. Everything this suite actually asserts runs as a real JWT.
 */
create function pg_temp.reset_fixture() returns void language sql security definer set search_path = '' as $fn$
  update public.announcement
     set message     = 'Besked A — den der stod der',
         link_type   = 'page',
         link_page   = '/menu',
         link_url    = null,
         link_label  = 'Se menuen',
         expires_at  = now() + interval '3 days',
         is_visible  = true,
         source      = 'manual',
         previous    = null,
         replaced_at = null,
         draft       = jsonb_build_object('message', 'Kladde C — endnu ikke offentliggjort');
$fn$;

select pg_temp.reset_fixture();


-- ===========================================================================
-- 1. The grant is column-level, and closed
-- ===========================================================================
--
-- Eleven columns, and they are not a wish list: ten of them are there only because
-- PostgreSQL requires the *caller* of a SECURITY INVOKER function to hold the
-- privilege the function's UPDATE needs. `draft` is the one that is genuinely the
-- caller's. Section 3 is what decides when the other ten may move.

select set_eq(
  $$ select column_name::text
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'announcement'
        and grantee = 'authenticated' and privilege_type = 'UPDATE' $$,
  array['draft', 'message', 'link_type', 'link_page', 'link_url', 'link_label',
        'expires_at', 'is_visible', 'source', 'previous', 'replaced_at'],
  'authenticated may UPDATE exactly eleven named columns — the table-level grant is gone');

select ok(not has_column_privilege('authenticated', 'public.announcement', 'id', 'UPDATE'),
  'and not id — identity, not content');
select ok(not has_column_privilege('authenticated', 'public.announcement', 'is_singleton', 'UPDATE'),
  'and not is_singleton — there is one row and it is not being recreated');
select ok(not has_column_privilege('authenticated', 'public.announcement', 'created_at', 'UPDATE'),
  'and not created_at');
select ok(not has_column_privilege('authenticated', 'public.announcement', 'updated_at', 'UPDATE'),
  'and not updated_at — the optimistic-concurrency token (§6) is not a caller''s to choose');
select ok(not has_column_privilege('authenticated', 'public.announcement', 'updated_by', 'UPDATE'),
  'and not updated_by — attribution comes from the JWT (§8)');

select is(
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'announcement'
      and grantee = 'anon' and privilege_type = 'UPDATE'),
  0::bigint,
  'anon may UPDATE nothing at all — its grant is six SELECT columns and no more');

-- Reading is untouched by this pass. The editor overlays a draft, shows the pending
-- band and (from 8C-3) will report what a replacement displaced, so it reads `draft`
-- and `previous` — it just may no longer write either one arbitrarily.
select ok(has_column_privilege('authenticated', 'public.announcement', 'previous', 'SELECT'),
  'authenticated may still read previous — this pass narrowed writing, not reading');


-- ===========================================================================
-- 2. The guard, and the SECURITY INVOKER model it exists to preserve
-- ===========================================================================

select ok(
  (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'announcement'
      and t.tgname = 'announcement_guard_write' and not t.tgisinternal) = 1,
  'the write guard is a BEFORE UPDATE trigger on public.announcement');

select ok(
  (select t.tgenabled from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'announcement'
      and t.tgname = 'announcement_guard_write') = 'O',
  'and it is enabled');

-- The point of the whole exercise. Column privileges cannot separate "written by
-- replace_announcement()" from "written by curl", because a SECURITY INVOKER function
-- runs with the caller's privileges and PostgreSQL has no per-function table grant.
-- The answer to that must not be to make the functions SECURITY DEFINER, which would
-- take the entire announcement lifecycle out from under RLS.
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_announcement', 'set_announcement_visible',
                        'replace_announcement', 'restore_announcement',
                        'tg_guard_announcement_write')
      and p.prosecdef),
  0::bigint,
  'none of the four lifecycle functions, and not the guard either, is SECURITY DEFINER');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('publish_announcement', 'set_announcement_visible',
                        'replace_announcement', 'restore_announcement',
                        'tg_guard_announcement_write')
      and p.proconfig @> array['search_path=""']),
  5::bigint,
  'and all five still pin search_path to nothing');


-- ===========================================================================
-- 3. A direct write refuses every column the lifecycle owns — Staff
-- ===========================================================================
--
-- These are the PostgREST-equivalent statements: exactly what
-- `supabase.from('announcement').update({...})` issues, run from the Staff session's
-- own JWT. Each is asserted twice — the refusal, and the row afterwards.

select pg_temp.reset_fixture();
select set_config('test.before', pg_temp.row_state()::text, true);
select pg_temp.become_staff();

select throws_ok(
  $$ update public.announcement set previous = '{"message":"forfalsket"}'::jsonb $$,
  '42501', null, 'staff cannot write previous directly');

select throws_ok(
  $$ update public.announcement set replaced_at = now() $$,
  '42501', null, 'staff cannot write replaced_at directly');

select throws_ok(
  $$ update public.announcement set message = 'Direkte skrevet besked' $$,
  '42501', null, 'staff cannot write the published message directly');

select throws_ok(
  $$ update public.announcement set link_type = 'url', link_page = null,
                                    link_url = 'https://eksempel.test' $$,
  '42501', null, 'staff cannot rewrite the published link directly');

select throws_ok(
  $$ update public.announcement set link_label = 'Andet linktekst' $$,
  '42501', null, 'staff cannot rewrite the published link label directly');

select throws_ok(
  $$ update public.announcement set expires_at = now() + interval '400 days' $$,
  '42501', null, 'staff cannot extend the published expiry directly');

select throws_ok(
  $$ update public.announcement set is_visible = false $$,
  '42501', null, 'staff cannot switch the bar off directly — that is set_announcement_visible()');

select throws_ok(
  $$ update public.announcement set source = 'opening_hours' $$,
  '42501', null, 'staff cannot claim a message was generated by the opening hours');

reset role;
select is(pg_temp.row_state(), current_setting('test.before')::jsonb,
  'and not one of the eight refusals moved anything');
select is(pg_temp.audit_total(), 0::bigint,
  'nor logged anything — a refusal is not an event');


-- ===========================================================================
-- 4. The same for an Owner (§5: the announcement is in both rows of the matrix)
-- ===========================================================================
--
-- An Owner is not more trusted than Staff with these columns. The lifecycle is the
-- lifecycle: both identities reach the published state through the same four
-- functions, and neither reaches it any other way.

select pg_temp.become_owner();

select throws_ok(
  $$ update public.announcement set previous = '{"message":"forfalsket"}'::jsonb $$,
  '42501', null, 'owner cannot write previous directly either');
select throws_ok(
  $$ update public.announcement set replaced_at = now() $$,
  '42501', null, 'owner cannot write replaced_at directly either');
select throws_ok(
  $$ update public.announcement set message = 'Ejerens direkte besked' $$,
  '42501', null, 'owner cannot write the published message directly either');
select throws_ok(
  $$ update public.announcement set is_visible = false $$,
  '42501', null, 'owner cannot switch the bar off directly either');

reset role;
select is(pg_temp.row_state(), current_setting('test.before')::jsonb,
  'and the Owner refusals moved nothing either');


-- ===========================================================================
-- 5. Identity and attribution refuse at the privilege layer
-- ===========================================================================
--
-- These five need no trigger: they are simply not in the grant. `updated_at` is the
-- concurrency token §6 rests on and `updated_by` is who §8 says did it — a session
-- that could write either could defeat a colleague's conflict detection or sign
-- somebody else's name to a change.

select pg_temp.become_staff();

select throws_ok(
  $$ update public.announcement set updated_at = now() - interval '1 year' $$,
  '42501', null, 'staff cannot forge the concurrency token');
select throws_ok(
  $$ update public.announcement set updated_by = null $$,
  '42501', null, 'staff cannot erase the actor');
select throws_ok(
  $$ update public.announcement set created_at = now() $$,
  '42501', null, 'staff cannot rewrite created_at');
select throws_ok(
  $$ update public.announcement set id = gen_random_uuid() $$,
  '42501', null, 'staff cannot re-identify the row');
select throws_ok(
  $$ update public.announcement set is_singleton = false $$,
  '42501', null, 'staff cannot escape the singleton');

reset role;


-- ===========================================================================
-- 6. The legitimate draft editor is unharmed
-- ===========================================================================
--
-- `saveEntityDraft()`'s statement, exactly: one column, the version token in the WHERE
-- clause, `updated_at` selected back. It is the only direct write the application
-- makes to this table, and it must keep working — a hardening pass that broke the
-- editor would have moved the problem rather than solved it.

select pg_temp.reset_fixture();
select set_config('test.version', pg_temp.version()::text, true);
select pg_temp.become_staff();

select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object('message', 'Kladde D', 'link_type', 'none')
      where updated_at = current_setting('test.version')::timestamptz $$,
  'staff can still write a draft — the one column a direct write owns');

select is(
  (select draft ->> 'message' from public.announcement),
  'Kladde D',
  'and read it back');

select lives_ok(
  $$ update public.announcement set draft = null $$,
  'staff can still clear a draft (an edit reverted to the live value)');

reset role;
select pg_temp.reset_fixture();
select pg_temp.become_owner();

select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object('message', 'Ejerens kladde') $$,
  'owner can still write a draft');
select is(
  (select draft ->> 'message' from public.announcement),
  'Ejerens kladde',
  'and read it back');

reset role;

-- A draft is judged by the schema and by `publish_announcement()`, not by the guard:
-- the guard's whole claim is that `draft` is the caller's column. So a draft carrying
-- keys the system does not recognise is written happily here — and goes nowhere,
-- because `saveEntityDraft()` parses strictly on the way in and the publish merge
-- names its six fields literally. This is asserted so that a later reader does not
-- mistake the guard for a draft validator and remove one of those two.
select pg_temp.become_staff();
select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object('previous', jsonb_build_object('message', 'x'),
                                       'is_visible', true, 'source', 'opening_hours') $$,
  'a draft may contain any keys — the guard is not a draft validator');
reset role;
select is(pg_temp.row_state() ->> 'source', 'manual',
  'and none of those keys reached a column');
select is(pg_temp.row_state() ->> 'previous', null,
  'previous in particular is still null');


-- ===========================================================================
-- 7. THE ATTACK — a forged previous, then restore_announcement()
-- ===========================================================================
--
-- This is the scenario the brief names, run in full and from a real Staff JWT.
--
-- `restore_announcement()` is SECURITY INVOKER, validated, concurrency-checked and
-- audited — and it publishes whatever `previous` holds, without consulting `now()`,
-- without the payload checks `replace_announcement()` makes, and without the
-- showable checks `set_announcement_visible()` makes. Its safety therefore rests
-- entirely on `previous` being a value only `replace_announcement()` could have
-- written. Before the hardening pass it was not: this suite's own probe put a forged
-- snapshot in, and the restore published it under a `restore` audit entry.
--
-- `is_valid_announcement_snapshot()` cannot be the answer on its own, and this is the
-- point that matters: the forged snapshot below is *perfectly well-formed*. Eight
-- keys, right types, a link the CHECKs would accept, an expiry in the future. A shape
-- validator was never going to refuse it, because there is nothing wrong with its
-- shape — what is wrong is who wrote it.

select pg_temp.reset_fixture();
delete from public.audit_log;
select set_config('test.before', pg_temp.row_state()::text, true);

select ok(
  public.is_valid_announcement_snapshot(jsonb_build_object(
    'message',    'FORFALSKET — aldrig offentliggjort',
    'link_type',  'url',
    'link_page',  null,
    'link_url',   'https://forfalsket.test',
    'link_label', 'Klik her',
    'expires_at', (now() + interval '30 days')::text,
    'is_visible', true,
    'source',     'opening_hours')),
  'the forged snapshot is a *valid* snapshot — the shape validator cannot refuse it');

select pg_temp.become_staff();

-- Step 1 of the attack, and the step that now fails.
select throws_ok(
  $$ update public.announcement
        set previous = jsonb_build_object(
              'message',    'FORFALSKET — aldrig offentliggjort',
              'link_type',  'url',
              'link_page',  null,
              'link_url',   'https://forfalsket.test',
              'link_label', 'Klik her',
              'expires_at', (now() + interval '30 days')::text,
              'is_visible', true,
              'source',     'opening_hours'),
            replaced_at = now() $$,
  '42501',
  'announcement: previous and replaced_at are written only by replace_announcement() or restore_announcement()',
  'a staff member cannot manufacture a previous snapshot');

-- Step 2 has nothing to work with. Asserted anyway, because "the second step fails
-- too" is the property, not "the first step failed".
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'nothing_to_restore',
  'so the restore that was supposed to publish it has nothing to restore');

reset role;

select is(pg_temp.row_state(), current_setting('test.before')::jsonb,
  'the announcement is exactly as it was — nothing was forged and nothing was published');
select is(pg_temp.audit_total(), 0::bigint,
  'and nothing was logged: no forged restore in the audit trail either');

-- The same attack against a *real* stashed snapshot: tampering with a legitimate
-- `previous` between the replacement and the Fortryd. Same refusal, and the genuine
-- undo still works afterwards.
select pg_temp.reset_fixture();
delete from public.audit_log;
select pg_temp.become_staff();

select is(
  (select public.replace_announcement('Besked B — erstatningen', 'none', null, null, null,
     now() + interval '1 day', 'manual', pg_temp.version()) ->> 'status'),
  'replaced',
  'a genuine replacement stashes a genuine previous');

select throws_ok(
  $$ update public.announcement
        set previous = jsonb_set(previous, '{message}', '"OMSKREVET"'::jsonb) $$,
  '42501', null, 'and a staff member cannot rewrite that snapshot before the Fortryd');

select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'the genuine Fortryd still works');
select is(
  (select message from public.announcement),
  'Besked A — den der stod der',
  'and puts back the message that was actually displaced, not a rewritten one');

reset role;


-- ===========================================================================
-- 8. SECURITY INVOKER still works — all four functions, both identities
-- ===========================================================================
--
-- The critical regression. Narrowing the direct-write surface must not have narrowed
-- what the functions can do, because they run with the caller's privileges: every
-- column any of them writes is still a column `authenticated` holds UPDATE on, and
-- the guard is what decides when it may move.

-- --- Staff: draft → publish → hide → show ---
select pg_temp.reset_fixture();
delete from public.audit_log;
select pg_temp.become_staff();

select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object(
              'message',    'Besked E — offentliggjort',
              'link_type',  'none',
              'link_page',  null,
              'link_url',   null,
              'link_label', null,
              'expires_at', (now() + interval '2 days')::text) $$,
  'staff writes a draft');

select is(
  (select public.publish_announcement(
     (select id from public.announcement), pg_temp.version()) ->> 'status'),
  'published',
  'staff publishes it — publish_announcement() still holds the privileges it needs');

select is((select message from public.announcement), 'Besked E — offentliggjort',
  'the published message is live');
select is((select is_visible from public.announcement), true,
  'and Offentliggør made it visible');
select is((select draft from public.announcement), null,
  'and cleared the draft');

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'staff hides it — "Fjern beskeden nu"');
select is((select is_visible from public.announcement), false, 'the bar is off');

select is(
  (select public.set_announcement_visible(true, pg_temp.version()) ->> 'status'),
  'updated',
  'staff shows it again — the Fortryd write');
select is((select is_visible from public.announcement), true, 'the bar is back on');

reset role;
select is(pg_temp.audit_total(), 3::bigint,
  'three audit rows: one publish and two visibility changes');

-- --- Staff: replace and restore, with a pending draft that must survive both ---
select pg_temp.reset_fixture();
delete from public.audit_log;
select set_config('test.draft', (select draft::text from public.announcement), true);
select pg_temp.become_staff();

select is(
  (select public.replace_announcement('Besked B — erstatningen', 'url', null,
     'https://eksempel.test', 'Læs mere', now() + interval '1 day', 'opening_hours',
     pg_temp.version()) ->> 'replaced'),
  'active',
  'staff replaces the live announcement — replace_announcement() still works');

select is((select message from public.announcement), 'Besked B — erstatningen',
  'the replacement is live');
select is((select source from public.announcement), 'opening_hours',
  'with the source the trusted function was given');
select isnt((select replaced_at from public.announcement), null,
  'replaced_at is stamped');
select is(
  (select previous ->> 'message' from public.announcement),
  'Besked A — den der stod der',
  'and previous holds the announcement that was displaced');

select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'staff restores it — restore_announcement() still works');
select is((select message from public.announcement), 'Besked A — den der stod der',
  'Besked A is back');
select is((select previous from public.announcement), null, 'previous is cleared');
select is((select replaced_at from public.announcement), null, 'and so is replaced_at');

reset role;
select is((select draft::text from public.announcement), current_setting('test.draft'),
  'and the pending draft is byte-identical through the replacement and the restore');

-- --- Owner: the same four functions ---
select pg_temp.reset_fixture();
select pg_temp.become_owner();

select is(
  (select public.replace_announcement('Ejerens erstatning', 'none', null, null, null,
     now() + interval '1 day', 'manual', pg_temp.version()) ->> 'status'),
  'replaced',
  'owner may replace');
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'owner may restore');
select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'owner may hide');

reset role;
select pg_temp.reset_fixture();
select pg_temp.become_owner();
select is(
  (select public.publish_announcement(
     (select id from public.announcement), pg_temp.version()) ->> 'status'),
  'published',
  'owner may publish');
reset role;


-- ===========================================================================
-- 9. The marker is single use, and does not leak
-- ===========================================================================
--
-- The guard tells a lifecycle write from a direct one by a transaction-local setting
-- that each function raises immediately before its own UPDATE. Two things must be
-- true of it, and neither may be assumed: it must not survive the write it authorised,
-- and it must not survive a call that wrote nothing.
--
-- A PostgREST request is one transaction containing one operation, so a browser
-- session cannot reach a second statement in the same transaction to begin with —
-- but this suite is one long transaction, which makes it exactly the place to check.

select pg_temp.reset_fixture();
select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'a visibility change succeeds');
select throws_ok(
  $$ update public.announcement set is_visible = true $$,
  '42501', null,
  'and the marker it used is gone — the very next direct write is refused');

-- A call that writes nothing sets the marker and then finds no row. It must clear it
-- on the way out: `conflict` is the commonest reply this system gives, and a stale
-- token must not be a way to unlock the table.
select is(
  (select public.replace_announcement('Besked F', 'none', null, null, null,
     now() + interval '1 day', 'manual', now() - interval '1 year') ->> 'status'),
  'conflict',
  'a replacement with a stale version token writes nothing');
select throws_ok(
  $$ update public.announcement set previous = '{}'::jsonb $$,
  '42501', null,
  'and leaves no marker behind either — a conflict is not an opening');

-- A refusal that returns before the UPDATE never sets the marker at all.
select is(
  (select public.replace_announcement(null, 'none', null, null, null,
     now() + interval '1 day', 'manual', pg_temp.version()) ->> 'status'),
  'invalid_payload',
  'a replacement refused on its payload writes nothing');
select throws_ok(
  $$ update public.announcement set message = 'Direkte' $$,
  '42501', null, 'and leaves nothing behind either');

reset role;


-- ===========================================================================
-- 10. anon reaches none of it
-- ===========================================================================

select pg_temp.become_anon();

select throws_ok(
  $$ update public.announcement set draft = '{}'::jsonb $$,
  '42501', null, 'anon cannot write a draft — it holds no UPDATE at all');
select throws_ok(
  $$ update public.announcement set previous = '{}'::jsonb $$,
  '42501', null, 'anon cannot write previous');

reset role;

select * from finish();
rollback;
