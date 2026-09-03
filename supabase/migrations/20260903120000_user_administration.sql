-- Klingenberg Food — phase 11C: user administration.
--
-- Technical plan section 4 ("Database-enforced invariants": at least one effective
-- owner, a constraint trigger on `profiles`), section 5 ("Accounts", decision 11: the
-- owner invites, changes a role, and deactivates — never deletes; "User accounts
-- (create, change role, deactivate)" is an Owner-only row of the matrix), section 8
-- ("System left with no owner", "A trusted function is fed forged state through a
-- direct write"), section 9 (pgTAP: staff cannot write `profiles`; the last active
-- owner cannot be demoted, disabled or deleted), section 15 (phase 11C: `/admin/brugere`).
--
-- WHAT THIS MIGRATION DOES, in the same objects rather than beside them:
--
--   * `enforce_owner_invariant()` — the phase-1 deferred constraint trigger — takes a
--     transaction-level advisory lock before it counts. The phase-1 body counted under
--     READ COMMITTED with no serialisation, so two transactions each demoting one of
--     two owners could both count the other's still-uncommitted row as an owner, both
--     pass, and both commit — zero owners. With the lock, the second transaction's
--     count waits for the first to commit and then sees it. The three account
--     transitions below take the same lock first, so a concurrent transition answers
--     `last_owner` cleanly instead of failing at commit. `supabase/tests/028` proves
--     both races through two real sessions (dblink), not a single-session simulation.
--
--   * `authenticated` loses DELETE on `profiles` and keeps UPDATE on `name`, `role`
--     and `disabled_at` only. "Deactivate, never delete" (§5) becomes the absence of
--     a privilege, as the singletons' rule is; `user_id`, `created_at`, `updated_at`
--     and `updated_by` leave the grant, so the actor stamp and the version token stop
--     being a caller's to choose (the BEFORE trigger's assignment is not privilege-
--     checked — §5's announcement note, measured there). The DELETE policy is dropped
--     with the grant it admitted rows to.
--
--   * A BEFORE INSERT OR UPDATE OF role, disabled_at guard, `tg_guard_account_write()`,
--     in the shape of §0w's image-reference guard: the two browser roles, a
--     statement-scoped marker (`app.account_write`), one word per transition. A
--     direct PostgREST INSERT of a profile, or a direct movement of `role` or
--     `disabled_at`, is refused with 42501 — for Staff *and* for Owner. Authority to
--     administer accounts is not authority to bypass the version check, the
--     last-owner check and the audit row that the transitions carry. `name` stays
--     directly writable by the Owner (phase-1 `003` pins it) — nothing believes it.
--     Migrations, `supabase/seed.sql`, `scripts/seed-local-users.mjs` (service role)
--     and the pgTAP fixtures arrive as postgres or service_role and are not guarded.
--
--   * Three SECURITY INVOKER transitions, the only doors that move an account:
--       create_account_profile(user_id, name, role)   — the profile behind an invitation
--       set_account_role(user_id, role, version)      — Staff <-> Owner
--       set_account_active(user_id, active, version)  — deactivate / reactivate
--     Each re-checks `public.is_owner()` explicitly (RLS re-decides underneath — the
--     policies are unchanged), takes the invariant lock, re-reads the row FOR UPDATE,
--     compares the version token, refuses the last active owner as a *result* rather
--     than an exception, raises the marker around its one statement, and writes the
--     audit row through `log_audit()` with the actor from the JWT. A refused or stale
--     call writes nothing and audits nothing.
--
--   * One SECURITY DEFINER read, `list_accounts()`, in the family of `is_owner()`:
--     no parameters, `search_path` pinned, EXECUTE for `authenticated` only, and it
--     raises 42501 for anybody who is not an active owner. It joins `profiles` to
--     `auth.users` for the e-mail and the invitation state, because the e-mail is the
--     Auth system's fact and is deliberately not copied into `profiles` — one identity,
--     two owners of two facts, no second copy to keep in step.
--
--   * One SECURITY DEFINER write, `revoke_account_sessions()`, and the reason it
--     exists is measured rather than assumed (2026-09-03, GoTrue v2.196): the Auth
--     Admin API offers no route that ends another person's sessions, and a ban
--     only *holds* them — a refresh token never presented while banned resumes the
--     session the moment the ban is lifted. So deactivation removes the person's
--     rows from `auth.sessions` (their refresh tokens cascade) inside the same
--     transaction as `disabled_at`, and reactivation can never resurrect a session
--     that no longer exists. The function is callable by `authenticated` only from
--     inside `set_account_active()`: it requires a single-use marker that only the
--     transition raises, and a target whose profile is deactivated. A
--     direct RPC meets 42501. `auth.sessions` is the Auth server's table; the
--     integration suite pins the measured effect so a change there fails loudly.
--
-- WHO IS AUTHORITATIVE FOR WHAT
--   * `auth.users` (Supabase Auth): the identity — e-mail, password, confirmation,
--     the ban that refuses tokens. Written only through the Auth Admin API from the
--     server (`lib/accounts/auth-admin.ts`), never from SQL.
--   * `public.profiles`: the authorisation — name, role, `disabled_at`. `is_staff()`
--     and `is_owner()` read it on every policy evaluation, so a role change or a
--     deactivation is effective for RLS the moment it commits, whatever JWT the
--     browser still holds.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No new table, no new column, no e-mail column on `profiles`, no role in JWT
--     metadata, no session table, no token store.
--   * No change to `is_staff()` / `is_owner()` — they have checked `disabled_at`
--     since phase 1, which is why deactivation needs no policy edit anywhere.
--   * No change to any RLS policy but the dropped DELETE policy; no new grant to
--     `anon`; no SECURITY DEFINER write but the one session revocation above, which
--     touches no application table.


-- ---------------------------------------------------------------------------
-- 1. The invariant lock — one key, taken by the trigger and by every transition
-- ---------------------------------------------------------------------------
-- `pg_advisory_xact_lock` is held until the transaction ends, so the deferred
-- trigger's count in one transaction cannot interleave with another's. The key is
-- arbitrary and appears in this one function only.

create or replace function public.owner_invariant_lock()
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  perform pg_catalog.pg_advisory_xact_lock(7311003);
end;
$fn$;

comment on function public.owner_invariant_lock() is
  'Takes the transaction-level advisory lock that serialises every check of the last-active-owner invariant (phase 11C).';

revoke all on function public.owner_invariant_lock() from public, anon;
grant execute on function public.owner_invariant_lock() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. enforce_owner_invariant() — the phase-1 body, under the lock
-- ---------------------------------------------------------------------------
-- Byte for byte the phase-1 function with one addition: the lock is taken before the
-- count. The trigger definition (deferrable, initially deferred, WHEN the old row was
-- an enabled owner, after UPDATE or DELETE) is unchanged and is not re-created.

create or replace function public.enforce_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  active_owners integer;
begin
  perform public.owner_invariant_lock();

  select count(*)
    into active_owners
    from public.profiles p
   where p.role = 'owner'
     and p.disabled_at is null;

  if active_owners = 0 then
    raise exception
      'Klingenberg Food must always have at least one active owner.'
      using errcode = 'check_violation',
            hint = 'Promote or re-enable another owner in the same transaction before removing this one.';
  end if;

  return null;
end;
$fn$;

comment on function public.enforce_owner_invariant() is
  'Deferred constraint trigger: rejects any transaction that leaves zero enabled owners (§4). Serialised by owner_invariant_lock() since phase 11C.';


-- ---------------------------------------------------------------------------
-- 3. Privileges — no DELETE, and UPDATE on three columns
-- ---------------------------------------------------------------------------

revoke update, delete on public.profiles from authenticated;
grant update (name, role, disabled_at) on public.profiles to authenticated;

drop policy if exists profiles_delete_owner on public.profiles;


-- ---------------------------------------------------------------------------
-- 4. The guard — role and disabled_at move only under a named transition
-- ---------------------------------------------------------------------------

create or replace function public.tg_guard_account_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_op text;
begin
  -- Migrations, the seed, the local-user script (service role) and the pgTAP
  -- fixtures are trusted with the whole table. The guard exists for the two roles
  -- a PostgREST request runs as.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  v_op := coalesce(pg_catalog.current_setting('app.account_write', true), '');

  if tg_op = 'INSERT' then
    if v_op = 'create' then
      return new;
    end if;

    raise exception
      'profiles: an account is created only by create_account_profile() — the transition behind an invitation, which carries the audit row (phase 11C)'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role and v_op <> 'role' then
    raise exception
      'profiles: the role is changed only by set_account_role() — the transition that carries the version check, the last-owner check and the audit row (phase 11C)'
      using errcode = '42501';
  end if;

  if new.disabled_at is distinct from old.disabled_at and v_op <> 'active' then
    raise exception
      'profiles: an account is deactivated or reactivated only by set_account_active() — the transition that carries the version check, the last-owner check and the audit row (phase 11C)'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_guard_account_write() is
  'BEFORE INSERT OR UPDATE OF role, disabled_at on profiles: refuses any creation or movement of the two authorisation columns from anon/authenticated that did not come from the account transition naming it in the statement-scoped app.account_write marker (phase 11C).';

create or replace function public.tg_consume_account_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  perform pg_catalog.set_config('app.account_write', '', true);
  return null;
end;
$fn$;

comment on function public.tg_consume_account_write() is
  'AFTER INSERT/UPDATE FOR EACH STATEMENT on profiles: clears app.account_write, so the marker authorises exactly the one statement it was raised for — rows moved or not (phase 11C).';

drop trigger if exists profiles_guard_account_write on public.profiles;
create trigger profiles_guard_account_write
  before insert or update of role, disabled_at on public.profiles
  for each row execute function public.tg_guard_account_write();

drop trigger if exists profiles_consume_account_write on public.profiles;
create trigger profiles_consume_account_write
  after insert or update on public.profiles
  for each statement execute function public.tg_consume_account_write();

revoke all on function public.tg_guard_account_write()   from public, anon, authenticated;
revoke all on function public.tg_consume_account_write() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. list_accounts() — the Owner's read model
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as is_owner(): `auth.users` is the Auth
-- system's table and `authenticated` holds no privilege on it. The same hardening —
-- no parameters, `search_path` pinned, every object schema-qualified, EXECUTE only
-- for `authenticated` — and one more rule: the caller must be an active owner, or the
-- function raises. Nothing about a password, a token, a provider or an address is
-- returned: the e-mail, the invitation instant and the confirmation instant are the
-- three Auth facts the screen states in words.

create or replace function public.list_accounts()
returns table (
  user_id            uuid,
  name               text,
  email              text,
  role               text,
  disabled_at        timestamptz,
  invited_at         timestamptz,
  email_confirmed_at timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_owner() then
    raise exception 'Only an active owner may list the accounts.'
      using errcode = '42501';
  end if;

  return query
    select p.user_id,
           p.name,
           u.email::text,
           p.role,
           p.disabled_at,
           u.invited_at,
           u.email_confirmed_at,
           p.created_at,
           p.updated_at
      from public.profiles p
      join auth.users u on u.id = p.user_id
     order by (p.disabled_at is not null), (p.role <> 'owner'), lower(p.name), p.created_at;
end;
$fn$;

comment on function public.list_accounts() is
  'The accounts as the Owner administers them: profile facts joined to the Auth e-mail and invitation state. Raises 42501 for anybody but an active owner (phase 11C).';

revoke all on function public.list_accounts() from public, anon;
grant execute on function public.list_accounts() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. create_account_profile() — the profile behind an invitation
-- ---------------------------------------------------------------------------
-- The Auth user exists first (the Auth Admin invitation created it); this function
-- gives that identity its application authorisation. `p_user_id` is the id the Auth
-- system returned for the invited e-mail — a foreign key, so an id naming no Auth
-- user is `no_auth_user`, never a row. An identity that already has a profile is
-- `exists`, so a retried invitation cannot duplicate or overwrite one.

create or replace function public.create_account_profile(
  p_user_id uuid,
  p_name    text,
  p_role    text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.profiles%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Only an active owner may create an account.'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('owner', 'staff') then
    raise exception 'Unknown role "%": the roles are owner and staff.', p_role
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where p.user_id = p_user_id) then
    return jsonb_build_object('status', 'exists');
  end if;

  perform pg_catalog.set_config('app.account_write', 'create', true);

  begin
    insert into public.profiles (user_id, name, role)
    values (p_user_id, p_name, p_role)
    returning * into v_row;
  exception
    when foreign_key_violation then
      perform pg_catalog.set_config('app.account_write', '', true);
      return jsonb_build_object('status', 'no_auth_user');
    when check_violation then
      perform pg_catalog.set_config('app.account_write', '', true);
      return jsonb_build_object('status', 'invalid');
  end;

  perform pg_catalog.set_config('app.account_write', '', true);

  perform public.log_audit(
    'invite',
    'profile',
    p_user_id,
    null,
    jsonb_build_object('name', v_row.name, 'role', v_row.role, 'disabled_at', v_row.disabled_at)
  );

  return jsonb_build_object('status', 'created', 'updated_at', v_row.updated_at);
end;
$fn$;

comment on function public.create_account_profile(uuid, text, text) is
  'Creates the profile behind an invited Auth identity: owner only, role from the closed vocabulary, refused as exists / no_auth_user / invalid rather than raising, audited as invite (phase 11C).';

revoke all on function public.create_account_profile(uuid, text, text) from public, anon;
grant execute on function public.create_account_profile(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. set_account_role() — Staff <-> Owner
-- ---------------------------------------------------------------------------

create or replace function public.set_account_role(
  p_user_id             uuid,
  p_role                text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row           public.profiles%rowtype;
  v_active_owners integer;
  v_updated_at    timestamptz;
  v_moved         integer;
begin
  if not public.is_owner() then
    raise exception 'Only an active owner may change a role.'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('owner', 'staff') then
    raise exception 'Unknown role "%": the roles are owner and staff.', p_role
      using errcode = '22023';
  end if;

  perform public.owner_invariant_lock();

  select * into v_row
    from public.profiles p
   where p.user_id = p_user_id
     for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('status', 'stale');
  end if;

  if v_row.role = p_role then
    return jsonb_build_object('status', 'unchanged');
  end if;

  -- Demoting an active owner: is there another one? Counted under the lock, after
  -- every earlier transaction committed, so two owners demoting each other at once
  -- cannot both pass.
  if v_row.role = 'owner' and v_row.disabled_at is null then
    select count(*) into v_active_owners
      from public.profiles p
     where p.role = 'owner'
       and p.disabled_at is null;

    if v_active_owners <= 1 then
      return jsonb_build_object('status', 'last_owner');
    end if;
  end if;

  -- The audit row is written BEFORE the column moves, in the same transaction:
  -- log_audit() re-checks is_staff() for the actor, and an owner demoting or
  -- deactivating *themselves* is no longer what that check requires once the row
  -- has moved. Atomicity is the transaction's — a failed UPDATE takes the audit row
  -- down with it.
  perform public.log_audit(
    'role',
    'profile',
    p_user_id,
    jsonb_build_object('role', v_row.role, 'disabled_at', v_row.disabled_at),
    jsonb_build_object('role', p_role, 'disabled_at', v_row.disabled_at)
  );

  perform pg_catalog.set_config('app.account_write', 'role', true);

  update public.profiles
     set role = p_role
   where user_id = p_user_id
  returning updated_at into v_updated_at;

  get diagnostics v_moved = row_count;

  perform pg_catalog.set_config('app.account_write', '', true);

  if v_moved <> 1 then
    raise exception 'set_account_role: the row was read but could not be written.';
  end if;

  return jsonb_build_object('status', 'updated', 'updated_at', v_updated_at);
end;
$fn$;

comment on function public.set_account_role(uuid, text, timestamptz) is
  'Changes an account''s role: owner only, version-checked, the last active owner refused as last_owner under the invariant lock, audited as role (phase 11C).';

revoke all on function public.set_account_role(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_account_role(uuid, text, timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. set_account_active() — deactivate / reactivate
-- ---------------------------------------------------------------------------
-- Deactivation is `disabled_at = now()`; reactivation clears it and the account
-- keeps the role it had. Nothing else about the row moves. The Auth-side ban that
-- refuses the person's tokens is the application's step, taken after this commit
-- (`lib/accounts/admin.ts`); the database's own refusal is immediate regardless,
-- because `is_staff()` reads `disabled_at`.

create or replace function public.set_account_active(
  p_user_id             uuid,
  p_active              boolean,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row           public.profiles%rowtype;
  v_active_owners integer;
  v_updated_at    timestamptz;
  v_moved         integer;
  v_disabled_at   timestamptz;
  v_sessions      integer := 0;
begin
  if not public.is_owner() then
    raise exception 'Only an active owner may deactivate or reactivate an account.'
      using errcode = '42501';
  end if;

  if p_active is null then
    raise exception 'set_account_active: p_active must be true or false.'
      using errcode = '22023';
  end if;

  perform public.owner_invariant_lock();

  select * into v_row
    from public.profiles p
   where p.user_id = p_user_id
     for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object('status', 'stale');
  end if;

  if p_active = (v_row.disabled_at is null) then
    return jsonb_build_object('status', 'unchanged');
  end if;

  if not p_active and v_row.role = 'owner' then
    select count(*) into v_active_owners
      from public.profiles p
     where p.role = 'owner'
       and p.disabled_at is null;

    if v_active_owners <= 1 then
      return jsonb_build_object('status', 'last_owner');
    end if;
  end if;

  v_disabled_at := case when p_active then null else pg_catalog.now() end;

  -- Audit first, for the reason set_account_role() states: an owner deactivating
  -- themselves is not staff any more once the row has moved, and log_audit()
  -- would refuse them. The transaction keeps the writes atomic.
  perform public.log_audit(
    case when p_active then 'reactivate' else 'deactivate' end,
    'profile',
    p_user_id,
    jsonb_build_object('role', v_row.role, 'disabled_at', v_row.disabled_at),
    jsonb_build_object('role', v_row.role, 'disabled_at', v_disabled_at)
  );

  perform pg_catalog.set_config('app.account_write', 'active', true);

  update public.profiles
     set disabled_at = v_disabled_at
   where user_id = p_user_id
  returning updated_at into v_updated_at;

  get diagnostics v_moved = row_count;

  if v_moved <> 1 then
    perform pg_catalog.set_config('app.account_write', '', true);
    raise exception 'set_account_active: the row was read but could not be written.';
  end if;

  perform pg_catalog.set_config('app.account_write', '', true);

  -- Deactivation ends every session the Auth server holds for the person, in this
  -- same transaction — under its own single-use marker, which is what admits the
  -- call (section 9). Its own, because the profiles consumer trigger has already
  -- spent `app.account_write` at the end of the UPDATE statement above.
  if not p_active then
    perform pg_catalog.set_config('app.account_sessions', 'revoke', true);
    v_sessions := public.revoke_account_sessions(p_user_id);
    perform pg_catalog.set_config('app.account_sessions', '', true);
  end if;

  return jsonb_build_object('status', 'updated', 'updated_at', v_updated_at, 'sessions_revoked', v_sessions);
end;
$fn$;

comment on function public.set_account_active(uuid, boolean, timestamptz) is
  'Deactivates (disabled_at = now(), every Auth session revoked) or reactivates (disabled_at = null) an account: owner only, version-checked, the last active owner refused as last_owner under the invariant lock, audited as deactivate / reactivate (phase 11C).';

revoke all on function public.set_account_active(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_account_active(uuid, boolean, timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. revoke_account_sessions() — the Auth sessions of a deactivated account
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, because `auth.sessions` is the Auth server's table and
-- `authenticated` holds nothing on it. Two conditions admit the call, and both are
-- the transition's to establish: the transaction-local `app.account_sessions`
-- marker names `revoke` (raised by set_account_active() immediately before the
-- call, cleared immediately after, and by nothing a PostgREST request can reach —
-- `set_config` is in pg_catalog, which PostgREST does not expose), and the target's
-- profile is deactivated. A direct RPC — Owner, Staff or anonymous — meets 42501,
-- and nothing about an active account can be revoked through it. The function
-- consumes the marker itself as well, so it admits exactly one call.
-- `refresh_tokens.session_id` cascades from `sessions`, so the refresh tokens go
-- with the sessions.

create or replace function public.revoke_account_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  if coalesce(pg_catalog.current_setting('app.account_sessions', true), '') <> 'revoke' then
    raise exception 'revoke_account_sessions: sessions are revoked only by set_account_active() (phase 11C)'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.account_sessions', '', true);

  if not exists (
    select 1 from public.profiles p
     where p.user_id = p_user_id
       and p.disabled_at is not null
  ) then
    raise exception 'revoke_account_sessions: only a deactivated account''s sessions are revoked (phase 11C)'
      using errcode = '42501';
  end if;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_count = row_count;

  return v_count;
end;
$fn$;

comment on function public.revoke_account_sessions(uuid) is
  'Removes every auth.sessions row (and, by cascade, every refresh token) of a deactivated account. Admitted only under the single-use app.account_sessions = revoke marker set_account_active() raises; a direct call is 42501 (phase 11C).';

revoke all on function public.revoke_account_sessions(uuid) from public, anon;
grant execute on function public.revoke_account_sessions(uuid) to authenticated;
