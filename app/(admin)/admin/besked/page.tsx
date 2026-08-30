import { notFound } from 'next/navigation'

import { AnnouncementEditor } from '@/components/admin/announcement/AnnouncementEditor'
import {
  AnnouncementMalformedDraftNotice,
  AnnouncementPendingNotice,
  AnnouncementStatusNotice,
} from '@/components/admin/announcement/AnnouncementNotices'
import {
  AnnouncementStateBadge,
  AnnouncementStateBanner,
} from '@/components/admin/announcement/AnnouncementStateBanner'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { parseExpiryInstant } from '@/lib/announcements/expiry'
import {
  announcementExpirySuggestions,
  matchingExpiryChoice,
} from '@/lib/announcements/expiry-editor'
import {
  announcementPublishOutlook,
  describeAnnouncementPending,
  describeAnnouncementState,
  describePublishObstacle,
} from '@/lib/announcements/lifecycle'
import { resolveAnnouncementLink } from '@/lib/announcements/link'
import { requireStaff } from '@/lib/auth/guards'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readOpeningHours } from '@/lib/content/hours'
import { formatWeekdayName } from '@/lib/hours/format'
import { formatDanishDate } from '@/lib/format/danish'
import { copenhagenWallClock } from '@/lib/time/copenhagen'

import {
  ANNOUNCEMENT_ERROR_FIELD,
  ANNOUNCEMENT_ERROR_MESSAGES,
  ANNOUNCEMENT_FORM,
  announcementErrorField,
  announcementFormValues,
  decodeAnnouncementErrors,
  EXTERNAL_LINK_CHOICE,
  NO_LINK_CHOICE,
  readAnnouncementForm,
  type AnnouncementErrorField,
} from './forms'
import { publishAnnouncement } from './publish-actions'
import { ANNOUNCEMENT_PARAM, EDITOR_ANCHOR } from './routes'
import { saveAnnouncementDraft } from './save-actions'

/**
 * Besked på hjemmesiden — design 1ad; technical plan §15 (phase 7A), §6, §7c.
 *
 * SCOPE. The message, its optional link, its **required future** expiry with 1ad's
 * suggestion chips, the live "sådan ser den ud" panel, the computed state of what the
 * hjemmeside is showing, and Forhåndsvis → Offentliggør through phase 4's machinery.
 *
 * **The immediate path is not here**, and its absence is deliberate rather than an
 * omission. §6's table names four immediate operations; two of them belong to this
 * entity — "Vis besked" off / "Fjern beskeden nu", and replacing an active announcement
 * with its ten-second Fortryd — and both are phase 7B. 1ad draws them, and 1ad also
 * draws the line this phase stops at: *"Skrive eller ændre → tre trin"* on one side,
 * *"Fjerne → ét tryk"* on the other. Everything on this screen is on the first side.
 * Nothing here writes `is_visible`, `previous`, `replaced_at` or `source`, and there is
 * no RPC, no action and no form by which it could.
 *
 * **Opening-hours announcements are not here either.** A message generated from a one-off
 * override, `source='opening_hours'`, and 1ae's conflict sheet are phase 8. `source` is
 * read and displayed by nothing on this screen; it is never written.
 *
 * `requireStaff()` is called here, in the page. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience — this call is the enforcement (§5),
 * and every Server Action this screen posts to calls it again for itself. Both Owner and
 * Staff may manage the announcement (§5's matrix), so `requireStaff` is the whole gate;
 * there is no owner-only branch on this screen.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the announcement row, from `lib/content/announcement-admin.ts` — uncached, through
 *     this person's own JWT, draft merged in, with the published values beside it. Never
 *     the public cached read (§6);
 *   * the published opening hours, from the ordinary cached read, because 1ad's first
 *     suggestion chip is *"Når vi lukker …"* and that instant comes from the same
 *     published schedule the public site uses. Using the same source is what stops the
 *     chip and the hjemmeside from disagreeing about when the doors shut.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in the
 * browser to keep in step with the server, and **no client component at all**. Everything
 * that decides anything — the computed state, the chips, whether Offentliggør is
 * available — is decided on the server.
 */

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** The route's own search parameters, so a refused save can be read back by its parser. */
function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

/**
 * "søndag 14.09.2026 kl. 20:00" — an expiry, in Danish.
 *
 * Composed here from the two formatters that already exist rather than added to either:
 * `formatWeekdayName` and `formatDanishDate` are the site's own words for a weekday and a
 * date, and the clock is the Copenhagen wall reading of the stored instant. The banner
 * receives the finished string, so `lib/announcements/lifecycle.ts` states rules and this
 * page states wording — which is the split every other screen here uses.
 */
function formatExpiryMoment(expiresAt: string | null): string | null {
  const instant = parseExpiryInstant(expiresAt)
  if (instant === null) return null

  const wallClock = copenhagenWallClock(instant)

  return `${formatWeekdayName(wallClock.weekday, 'long')} ${formatDanishDate(
    wallClock.date,
  )} kl. ${wallClock.time}`
}

