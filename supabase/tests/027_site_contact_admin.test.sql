-- Klingenberg Food — pgTAP: the contact facts' lifecycle under the Kontaktoplysninger
-- editor (technical plan §4, §5, §6, §8, §15 phase 11B).
--
-- No migration accompanies phase 11B's contact editor: the `draft` column, the
-- Owner-only policy and `publish_site_contact()` are phase 1's and phase 4's. This
-- suite pins the lifecycle the 1v screen relies on, from real Owner, Staff and
-- anonymous JWTs:
--
--   1. the draft — the Owner writes it, Staff gets zero rows (RLS), anon 42501;
--   2. publish — the Owner moves exactly the drafted columns, the draft is cleared,
--      the audit row carries before and after, and the anonymous read sees the new
--      facts; Staff is refused the publish; a stale token is a conflict that writes
--      nothing and audits nothing; a row with no draft has nothing to publish;
--   3. the audit projection — `site_contact_content()` names the nine columns and no
--      draft;
--   4. unrelated content — the pages and the opening hours are byte-identical.
--
-- Prerequisite: `npm run db:users` has created owner@example.test and
-- staff@example.test, as for 005–026.

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

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

create function pg_temp.row_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(c) - 'updated_at' - 'updated_by' from public.site_contact c
$fn$;

create function pg_temp.draft() returns jsonb
language sql security definer set search_path = '' as $fn$
  select draft from public.site_contact
$fn$;

create function pg_temp.version() returns timestamptz
language sql security definer set search_path = '' as $fn$
  select updated_at from public.site_contact
$fn$;

create function pg_temp.contact_id() returns uuid
language sql security definer set search_path = '' as $fn$
  select id from public.site_contact
$fn$;

create function pg_temp.fixture_draft(p_doc jsonb) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.site_contact set draft = p_doc;
end;
$fn$;

create function pg_temp.fixture_phone(p_phone text) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.site_contact set primary_phone = p_phone;
end;
$fn$;

create function pg_temp.pages_state() returns text
language sql security definer set search_path = '' as $fn$
  select md5(string_agg(p.key || p.published::text || p.is_visible::text, ',' order by p.key))
    from public.pages p
$fn$;

create function pg_temp.hours_state() returns jsonb
language sql security definer set search_path = '' as $fn$
  select to_jsonb(h) from public.opening_hours h limit 1
$fn$;

create function pg_temp.rows_moved(p_sql text) returns integer
language plpgsql as $fn$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- The seed: the confirmed number, no draft.
select pg_temp.fixture_phone('+45 63 90 83 00');
select pg_temp.fixture_draft(null);
select set_config('test.row_before', pg_temp.row_state()::text, true);
select set_config('test.pages_before', pg_temp.pages_state(), true);
select set_config('test.hours_before', pg_temp.hours_state()::text, true);

-- ===========================================================================
-- 1. The draft: Owner writes, Staff and anon do not
-- ===========================================================================

select pg_temp.become_staff();
select is(
  pg_temp.rows_moved($$ update public.site_contact set draft = '{"primary_phone": "+45 11 11 11 11"}'::jsonb $$),
  0,
  'Staff writing a contact draft moves zero rows — RLS filters the row out');
select is(pg_temp.draft(), null, 'and nothing was written');

reset role;
select pg_temp.become_anon();
select throws_ok(
  $$ update public.site_contact set draft = '{"primary_phone": "+45 11 11 11 11"}'::jsonb $$,
  '42501', null,
  'anon holds no UPDATE on site_contact');
select throws_ok(
  $$ select draft from public.site_contact $$,
  '42501', null,
  'and cannot read the draft column at all');

reset role;
select pg_temp.become_owner();
select is(
  pg_temp.rows_moved($$ update public.site_contact
                          set draft = '{"primary_phone": "+45 22 22 22 22", "email": "hej@klingenberg.test"}'::jsonb $$),
  1,
  'the Owner writes a draft with two changed facts');
select is(
  (select count(*) from public.pending_changes where entity = 'site_contact'),
  1::bigint,
  'the contact facts are pending');

reset role;
select pg_temp.become_anon();
select is(
  (select primary_phone from public.site_contact), '+45 63 90 83 00',
  'a guest still reads the published number — a draft moves nothing');

-- ===========================================================================
-- 2. Publish: Staff refused, stale refused, the Owner moves exactly the draft
-- ===========================================================================

reset role;
select pg_temp.become_staff();
select is(
  (select public.publish_site_contact(pg_temp.contact_id(), pg_temp.version()) ->> 'status'),
  'forbidden',
  'Staff is refused the publish');
