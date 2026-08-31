-- Klingenberg Food — pgTAP: removing an override, and the announcement it may own
-- (§5, §6, §7e item 6, §8). **Phase 8C-3B.**
--
-- Two properties, and they are the two halves of one rule: *an override is removed by one
-- door, and that door takes the generated announcement with it.*
--
--   1. **The door is the only door.** Phase 1 granted `delete on
--      public.opening_hours_overrides to authenticated`, and it must keep it — a SECURITY
--      INVOKER function spends the *caller's* privileges, so revoking the grant would take
--      `remove_opening_hours_override()` away with the direct DELETE. `overrides_guard_delete`
--      is what makes the privilege spendable only by the trusted transition, and this suite
--      proves it from **real Staff and Owner JWTs** rather than from the schema.
--
--      Before this trigger existed, a direct PostgREST DELETE could remove an override
--      named only inside `announcement.previous.source_override_id` — jsonb, which no
--      foreign key reaches into — and turn the next Fortryd into `owner_missing`.
--      `017` records that status as *"reachable only through a direct PostgREST DELETE"*.
--      This suite is what closes that sentence.
--
--   2. **The door does both halves, or neither.** §7e item 6: *"Ask, and default to
--      removing the announcement too."* The asking is `owns_announcement` with nothing
--      written; the answering is one transaction that clears the message, its link, its
--      expiry, its visibility, its source and its ownership, deletes the override and
--      audits both — while leaving a pending **manual draft** and the recurring weekly
--      schedule untouched.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–017.

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures — the same shape as 017's
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

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.announcement limit 1
$fn$;

create function pg_temp.ov(p_id uuid) returns timestamptz language sql as $fn$
  select updated_at from public.opening_hours_overrides where id = p_id
$fn$;

create function pg_temp.audit_total() returns bigint
language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

/* The announcement row minus the two columns a legitimate write is expected to move. */
create function pg_temp.row_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(a) - 'updated_at' - 'updated_by' from public.announcement a limit 1
$fn$;

/* The published weekly schedule, so "the recurring week is untouched" is a real probe. */
create function pg_temp.week_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) - 'updated_at' - 'updated_by' from public.opening_hours h limit 1
$fn$;

insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
values (((now() at time zone 'Europe/Copenhagen')::date + 3), 'custom', '17:00', '19:00', 'published'),
       (((now() at time zone 'Europe/Copenhagen')::date + 4), 'closed', null, null, 'published');

select set_config('test.override_a',
  (select id from public.opening_hours_overrides
    where date = ((now() at time zone 'Europe/Copenhagen')::date + 3))::text, true);
select set_config('test.override_b',
  (select id from public.opening_hours_overrides
    where date = ((now() at time zone 'Europe/Copenhagen')::date + 4))::text, true);

create function pg_temp.a() returns uuid language sql as $fn$
  select current_setting('test.override_a')::uuid
$fn$;
create function pg_temp.b() returns uuid language sql as $fn$
  select current_setting('test.override_b')::uuid
$fn$;

/* Empty announcement, with a pending manual draft standing behind it. */
create function pg_temp.reset_empty() returns void
language sql security definer set search_path = '' as $fn$
  update public.announcement
     set message = null, link_type = 'none', link_page = null, link_url = null,
         link_label = null, expires_at = null, is_visible = false,
         source = 'manual', source_override_id = null,
         previous = null, replaced_at = null,
         draft = jsonb_build_object('message', 'Kladde C — endnu ikke offentliggjort');
$fn$;

create function pg_temp.apply(p_override uuid, p_message text, p_confirm boolean default false)
returns jsonb language sql as $fn$
  select public.apply_generated_announcement(
    p_override, pg_temp.ov(p_override), p_message,
    'page', '/find-os', null, 'Se tider',
    pg_catalog.now() + interval '2 days', pg_temp.version(), p_confirm)
$fn$;


-- ===========================================================================
-- 1. The model
-- ===========================================================================

select has_trigger('public', 'opening_hours_overrides', 'overrides_guard_delete',
  'a one-off change cannot be deleted without passing the guard');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tg_guard_override_delete'),
  false,
  'the guard is SECURITY INVOKER — it decides a transition, it does not lend a privilege');

select is(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tg_guard_override_delete'),
  array['search_path=""'],
  'and its search_path is pinned, like every other function in this schema');

