-- Klingenberg Food — pgTAP: the announcement (§4, §5, §6, §7c, §8, §9).
--
-- Phase 7A added one migration with one operation: `public.publish_announcement` gained
-- two rules and one write. This suite asserts, from real Staff, Owner and anonymous JWTs,
-- the properties the application relies on:
--
--    1. `anon` may read a *current* announcement's live columns and may not read `draft`,
--       `previous` or anything else — and the RLS filter is asserted directly, because it
--       is the defence-in-depth copy of §7c that the application's own filter sits on;
--    2. `anon` may not write it, in any direction, and may not execute the publish;
--    3. Staff may write a draft and Owner may too (§5's matrix puts the announcement in
--       both rows), and the write touches `draft` and nothing else — the live message,
--       link, expiry and `is_visible` all stand exactly as they were;
--    4. a draft is invisible to a guest until a publish, and a partial draft merges
--       rather than blanking the fields it does not mention;
--    5. a stale version token writes nothing;
--    6. **publishing makes the announcement visible** — 1ad's "Ret → Forhåndsvis →
--       Offentliggør" is the path by which a message reaches the hjemmeside, and without
--       this the bar could never appear at all;
--    7. **a malformed draft cannot be published**: a blank message and a missing or
--       already-past expiry are each refused, with nothing merged, nothing cleared and no
--       audit row — 1ac's "Udløb er påkrævet", in SQL;
--    8. a publish writes exactly one audit row, attributed to whoever pressed it;
--    9. an **expired** announcement is not publicly eligible, at the read boundary;
--   10. the link CHECKs still refuse an unapproved page, a non-https address and an
--       inconsistent link shape — the three halves of §8's open-redirect rule;
--   11. the singleton stays a singleton, and no new public write path exists;
--   12. a draft carrying `is_visible` or `source` cannot smuggle either through a publish,
--       because the merge names six columns and neither is one of them (§6).
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "a guest never reads a draft" is the promise the draft model exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–011.

begin;
create extension if not exists pgtap with schema extensions;

select plan(62);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from auth.users where email in ('owner@example.test', 'staff@example.test')),
  2::bigint,
  'both local development identities exist (run `npm run db:users` if this fails)');

delete from public.audit_log;

/*
 * A published, currently-visible announcement whose expiry is always in the future,
 * whatever "now" is when this runs. A literal timestamp would make the suite pass today
 * and fail tomorrow, which is the one way an expiry test can be worse than no test.
 */
update public.announcement
   set message     = 'Levende besked',
       link_type   = 'none',
       link_page   = null,
       link_url    = null,
       link_label  = null,
       expires_at  = now() + interval '2 hours',
       is_visible  = true,
       source      = 'manual',
       previous    = null,
       replaced_at = null,
       draft       = null;

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

/* The one row, whoever is asking. `announcement` is a singleton (§4). */
create function pg_temp.ann_id() returns uuid language sql as $fn$
  select id from public.announcement limit 1
$fn$;

create function pg_temp.version() returns timestamptz language sql as $fn$
  select updated_at from public.announcement limit 1
$fn$;

/* What a guest currently reads. Live columns only — no draft anywhere in sight. */
create function pg_temp.public_message() returns text language sql as $fn$
  select coalesce(a.message, '-') from public.announcement a limit 1
$fn$;

/* Whether a guest can see the row at all, which is the RLS eligibility filter (§7c). */
create function pg_temp.public_rows() returns bigint language sql as $fn$
  select count(*) from public.announcement
$fn$;

/*
 * How many audit rows one action wrote, and who they are attributed to.
 *
 * SECURITY DEFINER, and owned by the role that owns the table, because `audit_log` is
 * **Owner-readable** (§5) — a staff session reads none of it, which suite 002 asserts.
 * These assertions are about what was *written* and to whom, not about who may read it.
 */
create function pg_temp.audit_count(p_action text, p_actor uuid)
returns bigint
language sql
security definer
set search_path = ''
as $fn$
  select count(*) from public.audit_log
   where entity = 'announcement' and action = p_action and actor_id = p_actor
$fn$;

create function pg_temp.audit_total() returns bigint language sql security definer set search_path = '' as $fn$
  select count(*) from public.audit_log
$fn$;

