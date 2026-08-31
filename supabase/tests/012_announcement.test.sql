-- Klingenberg Food — pgTAP: the announcement (§4, §5, §6, §7c, §8, §9).
--
-- Phase 7A added one migration with one operation: `public.publish_announcement` gained
-- two rules and one write. **Phase 7B added the immediate path** — one migration, two
-- functions, and section 10 below. This suite asserts, from real Staff, Owner and
-- anonymous JWTs, the properties the application relies on:
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
--       because the merge names six columns and neither is one of them (§6);
--   13. **the immediate path (phase 7B, completed by the phase-7 lock pass)**: Staff and
--       Owner may take the bar down at once and put it back — by Fortryd inside the ten
--       seconds and, since §0h, by pressing "Vis besked" again afterwards, which is the
--       *same call with the same argument* and is therefore asserted once rather than
--       twice; `anon` may execute neither function; the write moves
--       `is_visible` and leaves every other column — `draft`, `source`, `previous`,
--       `replaced_at`, the message, the links and the expiry — **byte-identical**; a
--       stale token writes nothing and logs nothing; a repeat press is `unchanged` and
--       logs nothing; each real write is audited once, attributed from the JWT; and an
--       announcement whose expiry passed inside the ten-second Fortryd window is
--       **refused** rather than made publicly eligible.
--
-- The guest's view is checked through `anon`'s own view of the table throughout, because
-- "a guest never reads a draft" is the promise the draft model exists to keep, and an
-- assertion made as the owner would not be that promise.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–011.

begin;
create extension if not exists pgtap with schema extensions;

select plan(103);

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
 * Phase 7B's one immediate operation exists.
 *
 * **This assertion moved once, on purpose.** As written for phase 7 it also said that
 * no `replace_announcement` and no `restore_announcement` existed, because §6's third
 * immediate row — the `previous` stash and the restore that reads it — belonged to
 * phase 8. **Phase 8C-1 is that phase**, and it built them
 * (`20260831140000_announcement_replacement.sql`), so the guard is updated rather than
 * deleted: the two functions are now asserted to *exist*, and the boundary that has
 * not moved is asserted beside them — nothing generates an opening-hours message yet
 * (8C-2), and no conflict sheet exists (8C-3). Section 10 below, which is phase 7's own
 * behaviour, is untouched by any of it: `set_announcement_visible` writes one column
 * and still leaves `previous` and `replaced_at` null.
 */
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_announcement_visible'),
  1::bigint,
  'the immediate visibility RPC exists — phase 7B');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('remove_announcement', 'set_announcement_source')),
  0::bigint,
  'and no ad-hoc removal or source-setting RPC exists — the column set is closed');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%announcement%'),
  11::bigint,
  'the announcement has exactly eleven functions: two content readers, its publish, its visibility write, the snapshot pair, replace/restore (phase 8C-1), the write guard that decides which of them may move which column (the 8C-1 hardening pass), and the replacement-kind reader and generated-announcement coordinator (phase 8C-3A)');

/*
 * SECURITY INVOKER, like every other write function here. A definer-rights function
 * would run as its owner and hand any authenticated caller the table's own privileges,
 * which is precisely the escalation §8 lists and RLS is the second layer against.
 */
select is(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_announcement_visible'),
  false,
  'set_announcement_visible is SECURITY INVOKER — no privilege escalation');

select is(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'announcement_visibility'),
  false,
  'and so is announcement_visibility');


-- ===========================================================================
-- 10. the immediate path: "Vis besked" off / "Fjern beskeden nu" (§6, 1ad)
-- ===========================================================================
--
-- Phase 7B. One operation, two controls, and exactly one column it may move.
--
-- The fixture below deliberately carries a **pending draft**, because the property that
-- matters most here is a negative one: an immediate removal is not a publish, not an
-- edit and not a replacement, so the draft somebody was in the middle of writing must be
-- byte-identical before the hide, after the hide and after the undo.

select pg_temp.reset_fixture();
delete from public.audit_log;

update public.announcement
   set draft = jsonb_build_object(
         'message', 'Kladde der skal overleve',
         'link_label', 'Se tider');