-- The privilege is deliberately still there. This is the whole reason the trigger exists.
select ok(
  has_table_privilege('authenticated', 'public.opening_hours_overrides', 'DELETE'),
  'authenticated still holds DELETE — an invoker-rights function spends the caller''s privileges');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'remove_opening_hours_override'),
  1,
  'there is exactly one removal function — the old two-argument signature was dropped, not overloaded');

select ok(
  has_function_privilege('authenticated', 'public.remove_opening_hours_override(uuid, timestamptz, boolean)', 'EXECUTE'),
  'staff and owner may call it');

select ok(
  not has_function_privilege('anon', 'public.remove_opening_hours_override(uuid, timestamptz, boolean)', 'EXECUTE'),
  'and a guest may not');

/*
 * The count this repository keeps: nothing added here is SECURITY DEFINER. The two
 * legitimate ones are phase 1's `log_audit` and its role helpers; the assertion is that
 * 8C-3B added none, which is the brief's own constraint.
 */
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in ('tg_guard_override_delete', 'tg_guard_announcement_write',
                        'remove_opening_hours_override', 'apply_generated_announcement',
                        'replace_announcement', 'restore_announcement')),
  0,
  'no lifecycle function anywhere in this workflow is SECURITY DEFINER');


-- ===========================================================================
-- 2. The direct DELETE, from real JWTs
-- ===========================================================================

select pg_temp.become_staff();

select throws_ok(
  format($$ delete from public.opening_hours_overrides where id = %L $$, pg_temp.a()),
  '42501',
  null,
  'a staff member cannot delete a one-off change directly');

reset role;
select is(
  (select count(*)::int from public.opening_hours_overrides where id = pg_temp.a()),
  1,
  'and the row is still there — the refusal deleted nothing');

select pg_temp.become_owner();

select throws_ok(
  format($$ delete from public.opening_hours_overrides where id = %L $$, pg_temp.a()),
  '42501',
  null,
  'and neither can an owner: the guard is about the transition, not about the role');

-- The whole table, not one row: a `where` clause somebody could widen must not be a way
-- past the trigger, which fires per row.
select throws_ok(
  $$ delete from public.opening_hours_overrides $$,
  '42501',
  null,
  'a DELETE with no id is refused too — the guard is per row, not per statement');

reset role;
select is(
  (select count(*)::int from public.opening_hours_overrides),
  2,
  'both overrides survive');

select is(pg_temp.audit_total(), 0::bigint,
  'and no audit row was written: a refusal is not an event');

select pg_temp.become_anon();
select throws_ok(
  $$ delete from public.opening_hours_overrides $$,
  null,
  null,
  'a guest is refused as well, by RLS or by the guard — either way nothing is deleted');
reset role;


-- ===========================================================================
-- 3. The trusted removal, when nothing is owned
-- ===========================================================================

select pg_temp.reset_empty();
select set_config('test.week_before', pg_temp.week_state()::text, true);

select pg_temp.become_staff();

select is(
  (select public.remove_opening_hours_override(pg_temp.b(), pg_temp.ov(pg_temp.b()), false) ->> 'status'),
  'removed',
  'an override that owns nothing is removed, exactly as phase 8B removed it');

reset role;
select is(
  (select count(*)::int from public.opening_hours_overrides where id = pg_temp.b()),
  0,
  'and it is gone');

select is(
  (select count(*)::int from public.audit_log
    where entity = 'opening_hours_override' and action = 'delete'),
  1,
  'audited once');

select is(
  (select count(*)::int from public.audit_log where entity = 'announcement'),
  0,
  'and the announcement was not touched — there was nothing to take down');


-- ===========================================================================
-- 4. §7e item 6 — the question, and the answer
-- ===========================================================================

select pg_temp.become_staff();
select is((select pg_temp.apply(pg_temp.a(), 'Ændrede åbningstider') ->> 'status'), 'applied',
  'A now owns the announcement a guest is reading');

reset role;
select set_config('test.state_before', pg_temp.row_state()::text, true);
select set_config('test.audit_before', pg_temp.audit_total()::text, true);

select pg_temp.become_staff();

-- The question. Nothing is written for it.
select is(
  (select public.remove_opening_hours_override(pg_temp.a(), pg_temp.ov(pg_temp.a()), false) ->> 'status'),
  'owns_announcement',
  'removing it without confirming is refused — §7e item 6 asks first');

