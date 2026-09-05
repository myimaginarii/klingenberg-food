-- Klingenberg Food — phase 13B: application rate limiting.
--
-- Technical plan section 8 ("Credential stuffing": Supabase Auth rate limits plus a
-- login-attempt throttle), section 15 (phase 13: rate limiting), section 0ai.
--
-- WHY THE DATABASE, AND NOT PROCESS MEMORY
--
-- The application runs on Vercel, where a Server Action may execute on any of
-- several short-lived instances. A counter kept in a module-level Map would be one
-- counter per instance, forgotten whenever the instance is: an attacker who spreads
-- requests across instances — or simply waits for a cold start — meets no limit at
-- all. The one durable, shared store this system already has is PostgreSQL, so the
-- counters live here, and the decision "allowed or limited" is one atomic statement.
--
-- WHAT THIS MIGRATION ADDS
--
--   * `rate_limit_scopes` — the CLOSED vocabulary of what may be limited, with the
--     tier each scope belongs to: how the subject is derived (`actor` = the calling
--     JWT's `auth.uid()`; `client` = a non-reversible key the server derives from the
--     request), how many hits a window allows, and how long a window is. The rows are
--     inserted by this migration and by nothing else. A caller names a scope; it can
--     never name a limit, a window or a subject that is not its own.
--
--   * `rate_limit_buckets` — one row per (scope, subject, window). Fixed windows,
--     aligned to the epoch: `window_start = floor(now / window) * window`. The row
--     holds a count and nothing else — no IP address, no e-mail address, no request
--     body, no user agent. For `actor` scopes the subject is the profile's uuid; for
--     `client` scopes it is a 64-hex-character HMAC the application derives with a
--     server-side secret, so nothing in this table can be turned back into a person
--     or an address.
--
--   * `consume_rate_limit(scope, subject)` — the one door that moves a counter. It
--     resolves the scope, derives the subject, and does the increment-and-check as a
--     single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which PostgreSQL executes
--     under the row lock: two concurrent calls near the threshold serialise on the
--     row, and the second sees the first's count. There is no read-then-write.
--     `029_rate_limiting.test.sql` proves it through two real sessions (dblink).
--
--   * `peek_rate_limit(scope, subject)` — the same answer without the increment. The
--     sign-in path uses it: it refuses a caller who has already failed too often
--     BEFORE the Auth server is contacted, and consumes only when a sign-in FAILS —
--     so a successful login never counts against anybody (section 0ai).
--
-- SECURITY DEFINER, AND WHY (brief §13)
--
-- Browser roles hold no privilege on either table: `anon` and `authenticated` cannot
-- read a counter, insert a bucket, reset one, or edit a limit. The two functions are
-- therefore SECURITY DEFINER — the only way an `anon` sign-in attempt or an
-- `authenticated` Server Action can move a row those roles cannot touch — with the
-- usual guards of this repository: `search_path` pinned to nothing, a closed
-- parameter vocabulary (a scope must exist in `rate_limit_scopes`, a client subject
-- must match `^[0-9a-f]{64}$`), no identifier ever interpolated, EXECUTE revoked
-- from PUBLIC and granted to the two browser roles only, and the service role not
-- involved. What a caller can do by calling these directly through PostgREST is
-- exactly what the application does: increase its OWN counter. An `actor` scope
-- ignores any subject the caller passes and uses `auth.uid()`; a `client` scope is
-- refused for a caller WITH a session, and a caller without one cannot compute
-- anybody's HMAC. Neither function can decrease a count, and nothing can.
--
-- GROWTH
--
-- A bucket is useful for one window. Whenever a call creates a NEW bucket (count = 1
-- after the upsert), it deletes every bucket whose window started more than two
-- hours ago — twice the longest window. No scheduler, no cron: the table holds at
-- most the buckets touched in the last two hours plus the current ones, and the
-- pgTAP suite proves an old bucket does not survive the next new one.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
--   * It does not limit anything by itself. The application decides which Server
--     Action belongs to which scope (`lib/rate-limit/`), and every authorization
--     check runs exactly as before — a limiter answer is never a permission.
--   * It does not touch the Auth server's own limits (sign-in per IP, e-mails per
--     hour, token verifications), which stay in force underneath and are recorded as
--     deployment prerequisites in the technical plan.
--   * No new policy, no new grant to a browser role, no change to any existing
--     table, function or trigger.


-- ---------------------------------------------------------------------------
-- 1. The closed scope vocabulary
-- ---------------------------------------------------------------------------