/*
 * Everything this operation must not move, as one value.
 *
 * `is_visible` is what it *may* move; `updated_at` and `updated_by` are stamped by the
 * table's own touch trigger on any write, which is where attribution comes from (§8).
 * Everything else — the message, all four link columns, the expiry, `source`,
 * `previous`, `replaced_at` and `draft` — is compared byte for byte.
 */
select set_config('test.untouched',
  (select (to_jsonb(a) - 'is_visible' - 'updated_at' - 'updated_by')::text
     from public.announcement a), true);

select set_config('test.expires',
  (select expires_at::text from public.announcement), true);

select set_config('test.draft',
  (select draft::text from public.announcement), true);


-- --- 10a. Staff may take the bar down, and only the bar ----------------------------

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'staff may remove the announcement immediately');

reset role;

select is((select is_visible from public.announcement), false,
  'the bar is off');

select is(
  (select (to_jsonb(a) - 'is_visible' - 'updated_at' - 'updated_by')
     from public.announcement a),
  current_setting('test.untouched')::jsonb,
  'every other column is byte-identical: message, links, expiry, source, previous, replaced_at, draft');

select is((select draft::text from public.announcement), current_setting('test.draft'),
  'the pending draft is byte-identical — an immediate removal is not a publish');
select is((select source from public.announcement), 'manual',
  'source is untouched — generated announcements are phase 8');
select is((select previous from public.announcement), null,
  'previous is not written — replacing an announcement is phase 8');
select is((select replaced_at from public.announcement), null,
  'replaced_at is not written either');
select is((select expires_at::text from public.announcement), current_setting('test.expires'),
  'and the expiry is neither shortened nor extended');

select is((select updated_by from public.announcement),
  current_setting('test.staff_uid')::uuid,
  'the row is attributed to the staff member who removed it, from the JWT');

select is(pg_temp.audit_count('visibility', current_setting('test.staff_uid')::uuid), 1::bigint,
  'exactly one audit row, attributed to whoever pressed it');

select is(
  (select before ->> 'is_visible' from public.audit_log
    where entity = 'announcement' and action = 'visibility'
    order by created_at desc limit 1),
  'true',
  'the audit row records the visibility it started from');
select is(
  (select after ->> 'is_visible' from public.audit_log
    where entity = 'announcement' and action = 'visibility'
    order by created_at desc limit 1),
  'false',
  'and the visibility it ended in');

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint,
  'and a guest no longer sees the announcement at all');
reset role;


-- --- 10b. Pressing it twice is one decision ----------------------------------------

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'unchanged',
  'a second press reports unchanged rather than writing again');

reset role;

select is(pg_temp.audit_total(), 1::bigint,
  'and writes no second audit row');


-- --- 10c. A stale version token writes nothing and logs nothing --------------------

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(true, now() - interval '1 day') ->> 'status'),
  'conflict',
  'a stale version token is a conflict (§6, §7e item 2)');

reset role;

select is((select is_visible from public.announcement), false,
  'the conflict wrote nothing — the bar is still off');
select is(pg_temp.audit_total(), 1::bigint,
  'and the conflict logged nothing');


-- --- 10d. The on direction is a second authorized write, and restores visibility only
--
-- This one call is **both** ways back: Fortryd inside the ten seconds, and "Vis besked"
-- pressed again after the offer has gone (§0h). They differ only in which control the
-- browser rendered — the request is the same boolean and the same version token, so the
-- properties below hold for both and there is nothing separate to assert for the manual
-- press. What matters is what it does *not* do: the pending draft the fixture carries is
-- still byte-identical afterwards, and a guest reads the published message rather than it.

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(true, pg_temp.version()) ->> 'status'),
  'updated',
  'the on direction restores the announcement (Fortryd, and a manual "Vis besked")');

reset role;

select is((select is_visible from public.announcement), true,
  'the bar is back on');
select is((select draft::text from public.announcement), current_setting('test.draft'),
  'the pending draft is still byte-identical — the undo published nothing');