select is(
  (select public.remove_opening_hours_override(pg_temp.a(), pg_temp.ov(pg_temp.a()), false) ->> 'owns'),
  'current',
  'and says which hold it has: the message on the hjemmeside');

reset role;
select is(pg_temp.row_state(), current_setting('test.state_before')::jsonb,
  'the announcement is byte-identical: a question writes nothing');

select is(
  (select count(*)::int from public.opening_hours_overrides where id = pg_temp.a()),
  1,
  'the override is still there');

select is(pg_temp.audit_total(), current_setting('test.audit_before')::bigint,
  'and no audit row was written for a question');

-- A stale version token with the confirmation set: the refusal must reach the announcement
-- either. This is the atomicity property from the other side — the half that would run
-- first must not survive a failure of the half that runs second.
select pg_temp.become_staff();
select is(
  (select public.remove_opening_hours_override(
     pg_temp.a(), pg_temp.ov(pg_temp.a()) - interval '1 second', true) ->> 'status'),
  'conflict',
  'a stale token is refused even with the confirmation set');

reset role;
select is(pg_temp.row_state(), current_setting('test.state_before')::jsonb,
  'and the announcement is untouched — the two halves commit together or not at all');

-- The answer.
select pg_temp.become_staff();

create temp table removal as
  select public.remove_opening_hours_override(pg_temp.a(), pg_temp.ov(pg_temp.a()), true) as reply;

select is((select reply ->> 'status' from removal), 'removed',
  'confirming removes the override');

select is((select reply ->> 'removed_announcement' from removal), 'true',
  'and says the announcement came down with it');

reset role;

select is(
  (select count(*)::int from public.opening_hours_overrides where id = pg_temp.a()),
  0,
  'the override is gone');

select is((select message from public.announcement), null,
  'the generated message is gone — not merely hidden, so it cannot be switched back on');

select is((select is_visible from public.announcement), false,
  'the bar is not visible');

select is((select source from public.announcement), 'manual',
  'the source is back to manual');

select is((select source_override_id from public.announcement), null,
  'the ownership pointer is cleared');

select is((select expires_at from public.announcement), null,
  'and so is the expiry that belonged to hours nobody has');

select is((select link_type from public.announcement), 'none',
  'the link goes with the message it belonged to');

select is((select previous from public.announcement), null,
  'previous is cleared: nothing is left that a Fortryd could resurrect');

select is((select replaced_at from public.announcement), null,
  'and replaced_at with it');

select is(
  (select public.announcement_replacement_kind(a) from public.announcement a),
  'none',
  'the row is in the empty state the model already had a name for');

/*
 * The one thing that must survive, and the reason it is asserted here rather than trusted:
 * somebody may be halfway through writing an ordinary announcement at /admin/besked while
 * a colleague deletes a one-off opening-hours change. Their draft is not part of this
 * transaction and is never named by it.
 */
select is(
  (select draft ->> 'message' from public.announcement),
  'Kladde C — endnu ikke offentliggjort',
  'the pending manual draft is byte-identical — the removal never names `draft`');

select is(pg_temp.week_state(), current_setting('test.week_before')::jsonb,
  'and the recurring weekly schedule is untouched by all of it');

select is(
  (select count(*)::int from public.audit_log
    where entity = 'announcement' and action = 'remove_generated'),
  1,
  'the announcement half is audited under its own action');

select is(
  (select count(*)::int from public.audit_log
    where entity = 'opening_hours_override' and action = 'delete'),
  2,
  'and the override half under the one phase 8B already used');


-- ===========================================================================
-- 5. The guard is not a one-time gate
-- ===========================================================================
--
-- The marker `remove_opening_hours_override()` sets is consumed by the trigger and cleared
-- again by the function. A direct DELETE issued *after* a successful trusted removal, in
-- the same session and the same transaction, must still be refused — otherwise the marker
-- would be a door somebody could hold open.

insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
values (((now() at time zone 'Europe/Copenhagen')::date + 7), 'closed', null, null, 'published');

select pg_temp.become_staff();

select throws_ok(
  $$ delete from public.opening_hours_overrides
      where date = ((now() at time zone 'Europe/Copenhagen')::date + 7) $$,
  '42501',
  null,
  'the marker did not stay set: a later direct DELETE is refused just the same');

reset role;
select is(
  (select count(*)::int from public.opening_hours_overrides
    where date = ((now() at time zone 'Europe/Copenhagen')::date + 7)),
  1,
  'and that row survives too');


select * from finish();
rollback;
