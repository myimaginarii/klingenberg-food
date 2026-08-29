-- Klingenberg Food — initial schema (technical plan §4, §5, §8).
--
-- One coherent initial migration for phase 1. Once applied and accepted its history is
-- not rewritten; every later schema change is a new forward migration.
--
-- Three properties this file is responsible for, none of which the application may be
-- trusted to provide on its own:
--
--   1. RLS is enabled on every table from the first migration. No table is ever
--      publicly writable, not even briefly.
--   2. `anon` holds no INSERT/UPDATE/DELETE privilege on any application table.
--      Supabase's default privileges grant ALL on new public tables to `anon`; that
--      grant is revoked here for every table. RLS alone would also stop the write, but
--      a missing privilege is a stronger guarantee than a missing policy.
--   3. `anon` cannot read a `draft` column at all. RLS filters rows, not columns, so
--      draft protection is a column-level GRANT: `anon` is granted SELECT on the live
--      content columns by name, and never on `draft`.
--
-- Conventions (§4): every table carries `id`, `created_at`, `updated_at`, `updated_by`.
-- Prices are `price_ore integer` (minor units). Draft state is one nullable `draft
-- jsonb` holding only the changed fields; live columns stay plainly typed.
--
-- Singletons (`weekly_special`, `monthly_burger`, `announcement`, `opening_hours`,
-- `site_contact`) and the three fixed `pages` rows are created at the end of this file.
-- They are given no INSERT and no DELETE policy, so the singleton rule is enforced by
-- the absence of a privilege rather than by a convention the application must remember.


-- ===========================================================================
-- 1. Shared trigger helper
-- ===========================================================================

-- Stamps `updated_at` and attributes the write to the authenticated caller.
-- `updated_by` is taken from the JWT, never from the submitted row, so a client cannot
-- forge attribution by sending someone else's uuid.
create or replace function public.tg_touch_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$fn$;

comment on function public.tg_touch_row() is
  'BEFORE INSERT/UPDATE: stamps updated_at and sets updated_by from the JWT subject.';


-- ===========================================================================
-- 2. profiles — who may log in, and what they may do (§4, §5)
-- ===========================================================================

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  role        text not null,
  disabled_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,

  constraint profiles_role_check check (role in ('owner', 'staff')),
  constraint profiles_name_check check (length(btrim(name)) between 1 and 120)
);

comment on table public.profiles is
  'Admin accounts. Deactivate by setting disabled_at; rows are never deleted, so audit_log attribution survives (§5).';

-- Supports the owner-invariant count and the "list active owners" query.
create index profiles_active_owner_idx
  on public.profiles (role)
  where disabled_at is null;

create trigger profiles_touch
  before insert or update on public.profiles
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 3. Role helpers (§5)
-- ===========================================================================
--
-- SECURITY DEFINER because they read `public.profiles`, which is itself under RLS — an
-- invoker-rights helper would recurse into the very policy that calls it.
--
-- Hardening, per the plan's explicit warning about SECURITY DEFINER:
--   * `set search_path = ''`, so no schema on the caller's path can shadow an object;
--   * every referenced object is schema-qualified;
--   * no parameters at all, so there is no user-controlled SQL to inject into;
--   * EXECUTE revoked from PUBLIC and granted only to `authenticated`.
--
-- `anon` deliberately has no EXECUTE on either helper. No anonymous policy references
-- them: every public policy is a plain filter over live content, and every policy in
-- this file names its role with `TO`, so an `anon` query never evaluates a staff
-- expression.
--
-- A profile with `disabled_at` set is neither staff nor owner, so deactivating a user
-- withdraws their authorization in the database and not merely in the application.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.disabled_at is null
      and p.role in ('owner', 'staff')
  );
$fn$;

comment on function public.is_staff() is
  'True when the current JWT belongs to an enabled staff or owner profile. Owners are staff (§5).';

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.disabled_at is null
      and p.role = 'owner'
  );
$fn$;

comment on function public.is_owner() is
  'True when the current JWT belongs to an enabled owner profile (§5).';

-- `revoke ... from public` is not sufficient on its own: Supabase's default privileges
-- grant EXECUTE on every new function in `public` to `anon` and `authenticated`
-- explicitly, and an explicit grant survives a revoke aimed at PUBLIC. `anon` is
-- therefore named. Without this, an anonymous session could call the role helpers
-- directly — harmless in isolation, since they return false, but it is exactly the kind
-- of quiet default that makes a later function dangerous.
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;