select is(
  (select (to_jsonb(a) - 'is_visible' - 'updated_at' - 'updated_by')
     from public.announcement a),
  current_setting('test.untouched')::jsonb,
  'and so is every other column');

select pg_temp.become_anon();
select is(pg_temp.public_message(), 'Levende besked',
  'a guest reads the same published message again — never the draft');
reset role;

select is(pg_temp.audit_total(), 2::bigint,
  'the undo is audited too: two writes, two rows');


-- --- 10e. Owner may do it as well (§5's matrix has the announcement in both rows) --

select pg_temp.become_owner();

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'owner may remove the announcement immediately too');

reset role;

select is(pg_temp.audit_count('visibility', current_setting('test.owner_uid')::uuid), 1::bigint,
  'and that write is attributed to the owner, not to the staff member before them');


-- --- 10f. Anonymous may not, at the function, before RLS is consulted --------------

select pg_temp.become_anon();

select throws_ok(
  $$ select public.set_announcement_visible(false, now()) $$,
  '42501', null, 'anon cannot execute set_announcement_visible');

select throws_ok(
  $$ select public.announcement_visibility(a) from public.announcement a $$,
  '42501', null, 'anon cannot execute announcement_visibility either');

reset role;


-- --- 10g. An expired message is not restored, and is not made publicly eligible ----
--
-- The one honest race this operation has: Fortryd is offered for about ten seconds, and
-- an expiry can pass inside them. Writing `is_visible = true` on an expired row would
-- put `true` into a column the anonymous policy goes on filtering out, and the screen
-- would report a message put back that no guest can read.
--
-- Since §0h the same refusal answers a **manual** "Vis besked" pressed on a message that
-- expired while a screen from before it was still open. The administration asks the same
-- two rules first (`isAnnouncementRestorable`) and draws no press it would have to be
-- refused for — but this is the answer, and it is the reason that is a courtesy rather
-- than the check. Nothing here extends `expires_at` to make either press succeed.

select pg_temp.reset_fixture();
delete from public.audit_log;

update public.announcement
   set is_visible = false,
       expires_at = now() - interval '1 minute';

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(true, pg_temp.version()) ->> 'status'),
  'not_showable',
  'an expired announcement is not restored by an undo');
select is(
  (select public.set_announcement_visible(true, pg_temp.version()) ->> 'reason'),
  'expires_at',
  'and the refusal names the rule it broke (1ac: udloeb er paakraevet)');

reset role;

select is((select is_visible from public.announcement), false,
  'the refusal wrote nothing');
select is(pg_temp.audit_total(), 0::bigint,
  'and logged nothing');
select cmp_ok((select expires_at from public.announcement), '<', now(),
  'and did not extend the expiry to make itself succeed');

select pg_temp.become_anon();
select is(pg_temp.public_rows(), 0::bigint,
  'expired content does not become publicly eligible merely because visibility was asked for');
reset role;


-- --- 10h. Nor is a message that does not exist ------------------------------------

select pg_temp.reset_fixture();
update public.announcement set is_visible = false, message = null;

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(true, pg_temp.version()) ->> 'reason'),
  'message',
  'a blank announcement is not switched on either');

reset role;


-- --- 10i. The off direction is never refused --------------------------------------
--
-- A message that can no longer be shown is exactly the one somebody may still want
-- switched off. An operation whose whole purpose is "stop this now" must not have a
-- state it declines to stop.

select pg_temp.reset_fixture();
update public.announcement set expires_at = now() - interval '1 minute';

select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(false, pg_temp.version()) ->> 'status'),
  'updated',
  'an expired-but-still-flagged announcement can still be switched off');

reset role;


-- --- 10j. A call that names no intent ----------------------------------------------

select pg_temp.reset_fixture();
delete from public.audit_log;
select pg_temp.become_staff();

select is(
  (select public.set_announcement_visible(null, pg_temp.version()) ->> 'status'),
  'invalid_request',
  'a call naming no state is refused before the row is even read');

reset role;
select is(pg_temp.audit_total(), 0::bigint,
  'and it wrote no audit row');


select * from finish();
rollback;
