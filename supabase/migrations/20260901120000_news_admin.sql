-- Klingenberg Food — news administration (phase 9A).
-- Technical plan §4, §5, §6, §7f, §15 (phase 9).
--
-- News keeps the persistence model phase 1 gave it and phase 4 wired up: **no `draft`
-- column**. An article is pending while `status = 'draft'`, `publish_news()` flips that
-- status inside one audited transaction, and an edit writes the row's own columns
-- directly — visibility is decided by `status`, never by which columns hold the words.
-- Nothing here changes that model; this migration adds the two lifecycle transitions
-- the model names and phase 4 did not need yet:
--
--   * `unpublish_news()`  — §7f: "Unpublish removes the article from /nyheder, from the
--     Forside teaser and from the sitemap, and makes the detail URL 404. The row is
--     kept, so republishing restores the same URL." The status flips back to 'draft'
--     and `published_at` deliberately survives, for two reasons the plan states: the
--     slug stays frozen (a Facebook link must point at the same article if it comes
--     back), and a republished article keeps its original publication instant rather
--     than inventing a new one.
--
--   * `delete_news()` — §5's "Nyheder: write" together with the DELETE policy and
--     grant phase 1 already gave staff, and frame 1s's own "Slet" control. A hard
--     delete, not a soft one: an article has no equivalent of a dish's menu position
--     to preserve, and §0a D2's "the row is never purged" was decided for dishes, not
--     news. The audit row carries the whole article — title, slug, body, category,
--     dates — because for a deletion the log *is* the recovery story (§4, §8).
--
-- Both functions follow the shape every trusted operation in this repository has:
-- SECURITY INVOKER with `set search_path = ''`, so RLS re-decides every statement
-- against the caller's own JWT; the version token re-checked inside the write itself,
-- so a stale token is a refusal rather than a lost update (§6); one audit row in the
-- same transaction; and a closed jsonb status vocabulary the application maps to
-- Danish sentences.
--
-- What this migration deliberately does NOT contain: no table, no column, no view, no
-- index, no policy, no grant on any table, no trigger, no transition-marker machinery
-- (phase 8's write guard exists because `announcement.previous` is a snapshot one
-- trusted function writes and another believes — news has no such column, so a direct
-- staff UPDATE forges nothing the model does not already allow), and **no SECURITY
-- DEFINER function**. `image_id` is named nowhere, so phase 10's column cannot be
-- touched by anything here.

-- --- unpublish -------------------------------------------------------------------

create or replace function public.unpublish_news(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.news%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  select * into v_row from public.news t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.status = 'draft' then return jsonb_build_object('status', 'nothing_to_unpublish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_before := public.news_content(v_row);

  -- `published_at` is deliberately not cleared: it is what freezes the slug (§7f) and
  -- what a republished article keeps as its original publication instant.
  update public.news t set
    status = 'draft'
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.status = 'published'
  returning * into v_row;

  if not found then
    if exists (select 1 from public.news t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.status = 'published')
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.news_content(v_row);
  perform public.log_audit('unpublish', 'news', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'unpublished', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.unpublish_news(uuid, timestamptz) is
  'Takes one article off the hjemmeside. The row and published_at are kept, so republishing restores the same URL and the original date (§7f).';

-- --- delete ----------------------------------------------------------------------

create or replace function public.delete_news(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row    public.news%rowtype;
  v_before jsonb;
begin
  select * into v_row from public.news t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  -- The whole article, not the metadata shape: after the DELETE commits, this audit
  -- row is the only place the words still exist, and §4 calls the log "the recovery
  -- story". `image_id` is recorded so a phase-10 image is traceable, never written.
  v_before := jsonb_build_object(
    'title',        v_row.title,
    'slug',         v_row.slug,
    'body',         v_row.body,
    'category',     v_row.category,
    'display_date', v_row.display_date,
    'image_id',     v_row.image_id,
    'status',       v_row.status,
    'published_at', v_row.published_at);

  delete from public.news t
   where t.id = p_id
     and t.updated_at = p_expected_updated_at;

  if not found then
    if exists (select 1 from public.news t
                where t.id = p_id and t.updated_at = p_expected_updated_at)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  perform public.log_audit('delete', 'news', p_id, v_before, null);

  return jsonb_build_object(
    'status', 'deleted', 'entity_id', p_id,
    'was_published', v_row.status = 'published');
end;
$fn$;

comment on function public.delete_news(uuid, timestamptz) is
  'Deletes one article, version-checked, with the full content in the audit row — the log is the recovery story (§4).';

-- --- privileges ------------------------------------------------------------------
--
-- The same rule every trusted operation follows (§8): never callable by `anon`, and
-- callable by `authenticated` — where RLS, SECURITY INVOKER and the §5 matrix decide
-- what actually happens.

revoke all on function public.unpublish_news(uuid, timestamptz) from public, anon;
revoke all on function public.delete_news(uuid, timestamptz)    from public, anon;

grant execute on function public.unpublish_news(uuid, timestamptz) to authenticated;
grant execute on function public.delete_news(uuid, timestamptz)    to authenticated;