/**
 * A key that changes when the **server's** values for the card change.
 *
 * Every field on this screen is an uncontrolled `<input defaultValue>`, which is what
 * keeps the whole editor a Server Component with nothing in the browser to keep in step.
 * After a client-side navigation React reuses the existing DOM nodes and updates their
 * `defaultValue` without touching a value a person has typed — usually the kind thing to
 * do, and wrong after a save, when the server's answer is the one that should be on
 * screen. Keying the card on the values it was rendered from remounts it exactly when the
 * server's answer moved; the same mechanism the weekly and monthly editors use.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function AnnouncementAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, announcement, hours] = await Promise.all([
    searchParams,
    readAdminAnnouncement(),
    readOpeningHours(),
  ])

  // The singleton is created by the initial migration and has no DELETE privilege, so
  // this is unreachable in a healthy database — and a screen that rendered empty forms
  // against no row would offer saves that could only fail.
  if (announcement === null) notFound()

  // One clock for the whole render, so the chips, the state banner and the publish
  // outlook cannot resolve the same question against three different instants.
  const now = new Date()

  const suggestions = announcementExpirySuggestions(now, hours.schedule, hours.overrides)

  // Errors and the values that produced them come back from a refused save in the query
  // string. Only codes this application defined survive `decodeAnnouncementErrors`, and
  // the values are re-read with the same parser the form is submitted through.
  const errors = decodeAnnouncementErrors(many(params[ANNOUNCEMENT_ERROR_FIELD]))
  const echoed = errors.length > 0 ? searchParamsOf(params) : null

  const errorFor = (field: AnnouncementErrorField): string | undefined => {
    const code = errors.find((candidate) => announcementErrorField(candidate) === field)
    return code === undefined ? undefined : ANNOUNCEMENT_ERROR_MESSAGES[code]
  }

  const values =
    echoed === null
      ? announcementFormValues(
          announcement.current,
          matchingExpiryChoice(announcement.current.expires_at, suggestions),
        )
      : readAnnouncementForm(echoed)

  /*
   * The computed state is read off the **published** values, never off `current`. It is a
   * statement about what a guest can see right now, and a draft is by definition
   * something no guest has seen.
   */
  const state = describeAnnouncementState(
    { ...announcement.live, is_visible: announcement.isVisible },
    now,
    formatExpiryMoment(announcement.live.expires_at),
  )

  const pending = describeAnnouncementPending(announcement.draftFields)

  // What publishing *would* produce — the live row with the draft over it, which is
  // exactly what `publish_announcement()` merges, and exactly what the action re-checks.
  const outlook = announcementPublishOutlook(announcement.current, now)
  const obstacle = describePublishObstacle(outlook)

  // 1ad's "SÅDAN SER DEN UD" panel shows the *draft* — the point of the panel is to see
  // what has not been published yet. A card with no message has no bar to draw, which is
  // itself the honest preview of an empty announcement (1ac's "ingen bjælke").
  const previewMessage = announcement.current.message?.trim() ?? ''
  const preview =
    previewMessage.length === 0
      ? null
      : { message: previewMessage, link: resolveAnnouncementLink(announcement.current) }

  const publishObstacleId = 'offentliggoer-hvorfor-ikke'

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Besked på hjemmesiden">
        <AnnouncementStateBadge label={state.badge} pending={pending !== null} />
        {/*
          One preview link, unlike the Månedens burger screen's two: the bar is in the
          shared layout, so it is on every public page under one rule, and the Forside is
          where a person looks first (`previewTargetForEntity`). Forhåndsvis opens the
          real site in Draft Mode — the bar renders in its real position above the
          navigation, not as a card pretending to be one.
        */}
        <BarLink href="/api/preview/start?maal=forside">Forhåndsvis</BarLink>
        <form action={publishAnnouncement}>
          <BarSubmit
            describedBy={obstacle === null ? undefined : publishObstacleId}
            disabled={obstacle !== null}
          >
            Offentliggør
          </BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        <AnnouncementStatusNotice status={one(params[ANNOUNCEMENT_PARAM.status])} />
        <AnnouncementMalformedDraftNotice malformed={announcement.draftMalformed} />

        {/*
          1ad: "Offentliggør er nedtonet, indtil feltet er gyldigt." A greyed-out control
          with no reason beside it is a dead end, so the reason is a real element the
          button points at with `aria-describedby` — which is also how a screen reader
          gets it. It is not a `role="status"`: it is a standing explanation, not
          something that just happened.
        */}
        {obstacle === null ? null : (
          <p
            className="rounded-field border-border bg-surface text-ink-2 border px-3 py-2 text-meta"
            id={publishObstacleId}
          >
            <span aria-hidden="true" className="bg-ink-3 mr-2 inline-block size-2 rotate-45" />
            Offentliggør er slået fra: {obstacle}
          </p>
        )}

        <AnnouncementPendingNotice
          action={publishAnnouncement}
          obstacle={obstacle}
          sentence={pending}
        />

        <AnnouncementStateBanner state={state} />

        <AnnouncementEditor
          action={saveAnnouncementDraft}
          anchorId={EDITOR_ANCHOR}
          errorFor={errorFor}
          externalLinkValue={EXTERNAL_LINK_CHOICE}
          fieldNames={ANNOUNCEMENT_FORM}
          key={cardKey(values)}
          noLinkValue={NO_LINK_CHOICE}
          pending={pending}
          preview={preview}
          suggestions={suggestions}
          values={values}
          version={announcement.updatedAt}
        />
      </main>
    </>
  )
}
