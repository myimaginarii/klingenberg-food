-- Klingenberg Food — pgTAP: replacing and restoring the announcement (§4, §5, §6,
-- §7e item 8, §8, §9; design 1ae).
--
-- Phase 8C-1. One migration, four functions, and the two columns phases 1–8B left
-- deliberately unused: `announcement.previous` and `announcement.replaced_at`.
--
-- This suite asserts, from real Staff, Owner and anonymous JWTs, the properties the
-- application and phase 8C-3 will rely on:
--
--    1. **the snapshot shape** — `announcement_snapshot()` writes exactly eight keys
--       and never `draft`, never a nested `previous`, never `replaced_at`, never
--       `updated_at` and never `updated_by`; and `is_valid_announcement_snapshot()`
--       refuses everything that is not that shape;
--    2. **Staff may replace, and Owner may too** (§5's matrix has the announcement in
--       both rows), and `anon` may execute neither function;
--    3. **the snapshot stored in `previous` is exactly the published state that was
--       displaced** — content, link, expiry, visibility and source, byte for byte;
--    4. **the replacement is exact**, `replaced_at` is stamped, `source` is what the
--       caller passed from the closed vocabulary, and the bar is visible;
--    5. **the pending draft is byte-identical** through the replacement and through
--       the restore — a replacement is not a publish;
--    6. **one audit row per real write**, attributed from the JWT, carrying the
--       before/after snapshots; and **no audit row on any refusal**;
--    7. **a stale version token writes nothing and logs nothing**, in both directions;
--    8. **the restore reads the database**, not a parameter: `restore_announcement`
--       takes one argument, and it is the version token;
--    9. **the restore is exact**, and clears `previous` and `replaced_at` in the same
--       statement — so a second Fortryd is `nothing_to_restore` rather than a second
--       restore. One level, no stack;
--   10. **a malformed `previous` is refused safely** — nothing written, nothing logged,
--       and the malformed value left in place;
--   11. **an expired previous announcement is restored without its expiry being
--       moved**, and the reply says the result is not showable (§7 of the 8C-1 brief);
--   12. **a hidden previous announcement comes back hidden**, because its own
--       `is_visible` is part of the snapshot;
--   13. **the browser-authority properties**: the replacement takes typed scalars and
--       refuses an unapproved page, a non-https address, an inconsistent link shape, a
--       source outside the closed vocabulary, a blank or over-long message and a past
--       expiry — each with nothing written;
--   14. **no privilege escalation**: all four functions are SECURITY INVOKER; and
--   15. **unrelated tables are untouched** by a replacement and by a restore.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–014.

begin;
create extension if not exists pgtap with schema extensions;

select plan(134);

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

/*
 * The override a generated announcement belongs to — phase 8C-3A.
 *
 * `source = 'opening_hours'` now names exactly one published override
 * (`announcement_source_owner_check`), so every call below that exercises the generated
 * source has to have one to point at. It is created once, published, and dated ahead so
 * `overrides_select_public` and `readAdminOverrides` would both accept it.
 *
 * A *manual* replacement passes nothing at all and relies on the parameter's default —
 * which is the safe half of the pair, and is asserted as such further down.
 */
insert into public.opening_hours_overrides (date, kind, opens_at, closes_at, status)
values (((now() at time zone 'Europe/Copenhagen')::date + 5), 'custom', '17:00', '19:00', 'published');

select set_config('test.owner_override',
  (select id from public.opening_hours_overrides
    where date = ((now() at time zone 'Europe/Copenhagen')::date + 5))::text, true);

create function pg_temp.owner_override() returns uuid language sql as $fn$
  select current_setting('test.owner_override')::uuid
$fn$;

create function pg_temp.snapshot() returns jsonb language sql as $fn$
  select public.announcement_snapshot(a) from public.announcement a limit 1
$fn$;

create function pg_temp.previous() returns jsonb language sql as $fn$
  select previous from public.announcement limit 1
$fn$;

create function pg_temp.audit_total() returns bigint language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint language sql security definer set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'announcement' and action = p_action and actor_id = p_actor
$fn$;