create table public.rate_limit_scopes (
  scope          text    primary key,
  keyed_by       text    not null check (keyed_by in ('actor', 'client')),
  max_hits       integer not null check (max_hits > 0),
  window_seconds integer not null check (window_seconds > 0)
);

comment on table public.rate_limit_scopes is
  'The closed vocabulary of rate-limited surfaces and their tiers (phase 13B). Rows are inserted by the migration only; browser roles cannot read or write them. Mirrored in lib/rate-limit/scopes.ts, and a unit test keeps the two identical.';

alter table public.rate_limit_scopes enable row level security;
revoke all on table public.rate_limit_scopes from public, anon, authenticated;

-- The tiers, and the legitimate behaviour each one has to leave room for. The
-- application's mirror (`lib/rate-limit/scopes.ts`) records the same reasoning;
-- the numbers must match, and `tests/unit/rate-limit/scopes.test.ts` fails when
-- they do not.
insert into public.rate_limit_scopes (scope, keyed_by, max_hits, window_seconds) values
  -- Sign-in FAILURES per client (an HMAC of the trusted client address): a person
  -- who mistypes a password a few times is nowhere near; a stuffing run is.
  ('auth:signin',          'client',  10,  900),
  -- Sign-in FAILURES per account (an HMAC of the normalised address): the backstop
  -- against a run spread over many addresses at one account. Deliberately looser
  -- than the per-client tier so that an attacker cannot lock the owner out cheaply.
  ('auth:signin-account',  'client',  30,  900),
  -- Password-reset e-mails requested per client.
  ('auth:reset',           'client',   5,  900),
  -- The content tiers were sized from a measurement, not an instinct: the full
  -- certification chain — dozens of complete Staff stories compressed into
  -- minutes — reached 98 saves, 31 publishes and 27 immediate operations for ONE
  -- actor inside one five-minute window. The numbers below leave two to three
  -- times that, which no person reaches, while a script at one request per
  -- second is still refused inside the window.
  -- Ordinary draft saves and in-place edits — a dish, a section, a reorder step, an
  -- alt text, a chosen photograph.
  ('content:save',         'actor',  300,  300),
  -- Publishing, including the dashboard's batch and the news publish/unpublish.
  ('content:publish',      'actor',  120,  300),
  -- The news editor's autosave: a save after every two-second pause with a change.
  -- Even a save every second for five minutes is a script, and is refused.
  ('news:autosave',        'actor',  300,  300),
  -- The immediate paths — sold out and its Fortryd, announcement visibility and
  -- removal, a one-off change removed, a dish deleted, a burger cleared.
  ('operation:immediate',  'actor',  120,  300),
  -- Signed-upload grants and finalisations: a batch of photographs for a new menu
  -- is a few dozen; a flood of 30-megapixel processing is refused.
  ('image:upload-request', 'actor',   60,  600),
  ('image:finalize',       'actor',   60,  600),
  -- Deleting or replacing a photograph the site may be using.
  ('image:destructive',    'actor',   40,  600),
  -- Account administration: invitations send e-mail; transitions revoke sessions.
  -- Still the tightest tiers by far, but sized from evidence: one Owner session
  -- that onboards a few people with a couple of typos, a duplicate and a re-send
  -- is around five invitations and eight transitions, and the numbers must leave
  -- room for two such sessions in an hour (the locked `users-admin` pair is
  -- exactly that, and runs green underneath).
  ('accounts:invite',      'actor',   15, 3600),
  ('accounts:mutation',    'actor',   30, 3600);


-- ---------------------------------------------------------------------------
-- 2. The counters
-- ---------------------------------------------------------------------------

create table public.rate_limit_buckets (
  scope        text        not null references public.rate_limit_scopes (scope),
  subject      text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (scope, subject, window_start)
);

comment on table public.rate_limit_buckets is
  'Rate-limit counters (phase 13B): one row per scope, subject and fixed window. Operational security state — no address, no e-mail, no request content. Browser roles hold no privilege; the two limiter functions are the only door, and old windows are pruned by them.';

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Resolving a call: the scope's rule and the subject
-- ---------------------------------------------------------------------------
-- Shared by both doors. Raises for an unknown scope, for an `actor` scope without a
-- session, and for a `client` scope with one or with a malformed key.

create or replace function public.rate_limit_resolve(
  p_scope   text,
  p_subject text,
  out o_subject        text,
  out o_max_hits       integer,
  out o_window_seconds integer
)
returns record
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_rule public.rate_limit_scopes%rowtype;
  v_uid  uuid;
