-- ===========================================================================
-- Phase 7A — the announcement editor and the public bar
--
-- Design 1ac (the bar and its rules) and 1ad (the editor).
-- Technical plan §4, §6, §7c, §8, §15 (phase 7).
--
-- ONE FUNCTION IS REPLACED. NOTHING ELSE CHANGES.
--
-- No new table, no new view, no new trigger, no new index, no new grant and no new
-- policy. `public.announcement` already exists with every column, CHECK and RLS policy
-- this phase needs (`20260829120000_initial_schema.sql`), and it is already a
-- publishable entity with a draft column and a publish function
-- (`20260829140000_draft_publish_core.sql`). Phase 7A is an editor and a bar on top of
-- what phase 1 and phase 4 already built.
--
-- The one thing that was missing is stated below.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- public.publish_announcement — two additions, and why each is necessary
-- ---------------------------------------------------------------------------
--
-- 1. IT NOW MAKES THE ANNOUNCEMENT VISIBLE.
--
--    The phase-4 function merged the content and left `is_visible` alone, which is
--    correct for the *immediate* path — §6's table names "'Vis besked' off / 'Fjern
--    beskeden nu'" as an immediate write with its own ten-second Fortryd, and an edit
--    must never travel through a draft to switch a bar off. But the table lists only
--    the **off** direction, and nothing else in the system turns a bar on.
--
--    1ad settles it: "Skrive eller ændre → tre trin. Ret → Forhåndsvis → Offentliggør."
--    Offentliggør is how a message reaches the hjemmeside. Without this line a staff
--    member could write an announcement, preview it, publish it, and watch nothing
--    happen — the row would hold a perfect message that `announcement_select_public`
--    would never return, because `is_visible` defaults to false and phase 7B's switch
--    does not exist yet.
--
--    Turning it *off* remains outside this function, and outside every draft, exactly as
--    §6 requires.
--
-- 2. IT NOW REFUSES A MERGE THAT WOULD PRODUCE A MESSAGE NOBODY SHOULD SEE.
--
--    1ac: "Højst én besked ad gangen · Kort besked · Link er valgfrit · **Udløb er
--    påkrævet**". The first three are already enforced by the table — the singleton
--    unique constraint, the 90-character CHECK, and the three link CHECKs. The fourth
--    cannot be a CHECK, because "in the future" is not immutable and Postgres will not
--    accept `now()` in one. So it is checked here, at the only moment it can be checked
--    correctly: the instant the merge happens.
--
--    Two refusals, both returning `invalid_draft` and writing nothing:
--
--      * a merged message that is null or blank — there is no announcement to publish;
--      * a merged `expires_at` that is null or has already passed — a message that
--        nothing would ever take down, or one that is already over.
--
--    The application checks the same two rules first (`announcementPublishOutlook`), so
--    a person is told in Danish rather than meeting a refusal. This is the second
--    answer, given to whatever asks — including a forged request that never rendered a
--    form. Neither layer is trusted to be the only one (§5).
--
-- Everything else is the phase-4 function unchanged: SECURITY INVOKER so RLS re-decides
-- the permission against the caller's own JWT, the same optimistic-concurrency token
-- re-checked inside the UPDATE, the same before/after audit row, the same status
-- vocabulary, the same `set search_path = ''`, and one transaction for all of it.

create or replace function public.publish_announcement(p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row     public.announcement%rowtype;
  v_draft   jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_message text;
  v_expires timestamptz;
begin
  select * into v_row from public.announcement t where t.id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_row.draft is null then return jsonb_build_object('status', 'nothing_to_publish'); end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'updated_at', v_row.updated_at);
  end if;

  v_draft  := v_row.draft;
  v_before := public.announcement_content(v_row);

  -- What the merge below would produce, for the two rules that cannot be constraints.
  -- Read exactly the way the UPDATE reads them, so the check and the write can never
  -- disagree about what is about to go live.
  v_message := case when v_draft ? 'message'    then v_draft ->> 'message'                  else v_row.message    end;
  v_expires := case when v_draft ? 'expires_at' then (v_draft ->> 'expires_at')::timestamptz else v_row.expires_at end;

  if v_message is null or btrim(v_message) = '' then
    return jsonb_build_object('status', 'invalid_draft', 'reason', 'message');
  end if;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('status', 'invalid_draft', 'reason', 'expires_at');
  end if;

  update public.announcement t set
    message    = case when v_draft ? 'message'    then v_draft ->> 'message'                 else t.message    end,
    link_type  = case when v_draft ? 'link_type'  then coalesce(v_draft ->> 'link_type', 'none') else t.link_type  end,
    link_page  = case when v_draft ? 'link_page'  then v_draft ->> 'link_page'                else t.link_page  end,
    link_url   = case when v_draft ? 'link_url'   then v_draft ->> 'link_url'                 else t.link_url   end,
    link_label = case when v_draft ? 'link_label' then v_draft ->> 'link_label'               else t.link_label end,
    expires_at = case when v_draft ? 'expires_at' then (v_draft ->> 'expires_at')::timestamptz else t.expires_at end,
    -- Offentliggør is what puts a message on the hjemmeside (1ad). Switching it off is
    -- the immediate path and never a draft (§6) — phase 7B.
    is_visible = true,
    draft      = null
   where t.id = p_id
     and t.updated_at = p_expected_updated_at
     and t.draft is not null
  returning * into v_row;

  if not found then
    if exists (select 1 from public.announcement t
                where t.id = p_id and t.updated_at = p_expected_updated_at and t.draft is not null)
    then return jsonb_build_object('status', 'forbidden'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;

  v_after := public.announcement_content(v_row);
  perform public.log_audit('publish', 'announcement', v_row.id, v_before, v_after);

  return jsonb_build_object(
    'status', 'published', 'entity_id', v_row.id, 'updated_at', v_row.updated_at,
    'before', v_before, 'after', v_after);
end;
$fn$;

comment on function public.publish_announcement(uuid, timestamptz) is
  'Publishes an edited announcement and makes it visible (1ad: Ret -> Forhaandsvis -> Offentliggoer). Refuses a merge with a blank message or a missing/past expiry (1ac: "Udloeb er paakraevet"). Switching a bar off is the immediate path and never a draft (technical plan section 6) - phase 7B.';

-- The grants the phase-4 migration made are unchanged and still apply: `revoke all …
-- from public, anon` followed by `grant execute … to authenticated`. `create or replace`
-- preserves them, and re-stating them here would only invite the two to drift.
