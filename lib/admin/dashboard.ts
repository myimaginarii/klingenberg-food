import type { AdminNewsListItem } from '@/lib/content/news-admin'
import type { MenuCategory } from '@/lib/content/types'
import { getOpenState } from '@/lib/hours/engine'
import { formatTimeRange, formatWeekdayName } from '@/lib/hours/format'
import type { OpeningHoursOverride, WeeklySchedule } from '@/lib/hours/types'
import { resolveSoldOut } from '@/lib/menu/availability'
import { isArticlePublic } from '@/lib/news/lifecycle'

/**
 * What the dashboard says about *right now* — design 1x / 1q ("LIGE NU", "DAGENS
 * ÅBNINGSTID", "SENESTE NYHED"); technical plan §15 (phase 12C).
 *
 * The dashboard is a **read model over the locked systems** and holds no state of its
 * own: every number and every sentence here is computed from the same published values
 * and the same rules the public site and the section screens already use — the phase-2
 * hours engine, §7b's sold-out resolution, the news status model. Nothing is stored, so
 * nothing can fall out of step; change the opening hours and the line under the heading
 * changes with them on the next request.
 *
 * Pure, and it takes its `now` as an argument, so the unit suite can hold the clock
 * still. It knows nothing about the database and nothing about React.
 */

/** "Fredag · åbent 15:00–20:00" — the line under the heading, and the "I dag" row. */
export type TodayOpening = {
  /** "Fredag". */
  readonly weekday: string
  /** "15:00–20:00", or "Lukket". */
  readonly hours: string
  readonly isOpen: boolean
  /** "Fredag · åbent 15:00–20:00", or "Fredag · lukket i dag". */
  readonly sentence: string
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Today's effective hours, overrides applied — the same answer the badge on the Forside
 * gives, from the same engine. "Åbent" here is *the day has hours*, which is what 1x and
 * 1q print ("Onsdag · åbent 15:00–20:00" at any time of that day), not "the doors are open
 * this minute" — that is the Forside's badge, and it is not repeated on the dashboard.
 */
export function describeToday(
  now: Date,
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
): TodayOpening {
  const { today } = getOpenState(now, schedule, overrides)
  const weekday = capitalise(formatWeekdayName(today.weekday, 'long'))

  if (!today.isOpen) {
    return { weekday, hours: 'Lukket', isOpen: false, sentence: `${weekday} · lukket i dag` }
  }

  const hours = formatTimeRange(today.from, today.to)

  return { weekday, hours, isOpen: true, sentence: `${weekday} · åbent ${hours}` }
}

/** "Retter på hjemmesiden" and "Markeret udsolgt" — 1x / 1q's two menu rows. */
export type MenuCounts = {
  readonly dishes: number
  readonly soldOut: number
}

/**
 * Counted over the **published** menu as a guest reads it — the sections and dishes the
 * public read returns, which already excludes hidden sections, deleted dishes and rows
 * that have never been published — and "sold out" decided by §7b's one function, so a
 * dish marked yesterday that has since reset is not counted twice over.
 */
export function countMenu(
  categories: readonly MenuCategory[],
  schedule: WeeklySchedule,
  overrides: readonly OpeningHoursOverride[],
  now: Date,
): MenuCounts {
  let dishes = 0
  let soldOut = 0

  for (const category of categories) {
    for (const dish of category.dishes) {
      dishes += 1
      if (resolveSoldOut(dish.soldOutOn, schedule, overrides, now).soldOut) soldOut += 1
    }
  }

  return { dishes, soldOut }
}

/** "Offentliggjorte nyheder" and 1q's "SENESTE NYHED". */
export type NewsSummary = {
  readonly published: number
  /** The article published most recently, or `null` when nothing is on the hjemmeside. */
  readonly latest: Pick<AdminNewsListItem, 'id' | 'title' | 'publishedAt'> | null
}

/**
 * From the administration's own list: the articles whose status makes them public, and
 * among them the one published last. "Latest" is by `published_at` — when it went on
 * the hjemmeside — which is the fact the card states ("Udgivet DD.MM.ÅÅÅÅ"); the public
 * list's reading order (`display_date`) is a different question and is not restated here.
 */
export function summariseNews(items: readonly AdminNewsListItem[]): NewsSummary {
  const published = items.filter(
    (item) => isArticlePublic(item.status) && item.publishedAt !== null,
  )

  const latest = published.reduce<AdminNewsListItem | null>((best, item) => {
    if (best === null) return item
    return (item.publishedAt ?? '') > (best.publishedAt ?? '') ? item : best
  }, null)

  return {
    published: published.length,
    latest:
      latest === null
        ? null
        : { id: latest.id, title: latest.title, publishedAt: latest.publishedAt },
  }
}

/**
 * "2 ændringer er ikke offentliggjort" — 1x / 1q's band sentence, from the pending
 * registry's count and nothing else.
 */
export function describePendingCount(count: number): string {
  return count === 1
    ? 'Én ændring er ikke offentliggjort'
    : `${String(count)} ændringer er ikke offentliggjort`
}