/* What the administration shows: the draft's value where there is one. */
create function pg_temp.draft_of(field text) returns text language sql as $fn$
  select a.draft ->> field from public.announcement a limit 1
$fn$;

/* Restore the fixture between the destructive sections, as the owner. */
create function pg_temp.reset_fixture() returns void language sql security definer set search_path = '' as $fn$
  update public.announcement
     set message     = 'Levende besked',
         link_type   = 'none',
         link_page   = null,
         link_url    = null,
         link_label  = null,
         expires_at  = now() + interval '2 hours',
         is_visible  = true,
         source      = 'manual',
         previous    = null,
         replaced_at = null,
         draft       = null;
$fn$;


-- ===========================================================================
-- 1. anon reads a current announcement and never the draft (§4, §5, §8)
-- ===========================================================================

select pg_temp.become_staff();

select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object('message', 'Hemmelig ny besked')
      where updated_at = (select updated_at from public.announcement) $$,
  'staff may write a draft');

select pg_temp.become_anon();

select is(pg_temp.public_rows(), 1::bigint,
  'anon sees the announcement while it is visible and unexpired');

select is(pg_temp.public_message(), 'Levende besked',
  'anon reads the published message, not the draft');

select throws_ok($$ select draft from public.announcement $$,
  '42501', null, 'anon cannot read announcement.draft');
select throws_ok($$ select previous from public.announcement $$,
  '42501', null, 'anon cannot read announcement.previous');
select throws_ok($$ select replaced_at from public.announcement $$,
  '42501', null, 'anon cannot read announcement.replaced_at');
select throws_ok($$ select updated_by from public.announcement $$,
  '42501', null, 'anon cannot read who last changed it');


-- ===========================================================================
-- 2. anon writes nothing, and cannot publish (§8)
-- ===========================================================================

select throws_ok(
  $$ update public.announcement set message = 'Indsat af en gaest' $$,
  '42501', null, 'anon cannot change the message');

select throws_ok(
  $$ update public.announcement set is_visible = false $$,
  '42501', null, 'anon cannot switch the bar off');

select throws_ok(
  $$ update public.announcement set expires_at = now() + interval '10 years' $$,
  '42501', null, 'anon cannot extend the expiry');

select throws_ok(
  $$ insert into public.announcement (is_singleton, message) values (true, 'To beskeder') $$,
  '42501', null, 'anon cannot insert a second announcement');

select throws_ok(
  $$ delete from public.announcement $$,
  '42501', null, 'anon cannot delete the announcement');

select throws_ok(
  $$ select public.publish_announcement(
       (select id from public.announcement), now()) $$,
  '42501', null, 'anon cannot execute publish_announcement');

reset role;


-- ===========================================================================
-- 3. an expired announcement is not publicly eligible (§7c)
-- ===========================================================================

select pg_temp.reset_fixture();

update public.announcement set expires_at = now() - interval '1 minute';

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint,
  'anon does not see an announcement whose expiry has passed');
reset role;

update public.announcement set expires_at = now() + interval '2 hours', is_visible = false;

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint,
  'anon does not see an announcement that is switched off');
reset role;

update public.announcement set is_visible = true, message = null;

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint,
  'anon does not see an announcement with no message');
reset role;


-- ===========================================================================
-- 4. staff and owner may both write a draft, and it touches nothing else (§5, §6)
-- ===========================================================================

select pg_temp.reset_fixture();
select pg_temp.become_staff();

select lives_ok(
  $$ update public.announcement
        set draft = jsonb_build_object(
              'message', 'Ny besked fra personalet',
              'link_type', 'page',
              'link_page', '/find-os',
              'link_label', 'Se tider')
      where updated_at = (select updated_at from public.announcement) $$,
  'staff may write a draft that changes the message and the link');

select is(pg_temp.public_message(), 'Levende besked',
  'the live message is untouched by the draft (§6)');
select is((select is_visible from public.announcement), true,
  'and so is is_visible — a draft never carries it');
select is((select link_type from public.announcement), 'none',
  'and so is the live link');

/* A stale token writes nothing. Optimistic concurrency (§6). */
update public.announcement
   set draft = jsonb_build_object('message', 'Skrevet med et gammelt token')
 where updated_at = now() - interval '1 day';