create function pg_temp.audit_field(p_action text, p_side text, p_key text)
returns text language sql security definer set search_path = ''
as $fn$
  select case p_side when 'before' then before ->> p_key else after ->> p_key end
    from public.audit_log
   where entity = 'announcement' and action = p_action
   order by created_at desc limit 1
$fn$;

/*
 * "Message A": a published, currently visible, manual announcement with a pending
 * manual draft behind it.
 *
 * The draft is part of the fixture rather than an afterthought, because the property
 * that matters most in this suite is a negative one: a replacement is not a publish,
 * so a draft somebody was in the middle of writing must be byte-identical before the
 * replacement, after it, and after the restore.
 */
create function pg_temp.reset_fixture() returns void language sql security definer set search_path = '' as $fn$
  update public.announcement
     set message     = 'Besked A — den der stod der',
         link_type   = 'page',
         link_page   = '/menu',
         link_url    = null,
         link_label  = 'Se menuen',
         expires_at  = now() + interval '2 hours',
         is_visible  = true,
         source      = 'manual',
         source_override_id = null,
         previous    = null,
         replaced_at = null,
         draft       = jsonb_build_object('message', 'Kladde C der skal overleve');
$fn$;

/* Everything a replacement or a restore must be able to reproduce exactly. */
create function pg_temp.untouched() returns jsonb language sql as $fn$
  select (to_jsonb(a) - 'updated_at' - 'updated_by') from public.announcement a limit 1
$fn$;


-- ===========================================================================
-- 1. The snapshot shape (§4, and the 8C-1 brief's section 2)
-- ===========================================================================

select pg_temp.reset_fixture();

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.snapshot()) k),
  array['expires_at', 'is_visible', 'link_label', 'link_page',
        'link_type', 'link_url', 'message', 'source', 'source_override_id']::text[],
  'a snapshot has exactly the nine published keys');

select ok(not (pg_temp.snapshot() ? 'draft'),
  'and never the draft — a draft is not published content');
select ok(not (pg_temp.snapshot() ? 'previous'),
  'and never a nested previous — one level only (§4, 1ad)');
select ok(not (pg_temp.snapshot() ? 'replaced_at'),
  'and never replaced_at — that is a fact about the replacement, not about what it replaced');
select ok(not (pg_temp.snapshot() ? 'updated_at'),
  'and never updated_at — the concurrency token belongs to the row as it is now');
select ok(not (pg_temp.snapshot() ? 'updated_by'),
  'and never an actor id — attribution comes from the JWT (§8)');
select ok(not (pg_temp.snapshot() ? 'id'),
  'and never the row identity — there is one row and it is not being recreated');

select is(pg_temp.snapshot() ->> 'message', 'Besked A — den der stod der',
  'the snapshot carries the published message');
select is(pg_temp.snapshot() ->> 'link_page', '/menu', 'the published link');
select is(pg_temp.snapshot() ->> 'is_visible', 'true', 'the published visibility');
select is(pg_temp.snapshot() ->> 'source', 'manual', 'and the published source');

select ok(public.is_valid_announcement_snapshot(pg_temp.snapshot()),
  'the shape it writes is the shape it accepts');

-- What the validator refuses. Each of these is a way `previous` could be wrong.
select ok(not public.is_valid_announcement_snapshot(null), 'null is not a snapshot');
select ok(not public.is_valid_announcement_snapshot('"tekst"'::jsonb), 'a string is not a snapshot');
select ok(not public.is_valid_announcement_snapshot('[]'::jsonb), 'an array is not a snapshot');
select ok(not public.is_valid_announcement_snapshot('{}'::jsonb), 'an empty object is not a snapshot');