-- ===========================================================================
-- 4. Owner invariant — the system can never end with zero active owners (§4, §5)
-- ===========================================================================
--
-- A DEFERRABLE INITIALLY DEFERRED constraint trigger, so the check runs once at COMMIT
-- rather than after each statement. That is what makes a handover possible inside a
-- single transaction: promote the incoming owner and demote the outgoing one together
-- and the intermediate state is never examined. Any transaction that *ends* with no
-- enabled owner is rejected.
--
-- The WHEN clause is evaluated at statement time, so the trigger only queues when the
-- row being changed was itself an enabled owner. Ordinary staff edits never pay for it,
-- and a database that legitimately holds no owner yet — migration time, before the
-- first account exists — is not blocked.
--
-- DELETE is covered by the same trigger, and so is deleting the underlying auth user:
-- `profiles.user_id` cascades from `auth.users`, so that cascade fires this trigger too.

create or replace function public.enforce_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  active_owners integer;
begin
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
  'Deferred constraint trigger: rejects any transaction that leaves zero enabled owners (§4).';

create constraint trigger profiles_owner_invariant
  after update or delete on public.profiles
  deferrable initially deferred
  for each row
  when (old.role = 'owner' and old.disabled_at is null)
  execute function public.enforce_owner_invariant();


-- ===========================================================================
-- 5. images — media library (§4)
-- ===========================================================================
-- Declared first among the content tables because the others reference it.

create table public.images (
  id                uuid primary key default gen_random_uuid(),
  storage_path      text not null unique,
  alt_text          text,
  width             integer,
  height            integer,
  bytes             bigint,
  mime              text,
  derivatives       jsonb not null default '{}'::jsonb,
  original_filename text,
  uploaded_by       uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,

  constraint images_width_check       check (width  is null or width  > 0),
  constraint images_height_check      check (height is null or height > 0),
  constraint images_bytes_check       check (bytes  is null or bytes  > 0),
  constraint images_derivatives_shape check (jsonb_typeof(derivatives) = 'object')
);

comment on table public.images is
  'Media library. Only derivatives are publicly readable; originals live in a private bucket (§8).';

create index images_created_at_idx on public.images (created_at desc);

create trigger images_touch
  before insert or update on public.images
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 6. menu_categories — the menu sections and their order (§4)
-- ===========================================================================

create table public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  sort_order integer not null default 0,
  intro      text,
  note       text,
  kind       text not null default 'dishes',
  visible    boolean not null default true,
  draft      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint menu_categories_kind_check  check (kind in ('dishes', 'weekly_special')),
  constraint menu_categories_slug_check  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint menu_categories_name_check  check (length(btrim(name)) between 1 and 120),
  constraint menu_categories_draft_shape check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.menu_categories is
  'Menu sections. `visible = false` hides the section from the public site (§4).';

create index menu_categories_sort_idx    on public.menu_categories (sort_order, name);
create index menu_categories_pending_idx on public.menu_categories (updated_at desc) where draft is not null;

create trigger menu_categories_touch
  before insert or update on public.menu_categories
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 7. dishes — every menu item (§4)
-- ===========================================================================
--
-- `labels text[]`: the plan fixes four labels and rules out a `dish_labels` table. The
-- four label *values* are defined by the approved design (frame 1a), which is not part
-- of this repository, so they are deliberately NOT invented here. What is enforced now
-- is the shape the plan does specify — a short, duplicate-free array of non-empty
-- strings. Pinning the enumeration is a one-line forward migration once the design
-- file supplies the values, and is recorded as an open item in docs/dependencies.md.
--
-- `sold_out_on date` replaces revision 1's `is_available boolean` (decision 2). NULL
-- means available; a date means "marked sold out on that Copenhagen-local date". The
-- reset is derived at read time (§7b) and is never stored.