select is(pg_temp.draft_of('message'), 'Ny besked fra personalet',
  'a stale version token writes no draft — the existing one stands untouched');

reset role;
select pg_temp.become_owner();

select lives_ok(
  $$ update public.announcement
        set draft = (select draft from public.announcement)
                    || jsonb_build_object('link_label', 'Se aabningstider')
      where updated_at = (select updated_at from public.announcement) $$,
  'owner may edit the same draft — the announcement is in both rows of the §5 matrix');

select is(pg_temp.draft_of('message'), 'Ny besked fra personalet',
  'a partial draft edit merges rather than blanking the other fields');
select is(pg_temp.draft_of('link_label'), 'Se aabningstider',
  'and carries the field that was just changed');

reset role;


-- ===========================================================================
-- 5. publishing merges, clears, makes it visible, and audits (§6, 1ad)
-- ===========================================================================

select pg_temp.reset_fixture();

update public.announcement
   set is_visible = false,
       draft = jsonb_build_object(
         'message', 'Vi lukker kl. 18 i dag',
         'link_type', 'page',
         'link_page', '/find-os',
         'link_label', 'Se tider');

select pg_temp.become_staff();

select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'published',
  'staff may publish the announcement');

reset role;

select is((select message from public.announcement), 'Vi lukker kl. 18 i dag',
  'the publish merged the message');
select is((select link_page from public.announcement), '/find-os',
  'and the link');
select is((select link_label from public.announcement), 'Se tider',
  'and the link label');
select is((select draft from public.announcement), null,
  'and cleared the draft');

/*
 * The line phase 7A added. §6's immediate-path table names only the *off* direction, and
 * 1ad names the on direction: "Skrive eller aendre -> tre trin. Ret -> Forhaandsvis ->
 * Offentliggoer." Without this a published announcement would never reach a guest.
 */
select is((select is_visible from public.announcement), true,
  'and made the announcement visible — publishing is how a message reaches the site');

select is((select source from public.announcement), 'manual',
  'and left source alone — generated announcements are phase 8');

select is(pg_temp.audit_count('publish', current_setting('test.staff_uid')::uuid), 1::bigint,
  'exactly one audit row, attributed to the staff member who published it');

select pg_temp.become_anon();
select is(pg_temp.public_message(), 'Vi lukker kl. 18 i dag',
  'and only now does a guest read the new message');
reset role;


-- ===========================================================================
-- 6. a malformed draft cannot be published (§7c, 1ac "Udløb er påkrævet")
-- ===========================================================================

select pg_temp.reset_fixture();
delete from public.audit_log;

-- 6a. A blank message.
update public.announcement set draft = jsonb_build_object('message', '   ');
select pg_temp.become_staff();

select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'invalid_draft',
  'a draft that would blank the message is refused');

reset role;
select is((select message from public.announcement), 'Levende besked',
  'the live message is unchanged by the refusal');
select isnt((select draft from public.announcement), null,
  'the draft survives the refusal');
select is(pg_temp.audit_total(), 0::bigint,
  'and no audit row claims it happened');

-- 6b. A null message.
update public.announcement set draft = jsonb_build_object('message', null);
select pg_temp.become_staff();
select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'invalid_draft',
  'a draft that clears the message is refused too');
reset role;

-- 6c. An expiry that has already passed.
select pg_temp.reset_fixture();
update public.announcement
   set draft = jsonb_build_object('expires_at', (now() - interval '1 minute')::text);
select pg_temp.become_staff();

select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'invalid_draft',
  'a draft whose expiry has already passed is refused');

reset role;
select cmp_ok((select expires_at from public.announcement), '>', now(),
  'and the live expiry is unchanged');

-- 6d. No expiry at all.
select pg_temp.reset_fixture();
update public.announcement set draft = jsonb_build_object('expires_at', null);
select pg_temp.become_staff();

select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'invalid_draft',
  'a draft that clears the expiry is refused — 1ac: udloeb er paakraevet');

reset role;
select is(pg_temp.audit_total(), 0::bigint,
  'none of the four refusals wrote an audit row');


-- ===========================================================================
-- 7. a draft cannot smuggle a column the merge does not name (§6)
-- ===========================================================================

select pg_temp.reset_fixture();