select ok(not public.is_valid_announcement_snapshot(pg_temp.snapshot() - 'source'),
  'a missing key is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('draft', jsonb_build_object('message', 'x'))),
  'an extra `draft` key is refused — a draft can never be stashed');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('previous', pg_temp.snapshot())),
  'a nested `previous` is refused — no recursive snapshots');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('updated_by', '00000000-0000-4000-8000-000000000000')),
  'an actor id is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('is_visible', 'true')),
  'a visibility that is a string rather than a boolean is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('source', 'et_eller_andet')),
  'a source outside the closed vocabulary is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('link_page', '/admin')),
  'an internal link outside the six approved routes is refused (§8)');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('link_type', 'url', 'link_page', null,
                                             'link_url', 'http://usikker.test/x')),
  'an http address is refused (§8)');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('link_url', 'https://andet.test')),
  'a link that is both a page and an address is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('message', repeat('x', 91))),
  'a message over 90 characters is refused');
select ok(
  not public.is_valid_announcement_snapshot(
    pg_temp.snapshot() || jsonb_build_object('expires_at', 'i morgen ved fyraften')),
  'an expiry that is not a timestamp is refused');


-- ===========================================================================
-- 2. Staff replaces an active announcement (§5, §6, 1ae)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;

select set_config('test.snapshot_a', pg_temp.snapshot()::text, true);
select set_config('test.draft_c', (select draft::text from public.announcement), true);
select set_config('test.expires_a', (select expires_at::text from public.announcement), true);

select pg_temp.become_staff();

select is(
  (select public.replace_announcement(
     'Besked B — den nye', 'none', null, null, null,
     now() + interval '3 hours', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced',
  'staff may replace the published announcement');

reset role;

-- --- what became public --------------------------------------------------------

select is((select message from public.announcement), 'Besked B — den nye',
  'the replacement message is live');
select is((select link_type from public.announcement), 'none',
  'and its link, exactly as passed — the page link of A is gone');
select is((select link_page from public.announcement), null, 'no leftover page link');
select is((select link_label from public.announcement), null, 'no leftover link label');
select is((select is_visible from public.announcement), true,
  'the replacement is visible — 1ae: "Den nye besked går live"');
select is((select source from public.announcement), 'opening_hours',
  'the source is the one the server-side caller passed, from the closed vocabulary');
select isnt((select replaced_at from public.announcement), null,
  'replaced_at is stamped');
select cmp_ok((select expires_at from public.announcement), '>', now(),
  'and the replacement carries its own future expiry');

-- --- what was stashed ----------------------------------------------------------

select is(pg_temp.previous(), current_setting('test.snapshot_a')::jsonb,
  'previous holds exactly the published state that was displaced — byte for byte');

select ok(public.is_valid_announcement_snapshot(pg_temp.previous()),
  'and it is a snapshot the restore will accept');

-- --- what was not touched ------------------------------------------------------

select is((select draft::text from public.announcement), current_setting('test.draft_c'),
  'the pending manual draft is byte-identical — a replacement is not a publish');

select is((select updated_by from public.announcement),
  current_setting('test.staff_uid')::uuid,
  'the row is attributed to the staff member who replaced it, from the JWT');

-- --- what the log says ---------------------------------------------------------

select is(pg_temp.audit_count('replace', current_setting('test.staff_uid')::uuid), 1::bigint,
  'exactly one audit row, attributed to whoever pressed it');
select is(pg_temp.audit_total(), 1::bigint, 'and nothing else was logged');

select is(pg_temp.audit_field('replace', 'before', 'message'), 'Besked A — den der stod der',
  'the audit row says what was replaced');
select is(pg_temp.audit_field('replace', 'after', 'message'), 'Besked B — den nye',
  'and what became public');
select is(pg_temp.audit_field('replace', 'after', 'source'), 'opening_hours',
  'including the source it became');

-- --- what a guest reads --------------------------------------------------------

select pg_temp.become_anon();
select is((select message from public.announcement), 'Besked B — den nye',
  'a guest reads the replacement');
select is((select count(*) from public.announcement), 1::bigint,
  'and exactly one announcement — there is never a second bar (1ac)');
reset role;


-- ===========================================================================
-- 3. The restore reads the database, and is exact (§6, 1ae)
-- ===========================================================================

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'restore_announcement'
      and p.pronargs = 1),
  1::bigint,
  'restore_announcement takes exactly one argument — the version token, and no content');