begin
  select * into v_rule from public.rate_limit_scopes where scope = p_scope;
  if not found then
    raise exception 'Unknown rate-limit scope.'
      using errcode = 'invalid_parameter_value';
  end if;

  v_uid := (select auth.uid());

  if v_rule.keyed_by = 'actor' then
    -- The subject is the caller's own identity, never the parameter.
    if v_uid is null then
      raise exception 'An actor-keyed rate limit needs a session.'
        using errcode = 'insufficient_privilege';
    end if;
    o_subject := v_uid::text;
  else
    -- A client-keyed scope is the sign-in path's: there is no session, and the key is
    -- the application's non-reversible derivation of the client. A caller with a
    -- session has no business here.
    if v_uid is not null then
      raise exception 'A client-keyed rate limit is for callers without a session.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_subject is null or p_subject !~ '^[0-9a-f]{64}$' then
      raise exception 'A client-keyed rate limit needs a derived subject.'
        using errcode = 'invalid_parameter_value';
    end if;
    o_subject := p_subject;
  end if;

  o_max_hits       := v_rule.max_hits;
  o_window_seconds := v_rule.window_seconds;
end;
$fn$;

comment on function public.rate_limit_resolve(text, text) is
  'Internal to the two limiter doors: the scope''s tier and the subject the caller is allowed to count against (phase 13B).';

revoke all on function public.rate_limit_resolve(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. consume_rate_limit() — count one hit, atomically, and answer
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  p_scope   text,
  p_subject text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r              record;
  v_window_start timestamptz;
  v_hits         integer;
begin
  select * into r from public.rate_limit_resolve(p_scope, p_subject);

  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.now()) / r.o_window_seconds) * r.o_window_seconds);

  -- One statement, under the row lock: two callers at the threshold cannot both read
  -- the old count and both write the same new one.
  insert into public.rate_limit_buckets (scope, subject, window_start, hits)
  values (p_scope, r.o_subject, v_window_start, 1)
  on conflict (scope, subject, window_start)
  do update set hits = public.rate_limit_buckets.hits + 1
  returning hits into v_hits;

  -- A brand-new bucket is the moment to forget the old ones. Two hours is twice the
  -- longest window, so nothing that could still be counted is removed.
  if v_hits = 1 then
    delete from public.rate_limit_buckets
     where window_start < pg_catalog.now() - interval '2 hours';
  end if;

  if v_hits > r.o_max_hits then
    return jsonb_build_object(
      'status', 'limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        (v_window_start + make_interval(secs => r.o_window_seconds) - pg_catalog.now())))::integer)
    );
  end if;

  return jsonb_build_object(
    'status', 'allowed',
    'remaining', r.o_max_hits - v_hits
  );
end;
$fn$;

comment on function public.consume_rate_limit(text, text) is
  'Counts one hit against a scope for the caller''s own subject and answers allowed or limited (phase 13B). Atomic per row; prunes windows older than two hours when it creates a bucket; can never lower a count.';

revoke all on function public.consume_rate_limit(text, text) from public;
grant execute on function public.consume_rate_limit(text, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. peek_rate_limit() — the same answer, nothing counted
-- ---------------------------------------------------------------------------

create or replace function public.peek_rate_limit(
  p_scope   text,
  p_subject text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  r              record;
  v_window_start timestamptz;
  v_hits         integer;
begin
  select * into r from public.rate_limit_resolve(p_scope, p_subject);

  v_window_start := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.now()) / r.o_window_seconds) * r.o_window_seconds);

  select b.hits into v_hits
    from public.rate_limit_buckets b
   where b.scope = p_scope
     and b.subject = r.o_subject
     and b.window_start = v_window_start;

  v_hits := coalesce(v_hits, 0);

  if v_hits >= r.o_max_hits then
    return jsonb_build_object(
      'status', 'limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        (v_window_start + make_interval(secs => r.o_window_seconds) - pg_catalog.now())))::integer)
    );
  end if;

  return jsonb_build_object(
    'status', 'allowed',
    'remaining', r.o_max_hits - v_hits
  );
end;
$fn$;

comment on function public.peek_rate_limit(text, text) is
  'Answers whether the caller''s own subject has reached a scope''s limit in the current window, without counting anything (phase 13B). The sign-in path asks before contacting the Auth server.';

revoke all on function public.peek_rate_limit(text, text) from public;
grant execute on function public.peek_rate_limit(text, text) to anon, authenticated;