-- A CHECK constraint may not contain a subquery, so the array rules live in an
-- IMMUTABLE helper the constraint calls.
create or replace function public.is_valid_dish_labels(labels text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select
    labels is not null
    and cardinality(labels) <= 4
    and array_position(labels, null) is null
    -- no duplicates, no blank entries
    and cardinality(labels) = (select count(distinct l) from unnest(labels) as l)
    and not exists (select 1 from unnest(labels) as l where length(btrim(l)) = 0);
$fn$;

comment on function public.is_valid_dish_labels(text[]) is
  'Shape rule for dishes.labels: at most four distinct, non-blank strings (§4).';

create table public.dishes (
  id                    uuid primary key default gen_random_uuid(),
  category_id           uuid not null references public.menu_categories (id) on delete restrict,
  name                  text not null,
  description           text,
  secondary_note        text,
  price_ore             integer,
  labels                text[] not null default '{}'::text[],
  details               jsonb,
  image_id              uuid references public.images (id) on delete set null,
  sort_order            integer not null default 0,
  sold_out_on           date,
  sold_out_changed_at   timestamptz,
  sold_out_changed_by   uuid references auth.users (id) on delete set null,
  is_new_draft          boolean not null default false,
  deleted_at            timestamptz,
  draft                 jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id) on delete set null,

  constraint dishes_name_check   check (length(btrim(name)) between 1 and 200),
  constraint dishes_price_check  check (price_ore is null or price_ore between 0 and 1000000),
  constraint dishes_labels_shape  check (public.is_valid_dish_labels(labels)),
  constraint dishes_details_shape check (details is null or jsonb_typeof(details) = 'object'),
  constraint dishes_draft_shape   check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.dishes is
  'Menu items. Soft-deleted via deleted_at; is_new_draft marks a dish that has never been published (§4, §6).';
comment on column public.dishes.sold_out_on is
  'Copenhagen-local date the item was marked sold out. NULL = available. Reset is derived, never stored (§7b).';
comment on column public.dishes.labels is
  'Fixed short label set from the approved design. Shape is constrained here; the value enumeration lands in a forward migration once the design file supplies it.';

create index dishes_category_sort_idx on public.dishes (category_id, sort_order, name);
create index dishes_live_idx          on public.dishes (category_id, sort_order) where deleted_at is null and is_new_draft = false;
create index dishes_pending_idx       on public.dishes (updated_at desc) where draft is not null;
create index dishes_sold_out_idx      on public.dishes (sold_out_on) where sold_out_on is not null;

create trigger dishes_touch
  before insert or update on public.dishes
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 8. Copenhagen-local guards for sold-out dates (§4)
-- ===========================================================================
--
-- The plan asks for "a CHECK ... within ±1 day of now() in Copenhagen to catch
-- timezone slips". Postgres accepts a CHECK containing now(), but only evaluates it on
-- write and never re-validates it, which makes the constraint quietly meaningless the
-- day after it is satisfied. A BEFORE trigger gives exactly the intended semantics —
-- validate what is being written, at the moment it is written — without pretending to
-- be a persistent invariant. It also stamps the sold-out audit columns from the JWT.

create or replace function public.tg_guard_sold_out_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  today_cph date := (now() at time zone 'Europe/Copenhagen')::date;
  col       text;
  val       date;
begin
  foreach col in array tg_argv loop
    execute format('select ($1).%I', col) into val using new;

    if val is not null and val not between today_cph - 1 and today_cph + 1 then
      raise exception
        'Column %.% must be within one day of the current Copenhagen date (%), got %.',
        tg_table_name, col, today_cph, val
        using errcode = 'check_violation',
              hint = 'sold_out_on is always written as today''s Copenhagen-local date (§4, §7b).';
    end if;
  end loop;

  return new;
end;
$fn$;

comment on function public.tg_guard_sold_out_date() is
  'BEFORE INSERT/UPDATE: rejects a sold-out date more than one day from today in Europe/Copenhagen (§4).';

create trigger dishes_sold_out_guard
  before insert or update on public.dishes
  for each row execute function public.tg_guard_sold_out_date('sold_out_on');


-- ===========================================================================
-- 9. weekly_special — Ugens ret + Lørdagsmenu, one singleton row (§4)
-- ===========================================================================

create table public.weekly_special (
  id                uuid primary key default gen_random_uuid(),
  is_singleton      boolean not null default true,
  iso_year          integer,
  iso_week          integer,
  days              text[] not null default '{}'::text[],
  name              text,
  description       text,
  price_small_ore   integer,
  price_large_ore   integer,
  image_id          uuid references public.images (id) on delete set null,
  sold_out_on       date,
  sat_enabled       boolean not null default false,
  sat_name          text,
  sat_description   text,
  sat_price_ore     integer,
  sat_deadline      text,
  sat_sold_out_on   date,
  draft             jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id) on delete set null,

  constraint weekly_special_singleton        check (is_singleton),
  constraint weekly_special_singleton_unique unique (is_singleton),
  constraint weekly_special_year_check       check (iso_year is null or iso_year between 2000 and 2999),
  constraint weekly_special_week_check       check (iso_week is null or iso_week between 1 and 53),
  constraint weekly_special_days_check       check (days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]),
  constraint weekly_special_price_s_check    check (price_small_ore is null or price_small_ore between 0 and 1000000),
  constraint weekly_special_price_l_check    check (price_large_ore is null or price_large_ore between 0 and 1000000),
  constraint weekly_special_sat_price_check  check (sat_price_ore  is null or sat_price_ore  between 0 and 1000000),
  constraint weekly_special_draft_shape      check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.weekly_special is
  'Singleton. There is deliberately no weekly-special history table: "Kopiér sidste uge" copies the live row (§4, §6).';

create trigger weekly_special_touch
  before insert or update on public.weekly_special
  for each row execute function public.tg_touch_row();

create trigger weekly_special_sold_out_guard
  before insert or update on public.weekly_special
  for each row execute function public.tg_guard_sold_out_date('sold_out_on', 'sat_sold_out_on');


-- ===========================================================================
-- 10. monthly_burger — Månedens burger, one singleton row (§4, §7d)
-- ===========================================================================

