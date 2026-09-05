import { AnnouncementCard } from '@/components/admin/dashboard/AnnouncementCard'
import { DashboardBar } from '@/components/admin/dashboard/DashboardBar'
import { DashboardTiles } from '@/components/admin/dashboard/DashboardTiles'
import { RightNow } from '@/components/admin/dashboard/RightNow'
import { PendingChanges } from '@/components/admin/PendingChanges'
import { PublishSummary } from '@/components/admin/PublishSummary'
import { countMenu, describeToday, summariseNews } from '@/lib/admin/dashboard'
import { formatExpiryWeekdayStamp } from '@/lib/announcements/expiry-editor'
import { describeAnnouncementState } from '@/lib/announcements/lifecycle'
import { requireStaff } from '@/lib/auth/guards'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readOpeningHours } from '@/lib/content/hours'
import { readMenuContent } from '@/lib/content/menu'
import { readAdminNewsList } from '@/lib/content/news-admin'
import { readPendingChanges } from '@/lib/publishing/pending'

import { openingHoursHref } from './aabningstider/routes'
import { signOut } from './actions'
import { ANNOUNCEMENT_PATH } from './besked/routes'
import { dashboardTilesFor } from './dashboard-tiles'
import { newsHref } from './nyheder/routes'
import { publishSelectedChanges } from './publish-actions'
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { Notice } from './ui'

/**
 * Oversigt — design 1x (phone) and 1q (desktop); technical plan §5, §6, §15 (phase 12C).
 *
 * The administration's landing screen, built to the two approved frames: the burgundy
 * bar, the amber band when something is waiting, "Hej — hvad vil du lave?" over today's
 * hours, the announcement card, the tiles — a list of rows on the phone, a grid from
 * `md` — and LIGE NU. One markup at every width.
 *
 * A READ MODEL, NOT A SYSTEM
 *
 * The dashboard owns no state and defines no rule. Everything it says is read from the
 * locked systems through the reads they already expose, and worded by the functions
 * those systems already use:
 *
 *   * the band and its list — `pending_changes`, the view that *is* the definition of
 *     pending (§4), through `readPendingChanges()`;
 *   * the announcement card — the published row through `readAdminAnnouncement()`, its
 *     state by `describeAnnouncementState()` (phase 7's own four badges), its expiry by
 *     the formatter 1t's helper already uses;
 *   * today's hours and the sold-out count — the published schedule and overrides
 *     through the ordinary cached read, decided by the phase-2 engine and §7b's
 *     `resolveSoldOut()`, exactly as the public menu and the section screens decide them;
 *   * "Retter på hjemmesiden" — the published menu as a guest reads it, the same cached
 *     read the menu page renders from, expired by the same publishes;
 *   * the news count and "SENESTE NYHED" — the administration's list, through the
 *     phase-9 status model.
 *
 * No table, no cache of its own, no second copy of anything. Nothing here invents a
 * metric the frames did not draw.
 *
 * `requireStaff()` is called here, in the page itself. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience: this call is the enforcement (§5).
 * Which tiles are drawn is decided from the §5 matrix as data (`./dashboard-tiles.ts`)
 * — a courtesy, never a permission: every screen and action guards itself, and RLS
 * decides again in the database.
 */
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireStaff()
  const [params, pending, announcement, hours, menu, news] = await Promise.all([
    searchParams,
    readPendingChanges(),
    readAdminAnnouncement(),
    readOpeningHours(),
    readMenuContent(),
    readAdminNewsList(),
  ])

  // A repeated parameter is a malformed request, not two answers: take the first.
  const query = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  )

  // One clock for the whole render, so the line under the heading, the sold-out count
  // and the announcement's state cannot answer against three different instants.
  const now = new Date()
  const today = describeToday(now, hours.schedule, hours.overrides)
  const menuCounts = countMenu(menu.categories, hours.schedule, hours.overrides, now)
  const newsSummary = summariseNews(news)

  const announcementState =
    announcement === null
      ? null
      : describeAnnouncementState(
          { ...announcement.live, is_visible: announcement.isVisible },
          now,
          formatExpiryWeekdayStamp(announcement.live.expires_at),
        )

  return (
    <>
      <DashboardBar name={profile.name} role={profile.role} signOut={signOut} />

      <PendingChanges changes={pending} profile={profile} action={publishSelectedChanges} />

      <main className="mx-auto flex max-w-content flex-col gap-3 px-gutter py-[1.125rem] md:gap-5 md:px-8 md:py-[1.875rem]">
        {query.besked === 'adgangskode-skiftet' ? (
          <Notice tone="success">Din adgangskode er skiftet.</Notice>
        ) : null}

        {query.besked === 'rolle-skiftet' ? (
          <Notice tone="warning">
            Din rolle er nu medarbejder. Ejer-områderne — åbningstider, kontaktoplysninger,
            forsiden og brugere — er ikke længere tilgængelige for dig.
          </Notice>
        ) : null}

        {query.intet_valgt === '1' ? (
          <Notice tone="warning">Du valgte ingen ændringer, så intet blev offentliggjort.</Notice>
        ) : null}

        {query[RATE_LIMIT_STATUS] === '1' ? <Notice tone="error">{RATE_LIMIT_MESSAGE}</Notice> : null}

        {query.fejl === 'ukendt-forhaandsvisning' ? (
          <Notice tone="error">Den forhåndsvisning findes ikke.</Notice>
        ) : null}

        <PublishSummary query={query} />

        <div>
          <h1 className="font-display text-[1.5rem] leading-tight font-bold tracking-[-0.02em] md:text-title-sm">
            Hej — hvad vil du lave?
          </h1>
          <p className="text-ink-2 mt-0.5 text-nav font-normal md:mt-1 md:text-body">{today.sentence}</p>
        </div>

        {announcementState === null || announcement === null ? null : (
          <AnnouncementCard
            expiresAtLabel={formatExpiryWeekdayStamp(announcement.live.expires_at)}
            href={ANNOUNCEMENT_PATH}
            message={
              announcement.live.message !== null && announcement.live.message.trim().length > 0
                ? announcement.live.message
                : null
            }
            state={announcementState}
          />
        )}

        <DashboardTiles tiles={dashboardTilesFor(profile)} />

        <RightNow
          hoursHref={openingHoursHref({ overrideFocus: true })}
          menu={menuCounts}
          news={newsSummary}
          newsHref={(articleId) => newsHref({ article: articleId })}
          today={today}
        />
      </main>
    </>
  )
}