select is(pg_temp.draft() ->> 'primary_phone', '+45 22 22 22 22', 'and the draft is intact');

reset role;
select pg_temp.become_owner();
select set_config('test.audit_before', (select count(*)::text from public.audit_log), true);
select is(
  (select public.publish_site_contact(pg_temp.contact_id(), pg_temp.version() - interval '1 second') ->> 'status'),
  'conflict',
  'a stale token is a conflict');
select is(
  (select primary_phone from public.site_contact), '+45 63 90 83 00',
  'the stale publish moved nothing');
select is(
  (select count(*)::text from public.audit_log), current_setting('test.audit_before'),
  'and wrote no audit row');

select set_config('test.pub',
  (select public.publish_site_contact(pg_temp.contact_id(), pg_temp.version()))::text, true);
select is((current_setting('test.pub')::jsonb ->> 'status'), 'published', 'the Owner publishes');
select is((select primary_phone from public.site_contact), '+45 22 22 22 22', 'the primary number moved');
select is((select email from public.site_contact), 'hej@klingenberg.test', 'and the e-mail');
select is((select secondary_phone from public.site_contact), '+45 51 79 45 66',
  'a column the draft did not name is untouched');
select is((select facebook_url from public.site_contact), 'https://www.facebook.com/carlnielsencafeen',
  'so is the Facebook address');
select is(pg_temp.draft(), null, 'the draft is cleared');
select is(
  (current_setting('test.pub')::jsonb -> 'before' ->> 'primary_phone'), '+45 63 90 83 00',
  'the audit before-state names the old number');
select is(
  (current_setting('test.pub')::jsonb -> 'after' ->> 'primary_phone'), '+45 22 22 22 22',
  'and the after-state the new one');
select is(
  (select count(*) from public.audit_log a
    where a.action = 'publish' and a.entity = 'site_contact'
      and a.actor_id = current_setting('test.owner_uid')::uuid),
  1::bigint,
  'one audit row, attributed to the Owner from the JWT');
select ok(
  not ((select a.after from public.audit_log a where a.entity = 'site_contact' limit 1) ? 'draft'),
  'the audit row carries no draft');

-- a row with no draft has nothing to publish
select is(
  (select public.publish_site_contact(pg_temp.contact_id(), pg_temp.version()) ->> 'status'),
  'nothing_to_publish',
  'a second publish finds nothing to publish');
select is(
  (select count(*) from public.audit_log where entity = 'site_contact'),
  1::bigint,
  'and writes no audit row');

-- the anonymous read sees the new facts on the next request
reset role;
select pg_temp.become_anon();
select is((select primary_phone from public.site_contact), '+45 22 22 22 22',
  'a guest reads the new number');
select is((select email from public.site_contact), 'hej@klingenberg.test', 'and the new e-mail');

-- ===========================================================================
-- 3. The audit projection
-- ===========================================================================

reset role;
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (select public.site_contact_content(c) from public.site_contact c)) k),
  array['address_line1', 'city', 'email', 'facebook_url', 'map_attribution', 'postal_code',
        'primary_phone', 'secondary_phone', 'venue_name'],
  'site_contact_content() names the nine columns and nothing else');

-- a draft key the publish function does not know moves nothing
select pg_temp.fixture_draft('{"instagram_url": "https://instagram.test/x", "city": "Odense"}'::jsonb);
select pg_temp.become_owner();
select is(
  (select public.publish_site_contact(pg_temp.contact_id(), pg_temp.version()) ->> 'status'),
  'published',
  'a draft with a known and an unknown key publishes');
select is((select city from public.site_contact), 'Odense', 'the known key moved');
select ok(
  not (pg_temp.row_state() ? 'instagram_url'),
  'the unknown key reached no column — there is none, and the application refuses it before this point');

-- ===========================================================================
-- 4. Unrelated content
-- ===========================================================================

reset role;
select is(pg_temp.pages_state(), current_setting('test.pages_before'), 'every page document is byte-identical');
select is(pg_temp.hours_state(), current_setting('test.hours_before')::jsonb, 'the opening hours are byte-identical');

-- ---------------------------------------------------------------------------
-- Cleanup: the seed's facts
-- ---------------------------------------------------------------------------

select pg_temp.fixture_phone('+45 63 90 83 00');
select pg_temp.fixture_draft(null);
update public.site_contact set email = 'soebylarsen@gmail.com', city = 'Nørre Lyndelse';
select is(pg_temp.row_state(), current_setting('test.row_before')::jsonb, 'the row is as the seed left it');

select * from finish();