create table public.monthly_burger (
  id               uuid primary key default gen_random_uuid(),
  is_singleton     boolean not null default true,
  name             text,
  description      text,
  price_ore        integer,
  image_id         uuid references public.images (id) on delete set null,
  starts_on        date,
  ends_on          date,
  sold_out_on      date,
  show_on_homepage boolean not null default false,
  draft            jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,

  constraint monthly_burger_singleton        check (is_singleton),
  constraint monthly_burger_singleton_unique unique (is_singleton),
  constraint monthly_burger_price_check      check (price_ore is null or price_ore between 0 and 1000000),
  constraint monthly_burger_window_check     check (starts_on is null or ends_on is null or starts_on <= ends_on),
  constraint monthly_burger_draft_shape      check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.monthly_burger is
  'Singleton, reused each month. Publishing is always a human action; starts_on/ends_on only decide whether a published item is shown (§7d).';

create trigger monthly_burger_touch
  before insert or update on public.monthly_burger
  for each row execute function public.tg_touch_row();

create trigger monthly_burger_sold_out_guard
  before insert or update on public.monthly_burger
  for each row execute function public.tg_guard_sold_out_date('sold_out_on');


-- ===========================================================================
-- 11. news — Nyheder (§4, §7f)
-- ===========================================================================

create table public.news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text not null unique,
  body         jsonb,
  category     text,
  display_date date,
  image_id     uuid references public.images (id) on delete set null,
  status       text not null default 'draft',
  published_at timestamptz,
  author_id    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,

  constraint news_title_check  check (length(btrim(title)) between 1 and 200),
  constraint news_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint news_status_check check (status in ('draft', 'published')),
  constraint news_body_shape   check (body is null or jsonb_typeof(body) = 'object'),
  -- A published article must record when it was published; the SEO and sitemap layers
  -- rely on it, and unpublishing keeps the row so republishing restores the same URL.
  constraint news_published_at_check check (status <> 'published' or published_at is not null)
);

comment on table public.news is
  'Articles. Body is structured JSON rendered by our own components — never HTML, so there is no sanitizer to get wrong (§8).';

create index news_published_idx on public.news (display_date desc, published_at desc) where status = 'published';
create index news_status_idx    on public.news (status, updated_at desc);

create trigger news_touch
  before insert or update on public.news
  for each row execute function public.tg_touch_row();

-- Slug policy (§7f): frozen once the article has been published, so a link shared on
-- Facebook — the restaurant's only channel — cannot rot when the title is edited later.
create or replace function public.tg_freeze_published_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if old.published_at is not null and new.slug is distinct from old.slug then
    raise exception
      'The address of a published article cannot be changed (slug % is frozen).', old.slug
      using errcode = 'check_violation',
            hint = 'Editing the title of a published article deliberately leaves its URL untouched (§7f).';
  end if;
  return new;
end;
$fn$;

comment on function public.tg_freeze_published_slug() is
  'BEFORE UPDATE on news: rejects a slug change once the article has been published (§7f).';

create trigger news_freeze_slug
  before update on public.news
  for each row execute function public.tg_freeze_published_slug();


-- ===========================================================================
-- 12. announcement — the site announcement bar, one singleton row (§4, §7c)
-- ===========================================================================

create table public.announcement (
  id           uuid primary key default gen_random_uuid(),
  is_singleton boolean not null default true,
  message      text,
  link_type    text not null default 'none',
  link_page    text,
  link_url     text,
  link_label   text,
  expires_at   timestamptz,
  is_visible   boolean not null default false,
  source       text not null default 'manual',
  previous     jsonb,
  replaced_at  timestamptz,
  draft        jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,

  constraint announcement_singleton        check (is_singleton),
  constraint announcement_singleton_unique unique (is_singleton),
  constraint announcement_message_check    check (message is null or length(message) <= 90),
  constraint announcement_link_type_check  check (link_type in ('none', 'page', 'url')),
  constraint announcement_source_check     check (source in ('manual', 'opening_hours')),
  constraint announcement_draft_shape      check (draft is null or jsonb_typeof(draft) = 'object'),
  constraint announcement_previous_shape   check (previous is null or jsonb_typeof(previous) = 'object'),

  -- Open-redirect prevention (§8). An internal link is one of our own routes, chosen
  -- from a closed set; an external link must be https. Neither is free-form.
  constraint announcement_link_page_check check (
    link_page is null
    or link_page in ('/', '/menu', '/mad-ud-af-huset', '/om-os', '/nyheder', '/find-os')
  ),
  constraint announcement_link_url_check check (
    link_url is null or link_url ~ '^https://[^\s]+$'
  ),
  constraint announcement_link_shape_check check (
    (link_type = 'none' and link_page is null and link_url is null)
    or (link_type = 'page' and link_page is not null and link_url is null)
    or (link_type = 'url'  and link_url  is not null and link_page is null)
  )
);

comment on table public.announcement is
  'Singleton. There is no announcement archive by design — one at a time, with the replaced values stashed in `previous` for a 10 s undo (§4, §6).';