select pg_temp.become_staff();

select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'staff may put the previous announcement back');

reset role;

select is(pg_temp.snapshot(), current_setting('test.snapshot_a')::jsonb,
  'and what is public now is exactly the snapshot — content, link, expiry, visibility and source');

select is((select expires_at::text from public.announcement), current_setting('test.expires_a'),
  'the expiry is the one that was stashed — neither shortened nor extended');

select is(pg_temp.previous(), null, 'previous is cleared by the restore');
select is((select replaced_at from public.announcement), null, 'and so is replaced_at');

select is((select draft::text from public.announcement), current_setting('test.draft_c'),
  'the pending manual draft is still byte-identical — the restore published nothing');

select is(pg_temp.audit_count('restore', current_setting('test.staff_uid')::uuid), 1::bigint,
  'the restore is audited too');
select is(pg_temp.audit_field('restore', 'before', 'message'), 'Besked B — den nye',
  'the audit row says what was on the site');
select is(pg_temp.audit_field('restore', 'after', 'message'), 'Besked A — den der stod der',
  'and what was restored');

select pg_temp.become_anon();
select is((select message from public.announcement), 'Besked A — den der stod der',
  'a guest reads the previous announcement again — never the draft');
reset role;


-- --- 3b. One level only. A second Fortryd restores nothing -------------------------

select pg_temp.become_staff();

select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'nothing_to_restore',
  'a second restore is refused — one level, no stack (§4, 1ad)');

reset role;

select is(pg_temp.audit_total(), 2::bigint,
  'and it logged nothing: two real writes, two rows');