update public.announcement
   set is_visible = true,
       draft = jsonb_build_object(
         'message', 'Besked med smuglet gods',
         'is_visible', false,
         'source', 'opening_hours',
         'previous', jsonb_build_object('message', 'noget andet'),
         'updated_by', '00000000-0000-4000-8000-000000000000');

select pg_temp.become_staff();
select is(
  (select public.publish_announcement(pg_temp.ann_id(), pg_temp.version()) ->> 'status'),
  'published',
  'a draft carrying extra keys still publishes its real fields');
reset role;

select is((select message from public.announcement), 'Besked med smuglet gods',
  'the six named columns are merged');
select is((select is_visible from public.announcement), true,
  'is_visible is set by the publish, never taken from the draft');
select is((select source from public.announcement), 'manual',
  'source is not merged from a draft');
select is((select previous from public.announcement), null,
  'previous is not merged from a draft');
select is((select updated_by from public.announcement),
  current_setting('test.staff_uid')::uuid,
  'and updated_by is the person who published, not the value the draft carried');


-- ===========================================================================
-- 8. the link CHECKs — §8's open-redirect rule, in three parts
-- ===========================================================================

select pg_temp.reset_fixture();

select throws_ok(
  $$ update public.announcement
        set link_type = 'page', link_page = '/admin', link_url = null $$,
  '23514', null, 'an internal link outside the six approved routes is refused');

select throws_ok(
  $$ update public.announcement
        set link_type = 'url', link_page = null, link_url = 'http://usikker.test/side' $$,
  '23514', null, 'an http address is refused');

select throws_ok(
  $$ update public.announcement
        set link_type = 'url', link_page = null, link_url = 'javascript:alert(1)' $$,
  '23514', null, 'a javascript: address is refused');

select throws_ok(
  $$ update public.announcement
        set link_type = 'url', link_page = null, link_url = 'data:text/html,<b>x</b>' $$,
  '23514', null, 'a data: address is refused');

select throws_ok(
  $$ update public.announcement
        set link_type = 'page', link_page = '/menu', link_url = 'https://andet.test' $$,
  '23514', null, 'a link that is both a page and an address is refused');

select throws_ok(
  $$ update public.announcement
        set link_type = 'none', link_page = '/menu', link_url = null $$,
  '23514', null, 'a link with no type but a page is refused');

select throws_ok(
  $$ update public.announcement set message = repeat('x', 91) $$,
  '23514', null, 'a message over 90 characters is refused by the column CHECK');

/* A publish that would break a CHECK rolls the whole transaction back (§6), which suite
   005 already asserts for this table. What is asserted here is that the shape rules are
   still the authority after phase 7A replaced the function. */
select pg_temp.reset_fixture();
update public.announcement
   set draft = jsonb_build_object('link_url', 'https://noget.test/side');

select pg_temp.become_staff();
select throws_ok(
  $$ select public.publish_announcement(
       (select id from public.announcement),
       (select updated_at from public.announcement)) $$,
  '23514', null,
  'a publish that would violate the link-shape CHECK still raises rather than half-succeeding');
reset role;


-- ===========================================================================
-- 9. the singleton stays one row, and no new public write path exists (§4, §8)
-- ===========================================================================

select pg_temp.reset_fixture();
select pg_temp.become_staff();

select throws_ok(
  $$ insert into public.announcement (is_singleton, message) values (true, 'To ad gangen') $$,
  '42501', null,
  'not even staff may insert a second announcement — there is no INSERT grant (§4)');

select throws_ok(
  $$ delete from public.announcement $$,
  '42501', null,
  'and none may delete the one that exists');

reset role;

select is((select count(*) from public.announcement), 1::bigint,
  'there is exactly one announcement, as §4 requires');

/*
 * Phase 7B's immediate remove/replace RPC does not exist yet, and this suite is where a
 * premature one would be noticed. §6's immediate path for this entity is phase 7B.
 */
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_announcement_visible', 'remove_announcement',
                        'replace_announcement', 'restore_announcement')),
  0::bigint,
  'no immediate announcement RPC exists yet — that is phase 7B');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%announcement%'),
  2::bigint,
  'the announcement has exactly two functions: its content reader and its publish');

select * from finish();
rollback;