create trigger announcement_touch
  before insert or update on public.announcement
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 13. opening_hours — the normal weekly schedule, one singleton row (§4)
-- ===========================================================================
--
-- Owner-only for writes (§5). The shape is validated here rather than trusted, because
-- the hours engine, the "Åbent nu" badge and the sold-out reset all read it (§7).

create or replace function public.is_valid_opening_schedule(schedule jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select
    jsonb_typeof(schedule) = 'object'
    -- exactly the seven weekday keys, no more and no fewer
    and (select array_agg(k order by k) from jsonb_object_keys(schedule) as k)
        = array['fri','mon','sat','sun','thu','tue','wed']::text[]
    -- every day is either {"closed": true} or {"from": "HH:MM", "to": "HH:MM"}
    and not exists (
      select 1
      from jsonb_each(schedule) as e(day, spec)
      where not (
        (spec = '{"closed": true}'::jsonb)
        or (
          jsonb_typeof(spec) = 'object'
          and (select array_agg(k order by k) from jsonb_object_keys(spec) as k)
              = array['from','to']::text[]
          and spec ->> 'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and spec ->> 'to'   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and spec ->> 'from' < spec ->> 'to'
        )
      )
    );
$fn$;

comment on function public.is_valid_opening_schedule(jsonb) is
  'Validates the seven-day opening-hours document: each day is {"closed":true} or {"from":"HH:MM","to":"HH:MM"} (§4).';

create table public.opening_hours (
  id           uuid primary key default gen_random_uuid(),
  is_singleton boolean not null default true,
  schedule     jsonb not null,
  draft        jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,

  constraint opening_hours_singleton        check (is_singleton),
  constraint opening_hours_singleton_unique unique (is_singleton),
  constraint opening_hours_schedule_shape   check (public.is_valid_opening_schedule(schedule)),
  constraint opening_hours_draft_shape      check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.opening_hours is
  'Singleton. Owner-only for writes (§5) — the normal weekly schedule defines the business.';

create trigger opening_hours_touch
  before insert or update on public.opening_hours
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 14. opening_hours_overrides — one-off changes (§4, §7e)
-- ===========================================================================

create table public.opening_hours_overrides (
  id                   uuid primary key default gen_random_uuid(),
  date                 date not null unique,
  kind                 text not null,
  opens_at             time,
  closes_at            time,
  announcement_created boolean not null default false,
  status               text not null default 'draft',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,

  constraint overrides_kind_check   check (kind in ('closed', 'custom')),
  constraint overrides_status_check check (status in ('draft', 'published')),
  constraint overrides_shape_check  check (
    (kind = 'closed' and opens_at is null and closes_at is null)
    or (kind = 'custom' and opens_at is not null and closes_at is not null and opens_at < closes_at)
  )
);

comment on table public.opening_hours_overrides is
  'One-off opening-hour changes. Staff-writable (§5); honoured in both directions by the sold-out reset (§7b).';

create index overrides_published_idx on public.opening_hours_overrides (date) where status = 'published';

create trigger opening_hours_overrides_touch
  before insert or update on public.opening_hours_overrides
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 15. pages — editable page documents (§4)
-- ===========================================================================
--
-- Three fixed rows, created at the end of this file. No INSERT and no DELETE policy:
-- the set of pages is part of the design, not user data. `home` is owner-only for
-- writes (§5); the other two are staff-writable.

create table public.pages (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  published  jsonb not null default '{}'::jsonb,
  draft      jsonb,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint pages_key_check         check (key in ('home', 'takeaway', 'about')),
  constraint pages_published_shape   check (jsonb_typeof(published) = 'object'),
  constraint pages_draft_shape       check (draft is null or jsonb_typeof(draft) = 'object')
);

comment on table public.pages is
  'Editable page documents. `home` is owner-controlled; `takeaway` carries the Mad ud af huset visibility toggle (§4, §5).';

create trigger pages_touch
  before insert or update on public.pages
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 16. site_contact — contact facts used everywhere, one singleton row (§4)
-- ===========================================================================

create table public.site_contact (
  id              uuid primary key default gen_random_uuid(),
  is_singleton    boolean not null default true,
  primary_phone   text,
  secondary_phone text,
  address_line1   text,
  postal_code     text,
  city            text,
  venue_name      text,
  email           text,
  facebook_url    text,
  map_attribution text,
  draft           jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,

  constraint site_contact_singleton        check (is_singleton),
  constraint site_contact_singleton_unique unique (is_singleton),
  constraint site_contact_draft_shape      check (draft is null or jsonb_typeof(draft) = 'object'),
  constraint site_contact_facebook_check   check (facebook_url is null or facebook_url ~ '^https://[^\s]+$'),
  constraint site_contact_email_check      check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.site_contact is
  'Singleton. Owner-only for writes (§5) — these facts define the business and appear on every page.';

create trigger site_contact_touch
  before insert or update on public.site_contact
  for each row execute function public.tg_touch_row();


-- ===========================================================================
-- 17. audit_log — who changed what, and the recovery story (§4, §8)
-- ===========================================================================
--
-- Owner-readable, and writable through one vetted function only. `audit_log` gets no
-- INSERT, UPDATE or DELETE policy at all, so even an owner cannot write a row directly:
-- the only path is `public.log_audit()`, which stamps `actor_id` from the JWT. That
-- makes attribution unforgeable and the log append-only from the application's side.

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now(),

  constraint audit_log_action_check check (length(btrim(action)) between 1 and 80),
  constraint audit_log_entity_check check (length(btrim(entity)) between 1 and 80)
);

comment on table public.audit_log is
  'Append-only change history. Owner-readable; written only through public.log_audit() (§4, §5, §8).';

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx     on public.audit_log (entity, entity_id, created_at desc);

create or replace function public.log_audit(
  p_action    text,
  p_entity    text,
  p_entity_id uuid default null,
  p_before    jsonb default null,
  p_after     jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  new_id uuid;
begin
  -- The function is the authorization point, not the caller. A non-staff session that
  -- somehow obtains EXECUTE still cannot write a row.
  if not public.is_staff() then
    raise exception 'Only staff may write to the audit log.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, p_before, p_after)
  returning id into new_id;

  return new_id;
end;
$fn$;

comment on function public.log_audit(text, text, uuid, jsonb, jsonb) is
  'The only write path into audit_log. actor_id is taken from the JWT, never from a parameter (§8).';

revoke all on function public.log_audit(text, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit(text, text, uuid, jsonb, jsonb) to authenticated;


-- ===========================================================================
-- 17b. Function privileges (§8)
-- ===========================================================================
--
-- Same default-privilege problem as the role helpers, applied to the rest of this
-- schema's functions. Trigger functions are never called directly by a client — the
-- trigger mechanism checks EXECUTE when the trigger is created, not when it fires — so
-- nothing needs a grant back. The two validators are called from CHECK constraints
-- evaluated during a write, so `authenticated` keeps EXECUTE on those.

revoke all on function public.tg_touch_row()                          from public, anon, authenticated;
revoke all on function public.enforce_owner_invariant()               from public, anon, authenticated;
revoke all on function public.tg_guard_sold_out_date()                from public, anon, authenticated;
revoke all on function public.tg_freeze_published_slug()              from public, anon, authenticated;

revoke all on function public.is_valid_dish_labels(text[])            from public, anon;
revoke all on function public.is_valid_opening_schedule(jsonb)        from public, anon;
grant execute on function public.is_valid_dish_labels(text[])         to authenticated;
grant execute on function public.is_valid_opening_schedule(jsonb)     to authenticated;


-- ===========================================================================
-- 18. Privileges (§8)
-- ===========================================================================
--
-- Supabase's default privileges grant ALL — including INSERT, UPDATE and DELETE — to
-- `anon` and `authenticated` on every new table in `public`. Both are revoked here and
-- re-granted deliberately.
--
-- `anon` receives SELECT on named columns only. `draft` is never among them, which is
-- what makes "the public cannot read drafts" a privilege guarantee rather than a
-- policy that might one day be written loosely. `profiles` and `audit_log` are granted
-- to `anon` not at all.
--
-- A consequence worth stating: `select *` as `anon` fails on these tables. That is
-- intended. Public queries name their columns.

revoke all on all tables in schema public from anon, authenticated;

-- --- anon: read-only, live content columns only ---------------------------------

grant select (id, slug, name, sort_order, intro, note, kind, visible, updated_at)
  on public.menu_categories to anon;

grant select (id, category_id, name, description, secondary_note, price_ore, labels,
              details, image_id, sort_order, sold_out_on, updated_at)
  on public.dishes to anon;

grant select (id, iso_year, iso_week, days, name, description, price_small_ore,
              price_large_ore, image_id, sold_out_on, sat_enabled, sat_name,
              sat_description, sat_price_ore, sat_deadline, sat_sold_out_on, updated_at)
  on public.weekly_special to anon;

grant select (id, name, description, price_ore, image_id, starts_on, ends_on,
              sold_out_on, show_on_homepage, updated_at)
  on public.monthly_burger to anon;

grant select (id, title, slug, body, category, display_date, image_id, published_at, updated_at)
  on public.news to anon;

grant select (id, message, link_type, link_page, link_url, link_label, expires_at,
              is_visible, source, updated_at)
  on public.announcement to anon;

grant select (id, schedule, updated_at)
  on public.opening_hours to anon;

grant select (id, date, kind, opens_at, closes_at, status, updated_at)
  on public.opening_hours_overrides to anon;

grant select (id, key, published, is_visible, updated_at)
  on public.pages to anon;

grant select (id, primary_phone, secondary_phone, address_line1, postal_code, city,
              venue_name, email, facebook_url, map_attribution, updated_at)
  on public.site_contact to anon;

grant select (id, storage_path, alt_text, width, height, bytes, mime, derivatives, updated_at)
  on public.images to anon;

-- --- authenticated: full columns; RLS decides the rows and the verbs -------------

grant select, insert, update, delete on public.menu_categories          to authenticated;
grant select, insert, update, delete on public.dishes                   to authenticated;
grant select, insert, update, delete on public.news                     to authenticated;
grant select, insert, update, delete on public.opening_hours_overrides  to authenticated;
grant select, insert, update, delete on public.images                   to authenticated;
grant select, insert, update, delete on public.profiles                 to authenticated;

-- Singletons and the fixed page rows: read and update only. No INSERT, no DELETE — the
-- rows are created by this migration and cannot be added to or removed by anyone.
grant select, update on public.weekly_special to authenticated;
grant select, update on public.monthly_burger to authenticated;
grant select, update on public.announcement   to authenticated;
grant select, update on public.opening_hours  to authenticated;
grant select, update on public.site_contact   to authenticated;
grant select, update on public.pages          to authenticated;

-- Append-only from the application's side: readable by owners, written only by
-- public.log_audit(). No INSERT privilege is granted to anyone.
grant select on public.audit_log to authenticated;


-- ===========================================================================
-- 19. Row Level Security (§5, §8)
-- ===========================================================================
--
-- RLS is enabled on every table. Every policy names its role with `TO`, so an `anon`
-- query never evaluates a staff expression and vice versa — which is also why `anon`
-- needs no EXECUTE on the role helpers.
--
-- The permission matrix in §5 is implemented literally:
--   * staff: dishes, categories, weekly, monthly, news, announcement, overrides,
--     images, and the takeaway/about pages;
--   * owner only: opening_hours, site_contact, pages.home, profiles, audit_log.

alter table public.profiles                enable row level security;
alter table public.images                  enable row level security;
alter table public.menu_categories         enable row level security;
alter table public.dishes                  enable row level security;
alter table public.weekly_special          enable row level security;
alter table public.monthly_burger          enable row level security;
alter table public.news                    enable row level security;
alter table public.announcement            enable row level security;
alter table public.opening_hours           enable row level security;
alter table public.opening_hours_overrides enable row level security;
alter table public.pages                   enable row level security;
alter table public.site_contact            enable row level security;
alter table public.audit_log               enable row level security;

-- --- profiles ---------------------------------------------------------------------
-- A person may always see their own profile — the admin header needs their name and
-- role. Everything else about accounts is owner business.

create policy profiles_select_self_or_owner on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner());

create policy profiles_insert_owner on public.profiles
  for insert to authenticated
  with check (public.is_owner());

create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy profiles_delete_owner on public.profiles
  for delete to authenticated
  using (public.is_owner());

-- --- images -----------------------------------------------------------------------

create policy images_select_public on public.images
  for select to anon
  using (true);

create policy images_select_staff on public.images
  for select to authenticated using (public.is_staff());
create policy images_insert_staff on public.images
  for insert to authenticated with check (public.is_staff());
create policy images_update_staff on public.images
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy images_delete_staff on public.images
  for delete to authenticated using (public.is_staff());

-- --- menu_categories --------------------------------------------------------------

create policy menu_categories_select_public on public.menu_categories
  for select to anon
  using (visible);

create policy menu_categories_select_staff on public.menu_categories
  for select to authenticated using (public.is_staff());
create policy menu_categories_insert_staff on public.menu_categories
  for insert to authenticated with check (public.is_staff());
create policy menu_categories_update_staff on public.menu_categories
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy menu_categories_delete_staff on public.menu_categories
  for delete to authenticated using (public.is_staff());

-- --- dishes -----------------------------------------------------------------------
-- Public sees published, undeleted dishes. `is_new_draft` marks a dish that has never
-- been published, so it must not appear before someone presses Offentliggør.

create policy dishes_select_public on public.dishes
  for select to anon
  using (deleted_at is null and is_new_draft = false);

create policy dishes_select_staff on public.dishes
  for select to authenticated using (public.is_staff());
create policy dishes_insert_staff on public.dishes
  for insert to authenticated with check (public.is_staff());
create policy dishes_update_staff on public.dishes
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy dishes_delete_staff on public.dishes
  for delete to authenticated using (public.is_staff());

-- --- weekly_special ---------------------------------------------------------------

create policy weekly_special_select_public on public.weekly_special
  for select to anon
  using (true);

create policy weekly_special_select_staff on public.weekly_special
  for select to authenticated using (public.is_staff());
create policy weekly_special_update_staff on public.weekly_special
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- monthly_burger ---------------------------------------------------------------
-- Defence in depth for §7d: the read-time date window is applied by the application,
-- and again here, so a published-but-not-yet-current burger is not readable publicly
-- even if a public query forgets the filter.

create policy monthly_burger_select_public on public.monthly_burger
  for select to anon
  using (
    name is not null
    and (starts_on is null or starts_on <= (now() at time zone 'Europe/Copenhagen')::date)
    and (ends_on   is null or ends_on   >= (now() at time zone 'Europe/Copenhagen')::date)
  );

create policy monthly_burger_select_staff on public.monthly_burger
  for select to authenticated using (public.is_staff());
create policy monthly_burger_update_staff on public.monthly_burger
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- news -------------------------------------------------------------------------

create policy news_select_public on public.news
  for select to anon
  using (status = 'published');

create policy news_select_staff on public.news
  for select to authenticated using (public.is_staff());
create policy news_insert_staff on public.news
  for insert to authenticated with check (public.is_staff());
create policy news_update_staff on public.news
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy news_delete_staff on public.news
  for delete to authenticated using (public.is_staff());

-- --- announcement -----------------------------------------------------------------
-- The server remains the primary expiry filter (§7c); the client guard only removes a
-- bar that expires while the page is open.

create policy announcement_select_public on public.announcement
  for select to anon
  using (is_visible and message is not null and expires_at is not null and expires_at > now());

create policy announcement_select_staff on public.announcement
  for select to authenticated using (public.is_staff());
create policy announcement_update_staff on public.announcement
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- --- opening_hours ----------------------------------------------------------------
-- Staff may read the hours — the engine, the badge and the sold-out reset all need
-- them — but only an owner may change them (§5).

create policy opening_hours_select_public on public.opening_hours
  for select to anon
  using (true);

create policy opening_hours_select_staff on public.opening_hours
  for select to authenticated using (public.is_staff());
create policy opening_hours_update_owner on public.opening_hours
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- --- opening_hours_overrides ------------------------------------------------------

create policy overrides_select_public on public.opening_hours_overrides
  for select to anon
  using (status = 'published' and date >= (now() at time zone 'Europe/Copenhagen')::date);

create policy overrides_select_staff on public.opening_hours_overrides
  for select to authenticated using (public.is_staff());
create policy overrides_insert_staff on public.opening_hours_overrides
  for insert to authenticated with check (public.is_staff());
create policy overrides_update_staff on public.opening_hours_overrides
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy overrides_delete_staff on public.opening_hours_overrides
  for delete to authenticated using (public.is_staff());

-- --- pages ------------------------------------------------------------------------
-- Forsiden is owner-controlled (§5). The USING clause names the row being changed and
-- the WITH CHECK clause names the row after the change, so a staff member can neither
-- edit `home` nor rename another page into `home`.

create policy pages_select_public on public.pages
  for select to anon
  using (is_visible);

create policy pages_select_staff on public.pages
  for select to authenticated using (public.is_staff());

create policy pages_update_scoped on public.pages
  for update to authenticated
  using (
    case when key = 'home' then public.is_owner() else public.is_staff() end
  )
  with check (
    case when key = 'home' then public.is_owner() else public.is_staff() end
  );

-- --- site_contact -----------------------------------------------------------------

create policy site_contact_select_public on public.site_contact
  for select to anon
  using (true);

create policy site_contact_select_staff on public.site_contact
  for select to authenticated using (public.is_staff());
create policy site_contact_update_owner on public.site_contact
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- --- audit_log --------------------------------------------------------------------
-- Owner-readable. No write policy of any kind: public.log_audit() is the only door.

create policy audit_log_select_owner on public.audit_log
  for select to authenticated
  using (public.is_owner());


-- ===========================================================================
-- 20. Singleton rows and the fixed page documents
-- ===========================================================================
--
-- Created here rather than in the seed because the application is given no INSERT
-- privilege on these tables. Production would otherwise start with nothing to update.
-- Values are left empty; the confirmed restaurant facts are applied by supabase/seed.sql
-- locally, and by the owner through the admin in production.
--
-- opening_hours.schedule is NOT NULL and shape-checked, so it needs a valid starting
-- document. Every day closed is the only neutral choice that invents nothing: it is
-- visibly wrong in the admin until an owner sets the real hours, rather than quietly
-- plausible.

insert into public.weekly_special (is_singleton) values (true);
insert into public.monthly_burger (is_singleton) values (true);
insert into public.announcement   (is_singleton) values (true);
insert into public.site_contact   (is_singleton) values (true);

insert into public.opening_hours (is_singleton, schedule)
values (
  true,
  jsonb_build_object(
    'mon', jsonb_build_object('closed', true),
    'tue', jsonb_build_object('closed', true),
    'wed', jsonb_build_object('closed', true),
    'thu', jsonb_build_object('closed', true),
    'fri', jsonb_build_object('closed', true),
    'sat', jsonb_build_object('closed', true),
    'sun', jsonb_build_object('closed', true)
  )
);

insert into public.pages (key, published, is_visible) values
  ('home',     '{}'::jsonb, true),
  ('takeaway', '{}'::jsonb, true),
  ('about',    '{}'::jsonb, true);
