import { describe, expect, it } from 'vitest'

import {
  countMenu,
  describePendingCount,
  describeToday,
  summariseNews,
} from '@/lib/admin/dashboard'
import type { AdminNewsListItem } from '@/lib/content/news-admin'
import type { MenuCategory } from '@/lib/content/types'

import { CONFIRMED_SCHEDULE, closedOverride, customOverride } from '../fixtures/hours'

/**
 * The dashboard's read model — phase 12C, design 1x / 1q ("LIGE NU").
 *
 * Pure functions over published values and the locked rules: today's line from the
 * phase-2 engine with overrides honoured, the counts from the public menu shape with
 * §7b deciding "sold out", the news summary from the phase-9 status model, and the
 * band's count sentence. The clock is held still in every case.
 */

// A Friday (2026-09-04) at 10:00 Copenhagen — before the doors open, on an open day.
const FRIDAY_MORNING = new Date('2026-09-04T08:00:00Z')
// A Monday, which the confirmed week closes.
const MONDAY_NOON = new Date('2026-09-07T10:00:00Z')

function category(dishes: readonly { soldOutOn: string | null }[]): MenuCategory {
  return {
    id: 'c',
    slug: 'burgere',
    name: 'Burgere',
    intro: null,
    note: null,
    kind: 'dishes',
    dishes: dishes.map((dish, index) => ({
      id: `d${String(index)}`,
      name: `Ret ${String(index)}`,
      description: null,
      secondaryNote: null,
      priceOre: 8900,
      labels: [],
      tapas: null,
      soldOutOn: dish.soldOutOn,
      image: null,
    })),
  }
}

describe('describeToday — 1x / 1q\'s "Onsdag · åbent 15:00–20:00"', () => {
  it('names the day and its hours on an open day, whatever the time of day', () => {
    expect(describeToday(FRIDAY_MORNING, CONFIRMED_SCHEDULE, [])).toEqual({
      weekday: 'Fredag',
      hours: '15:00–20:00',
      isOpen: true,
      sentence: 'Fredag · åbent 15:00–20:00',
    })
  })

  it('says "lukket i dag" on a closed day, with "Lukket" as the row value', () => {
    expect(describeToday(MONDAY_NOON, CONFIRMED_SCHEDULE, [])).toEqual({
      weekday: 'Mandag',
      hours: 'Lukket',
      isOpen: false,
      sentence: 'Mandag · lukket i dag',
    })
  })

  it('honours a published one-off change in both directions', () => {
    expect(
      describeToday(MONDAY_NOON, CONFIRMED_SCHEDULE, [customOverride('2026-09-07', '12:00', '14:00')]).sentence,
    ).toBe('Mandag · åbent 12:00–14:00')
    expect(
      describeToday(FRIDAY_MORNING, CONFIRMED_SCHEDULE, [closedOverride('2026-09-04')]).sentence,
    ).toBe('Fredag · lukket i dag')
  })
})

describe('countMenu — "Retter på hjemmesiden" and "Markeret udsolgt"', () => {
  it('counts every dish the public read returned, across sections', () => {
    const counts = countMenu(
      [category([{ soldOutOn: null }, { soldOutOn: null }]), category([{ soldOutOn: null }])],
      CONFIRMED_SCHEDULE,
      [],
      FRIDAY_MORNING,
    )

    expect(counts).toEqual({ dishes: 3, soldOut: 0 })
  })

  it('counts a dish marked today as sold out, and one marked before the last opening as available again', () => {
    const counts = countMenu(
      [category([{ soldOutOn: '2026-09-04' }, { soldOutOn: '2026-09-02' }, { soldOutOn: null }])],
      CONFIRMED_SCHEDULE,
      [],
      FRIDAY_MORNING,
    )

    // Marked Wednesday, and Thursday's opening has passed: §7b has reset it.
    expect(counts).toEqual({ dishes: 3, soldOut: 1 })
  })

  it('is empty for an empty menu', () => {
    expect(countMenu([], CONFIRMED_SCHEDULE, [], FRIDAY_MORNING)).toEqual({ dishes: 0, soldOut: 0 })
  })
})

describe('summariseNews — "Offentliggjorte nyheder" and "SENESTE NYHED"', () => {
  const item = (id: string, status: 'draft' | 'published', publishedAt: string | null): AdminNewsListItem => ({
    id,
    title: `Nyhed ${id}`,
    slug: `nyhed-${id}`,
    status,
    publishedAt,
    updatedAt: '2026-09-04T10:00:00Z',
  })

  it('counts only public articles, and picks the one published last', () => {
    const summary = summariseNews([
      item('a', 'published', '2026-08-20T10:00:00Z'),
      item('b', 'draft', null),
      item('c', 'published', '2026-09-01T10:00:00Z'),
    ])

    expect(summary.published).toBe(2)
    expect(summary.latest).toEqual({ id: 'c', title: 'Nyhed c', publishedAt: '2026-09-01T10:00:00Z' })
  })

  it('has no latest article when nothing is public', () => {
    expect(summariseNews([item('b', 'draft', null)])).toEqual({ published: 0, latest: null })
    expect(summariseNews([])).toEqual({ published: 0, latest: null })
  })
})

describe('describePendingCount — the band sentence', () => {
  it('is 1x / 1q\'s sentence, with the project\'s "Én" for one', () => {
    expect(describePendingCount(1)).toBe('Én ændring er ikke offentliggjort')
    expect(describePendingCount(2)).toBe('2 ændringer er ikke offentliggjort')
  })
})