-- ===========================================================================
-- 4. Owner may replace and restore too (§5's matrix has both rows)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;

select pg_temp.become_owner();

select is(
  (select public.replace_announcement(
     'Ejerens erstatning', 'none', null, null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'status'),
  'replaced',
  'owner may replace the announcement');

select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'and owner may restore it');

reset role;

select is(pg_temp.audit_count('replace', current_setting('test.owner_uid')::uuid), 1::bigint,
  'the replacement is attributed to the owner');
select is(pg_temp.audit_count('restore', current_setting('test.owner_uid')::uuid), 1::bigint,
  'and so is the restore');


-- ===========================================================================
-- 5. Anonymous may execute neither function (§8)
-- ===========================================================================

select pg_temp.reset_fixture();
select pg_temp.become_anon();

select throws_ok(
  $$ select public.replace_announcement('x', 'none', null, null, null,
       now() + interval '1 hour', 'manual', now()) $$,
  '42501', null, 'anon cannot execute replace_announcement');

select throws_ok(
  $$ select public.restore_announcement(now()) $$,
  '42501', null, 'anon cannot execute restore_announcement');

select throws_ok(
  $$ select public.announcement_snapshot(a) from public.announcement a $$,
  '42501', null, 'anon cannot execute announcement_snapshot');

select throws_ok(
  $$ select public.is_valid_announcement_snapshot('{}'::jsonb) $$,
  '42501', null, 'anon cannot execute is_valid_announcement_snapshot');

reset role;

/* And nothing a guest may read exposes any of the three columns this phase uses. */
select pg_temp.become_anon();
select throws_ok(
  $$ select previous from public.announcement $$,
  '42501', null, 'anon cannot read previous');
select throws_ok(
  $$ select replaced_at from public.announcement $$,
  '42501', null, 'anon cannot read replaced_at');
select throws_ok(
  $$ select draft from public.announcement $$,
  '42501', null, 'anon cannot read draft');
reset role;


-- ===========================================================================
-- 6. A stale version token writes nothing and logs nothing (§6, §7e item 2)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;
select set_config('test.untouched', pg_temp.untouched()::text, true);

select pg_temp.become_staff();

select is(
  (select public.replace_announcement(
     'Erstatning med forældet nøgle', 'none', null, null, null,
     now() + interval '1 hour', 'manual', now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token is a conflict rather than a silent overwrite');

reset role;

select is(pg_temp.untouched(), current_setting('test.untouched')::jsonb,
  'the conflict wrote nothing at all');
select is(pg_temp.audit_total(), 0::bigint, 'and logged nothing — no false audit');

/* The same, for the restore. It needs something stashed to be refused *for the token*. */
select pg_temp.become_staff();
select is(
  (select public.replace_announcement(
     'Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'status'),
  'replaced', 'set up a stashed previous');
select is(
  (select public.restore_announcement(now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale token refuses the restore too');
reset role;

select isnt(pg_temp.previous(), null, 'and the stashed previous is still there');
select is(pg_temp.audit_total(), 1::bigint, 'with no second audit row');


-- ===========================================================================
-- 7. The payload is closed: what a caller may not pass (§8, 1ac)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;
select set_config('test.untouched', pg_temp.untouched()::text, true);

select pg_temp.become_staff();

select is(
  (select public.replace_announcement('   ', 'none', null, null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'message', 'a blank message is refused (1ac: the bar is a message)');

select is(
  (select public.replace_announcement(repeat('x', 91), 'none', null, null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'message_length', 'a message over 90 characters is refused');

select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() - interval '1 minute', 'manual', pg_temp.version()) ->> 'reason'),
  'expires_at', 'an expiry that has already passed is refused (1ac: udloeb er paakraevet)');

select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     null, 'manual', pg_temp.version()) ->> 'reason'),
  'expires_at', 'and so is no expiry at all');

select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'kampagne', pg_temp.version()) ->> 'reason'),
  'source', 'a source outside the closed vocabulary is refused');

select is(
  (select public.replace_announcement('Besked B', 'page', '/admin', null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link', 'an internal link outside the six approved routes is refused (§8)');

select is(
  (select public.replace_announcement('Besked B', 'url', null, 'http://usikker.test/x', 'Se her',
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link', 'an http address is refused (§8)');

select is(
  (select public.replace_announcement('Besked B', 'url', null, 'javascript:alert(1)', 'Se her',
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link', 'a javascript: address is refused');

select is(
  (select public.replace_announcement('Besked B', 'page', '/menu', 'https://andet.test', null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link', 'a link that is both a page and an address is refused');

select is(
  (select public.replace_announcement('Besked B', 'none', '/menu', null, null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link', 'a link with no type but a page is refused');

select is(
  (select public.replace_announcement('Besked B', 'url', null, 'https://andet.test/x', null,
     now() + interval '1 hour', 'manual', pg_temp.version()) ->> 'reason'),
  'link_label', 'an external address with no label is refused — it would render no anchor');

reset role;

select is(pg_temp.untouched(), current_setting('test.untouched')::jsonb,
  'not one of the eleven refusals wrote anything');
select is(pg_temp.audit_total(), 0::bigint,
  'and not one of them logged anything — no false audit on a refusal');


-- ===========================================================================
-- 8. A malformed `previous` is refused safely (the 8C-1 brief's section 6)
-- ===========================================================================
--
-- `previous` cannot be reached from the application at all — it is not in `anon`'s
-- column grant, no form has a field for it, and the only statement that writes it is
-- `replace_announcement`. The state below is therefore produced directly, as the
-- phase-7 lock pass produced its malformed-draft walk: what matters is that the
-- restore refuses it rather than writing a row nobody could read.

select pg_temp.reset_fixture();
delete from public.audit_log;

update public.announcement
   set previous    = jsonb_build_object('message', 'kun en besked'),
       replaced_at = now();

select set_config('test.untouched', pg_temp.untouched()::text, true);

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'invalid_snapshot',
  'a previous that is not a snapshot this system wrote is refused');
reset role;

select is(pg_temp.untouched(), current_setting('test.untouched')::jsonb,
  'the refusal wrote nothing — and left the malformed value in place rather than tidying it away');
select is(pg_temp.audit_total(), 0::bigint, 'and logged nothing');

/* The same for a `previous` that is otherwise perfect but carries a draft. */
select pg_temp.reset_fixture();
select set_config('test.valid_snapshot', pg_temp.snapshot()::text, true);

update public.announcement
   set previous = current_setting('test.valid_snapshot')::jsonb
                  || jsonb_build_object('draft', jsonb_build_object('message', 'x')),
       replaced_at = now();

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'invalid_snapshot',
  'a previous carrying a draft is refused — a restore can never publish one');
reset role;


-- ===========================================================================
-- 9. Nothing to restore (§6)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'nothing_to_restore',
  'a restore with no stashed previous is refused');
reset role;

select is(pg_temp.audit_total(), 0::bigint, 'and writes no audit row');


-- ===========================================================================
-- 10. What was replaced: the four cases the domain has to tell apart
-- ===========================================================================
--
-- 8C-3 decides whether 1ae's sheet is shown. 8C-1 provides the fact it decides from,
-- and it is decided from the row the **server** read.

-- 10a. An active, publicly visible announcement.
select pg_temp.reset_fixture();
select pg_temp.become_staff();
select is(
  (select public.replace_announcement('B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'replaced'),
  'active', 'replacing a visible, unexpired message reports `active`');
reset role;

-- 10b. A valid message that was switched off. Its own visibility is stashed with it.
select pg_temp.reset_fixture();
update public.announcement set is_visible = false;
select set_config('test.snapshot_hidden', pg_temp.snapshot()::text, true);

select pg_temp.become_staff();
select is(
  (select public.replace_announcement('B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'replaced'),
  'hidden', 'replacing a switched-off but valid message reports `hidden`');
reset role;

select is(pg_temp.previous() ->> 'is_visible', 'false',
  'and its own is_visible is what was stashed — not the state it is being replaced from');

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored', 'it can be put back');
reset role;

select is((select is_visible from public.announcement), false,
  'and it comes back switched off — the exact published visibility state is preserved');
select is(pg_temp.snapshot(), current_setting('test.snapshot_hidden')::jsonb,
  'byte for byte');

-- 10c. An expired message. Not a public conflict, but stashed faithfully all the same.
select pg_temp.reset_fixture();
update public.announcement set expires_at = now() - interval '1 minute';
select set_config('test.expires_expired', (select expires_at::text from public.announcement), true);

select pg_temp.become_staff();
select is(
  (select public.replace_announcement('B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'replaced'),
  'expired', 'replacing an expired message reports `expired` — no guest could see it');
reset role;

-- 10d. No announcement at all.
select pg_temp.reset_fixture();
update public.announcement set message = null, is_visible = false, link_type = 'none',
                               link_page = null, link_url = null, link_label = null;

select pg_temp.become_staff();
select is(
  (select public.replace_announcement('B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'replaced'),
  'none', 'replacing nothing reports `none` rather than pretending there was a conflict');
reset role;

select ok(public.is_valid_announcement_snapshot(pg_temp.previous()),
  'and the empty state is still a valid snapshot, so Fortryd can put the emptiness back');

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored', 'the emptiness is restorable');
reset role;

select is((select message from public.announcement), null,
  'and the announcement is empty again');


-- ===========================================================================
-- 11. An expiry that passes inside the ten seconds (the brief's section 7)
-- ===========================================================================
--
-- The one honest race this operation has, and the decision the plan requires: the
-- previous announcement's expiry is **not** extended to make the undo visible. The
-- restore puts back exactly what was there, which may be a message no guest can read,
-- and the reply says so rather than reporting a success a visitor would contradict.

select pg_temp.reset_fixture();
delete from public.audit_log;

/* A published, visible announcement that expires in a moment. */
update public.announcement set expires_at = now() + interval '2 seconds';
select set_config('test.expires_soon', (select expires_at::text from public.announcement), true);

select pg_temp.become_staff();
select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'the replacement goes through while A is still current');
reset role;

/* Time passes — the whole of the ten-second window, in one statement. */
update public.announcement
   set previous = jsonb_set(previous, '{expires_at}',
                            to_jsonb((now() - interval '1 second')::timestamptz));

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored',
  'the restore is not refused — the previous state is a fact, not a request to show something');
reset role;

select is((select is_visible from public.announcement), true,
  'the previous visibility is restored exactly as it stood');
select cmp_ok((select expires_at from public.announcement), '<', now(),
  'and the expiry is NOT extended to make the undo visible');

select pg_temp.become_anon();
select is((select count(*) from public.announcement), 0::bigint,
  'so no guest sees it — restoring an expired announcement restores an ineligible one');
reset role;

select pg_temp.reset_fixture();
update public.announcement set expires_at = now() + interval '2 hours';
select pg_temp.become_staff();
select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'set up an unexpired previous');
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'showable'),
  'true',
  'a restore that a guest can read reports showable = true');
reset role;

select pg_temp.reset_fixture();
update public.announcement set expires_at = now() + interval '2 hours';
select pg_temp.become_staff();
select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'set up a previous that then expires');
reset role;

update public.announcement
   set previous = jsonb_set(previous, '{expires_at}',
                            to_jsonb((now() - interval '1 second')::timestamptz));

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'showable'),
  'false',
  'and one the expiry has overtaken reports showable = false, so the screen can say what happened');
reset role;


-- ===========================================================================
-- 12. A second replacement keeps exactly one level (§4, 1ad)
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;

select pg_temp.become_staff();

select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'A is replaced by B');

select is(
  (select public.replace_announcement('Besked D', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'and then B is replaced by D');

reset role;

select is(pg_temp.previous() ->> 'message', 'Besked B',
  'previous is the announcement that existed immediately before the latest replacement');
select ok(not (pg_temp.previous() ? 'previous'),
  'and it carries no snapshot of its own — no recursion, no stack, no array');

select pg_temp.become_staff();
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored', 'one Fortryd puts B back');
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'nothing_to_restore', 'and there is no second step back to A — the log is the record');
reset role;

select is(pg_temp.audit_total(), 3::bigint,
  'three real writes, three audit rows: replace, replace, restore');


-- ===========================================================================
-- 13. No privilege escalation, and no unrelated table moved (§8)
-- ===========================================================================

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('replace_announcement', 'restore_announcement',
                        'announcement_snapshot', 'is_valid_announcement_snapshot')
      and p.prosecdef),
  0::bigint,
  'all four functions are SECURITY INVOKER — no privilege escalation');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('replace_announcement', 'restore_announcement',
                        'announcement_snapshot', 'is_valid_announcement_snapshot')
      and p.proconfig @> array['search_path=""']),
  4::bigint,
  'and all four pin an empty search_path');

select pg_temp.reset_fixture();

select set_config('test.hours', (select schedule::text from public.opening_hours), true);
select set_config('test.overrides', (select count(*)::text from public.opening_hours_overrides), true);
select set_config('test.dishes', (select count(*)::text from public.dishes), true);
select set_config('test.pages', (select count(*)::text from public.pages), true);

select pg_temp.become_staff();
select is(
  (select public.replace_announcement('Besked B', 'none', null, null, null,
     now() + interval '1 hour', 'opening_hours', pg_temp.version(), pg_temp.owner_override()) ->> 'status'),
  'replaced', 'a replacement, for the tables below to be measured against');
select is(
  (select public.restore_announcement(pg_temp.version()) ->> 'status'),
  'restored', 'and its restore');
reset role;

select is((select schedule::text from public.opening_hours), current_setting('test.hours'),
  'the weekly opening hours are untouched — this phase writes no hours');
select is((select count(*)::text from public.opening_hours_overrides), current_setting('test.overrides'),
  'the one-off overrides are untouched');
select is((select count(*)::text from public.dishes), current_setting('test.dishes'),
  'the dishes are untouched');
select is((select count(*)::text from public.pages), current_setting('test.pages'),
  'and so are the page documents');

select is((select count(*) from public.announcement), 1::bigint,
  'and there is still exactly one announcement (§4)');


select * from finish();
rollback;
