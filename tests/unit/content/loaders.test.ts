import { describe, expect, it } from 'vitest'

import { announcementFrom } from '@/lib/content/load/announcement'
import { openingHoursFrom } from '@/lib/content/load/hours'
import { menuCategoriesFrom } from '@/lib/content/load/menu'
import { loadNews, newsArticleFrom, type NewsFile } from '@/lib/content/load/news'
import { oreFromKroner } from '@/lib/content/load/price'
import { keepPriceTogether, prose } from '@/lib/content/load/text'

/**
 * The loader boundary — `lib/content/load/`: what a stored value *means*.
 *
 * Each conversion is a pure function of a file's contents, tested here as one, so the
 * rules an editor relies on are pinned without a fixture tree: a price is a kroner
 * string and never a float, a price stays on one line, a day is closed or open, an
 * inactive announcement is no announcement, and a draft article does not exist.
 */

const NO_BREAK_SPACE = String.fromCharCode(0xa0)

describe('oreFromKroner', () => {
  it('turns a kroner string into whole øre', () => {
    expect(oreFromKroner('89', 'test')).toBe(8900)
    expect(oreFromKroner('295', 'test')).toBe(29500)
    expect(oreFromKroner('5', 'test')).toBe(500)
    expect(oreFromKroner('0', 'test')).toBe(0)
  })

  it('accepts a comma or a point and one or two decimals, without floating-point arithmetic', () => {
    expect(oreFromKroner('12,50', 'test')).toBe(1250)
    expect(oreFromKroner('12.5', 'test')).toBe(1250)
    expect(oreFromKroner('0,1', 'test')).toBe(10)
    expect(oreFromKroner('19,99', 'test')).toBe(1999)
    expect(oreFromKroner(' 24 ', 'test')).toBe(2400)
  })

  it('answers null for a priceless entry', () => {
    expect(oreFromKroner(null, 'test')).toBeNull()
    expect(oreFromKroner(undefined, 'test')).toBeNull()
  })

  it.each(['', '89 kr.', '12,345', '-5', '1.2.3', 'gratis'])('refuses %j, naming the entry', (value) => {
    expect(() => oreFromKroner(value, 'content/site/menu.json: dish "odin"')).toThrow(
      /content\/site\/menu\.json: dish "odin": a price is written in kroner/,
    )
  })

  it('refuses a number: a price is a string an editor wrote, never a float', () => {
    expect(() => oreFromKroner(89 as unknown as string, 'test')).toThrow(/written in kroner/)
  })
})

describe('keepPriceTogether', () => {
  it('joins a number to "kr." with a non-breaking space, every time it occurs', () => {
    expect(keepPriceTogether('Som menu: 124 kr., Ragnar 132 kr.')).toBe(
      `Som menu: 124${NO_BREAK_SPACE}kr., Ragnar 132${NO_BREAK_SPACE}kr.`,
    )
  })

  it('is applied to the Burgere intro alone: every other section intro is the text as written', () => {
    const categories = menuCategoriesFrom(
      {
        categories: [
          { id: 'burgere', name: 'Burgere', intro: 'Som menu: 124 kr., Ragnar 132 kr.', dishes: [] },
          {
            id: 'tapas',
            name: 'Tapas',
            intro: 'Til to personer 295 kr. · hver ekstra person 148 kr.',
            note: '+148 kr. pr. ekstra person',
            dishes: [],
          },
        ],
      },
      'test',
    )
    const [burgers, tapas] = categories
    expect(burgers?.intro).toBe(`Som menu: 124${NO_BREAK_SPACE}kr., Ragnar 132${NO_BREAK_SPACE}kr.`)
    expect(tapas?.intro).toBe('Til to personer 295 kr. · hver ekstra person 148 kr.')
    expect(tapas?.note).toBe('+148 kr. pr. ekstra person')
  })

  it('rewrites nothing else', () => {
    expect(keepPriceTogether('Til to personer')).toBe('Til to personer')
    expect(keepPriceTogether('ca. 100 kroner')).toBe('ca. 100 kroner')
    expect(keepPriceTogether('100 kr uden punktum')).toBe('100 kr uden punktum')
    expect(keepPriceTogether('kr. 100')).toBe('kr. 100')
    expect(keepPriceTogether('1.500 g · frost')).toBe('1.500 g · frost')
  })

  it('leaves a price that is already joined alone', () => {
    const joined = `295${NO_BREAK_SPACE}kr.`
    expect(keepPriceTogether(joined)).toBe(joined)
  })

  it('reads an absent prose field as null and a present one exactly as written', () => {
    expect(prose(null)).toBeNull()
    expect(prose(undefined)).toBeNull()
    expect(prose('+148 kr. pr. ekstra person')).toBe('+148 kr. pr. ekstra person')
  })
})

describe('openingHoursFrom', () => {
  const closed = { closed: true, from: null, to: null }
  const open = { closed: false, from: '15:00', to: '20:00' }
  const week = { mon: closed, tue: closed, wed: open, thu: open, fri: open, sat: open, sun: open }

  it('turns the uniform per-day entries into the engine\'s closed-or-open days', () => {
    const hours = openingHoursFrom({ schedule: week, overrides: [] }, 'hours.json')
    expect(hours.schedule.mon).toEqual({ closed: true })
    expect(hours.schedule.wed).toEqual({ from: '15:00', to: '20:00' })
    expect(Object.keys(hours.schedule)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    expect(hours.overrides).toEqual([])
  })

  it('accepts a closed day written with only its flag', () => {
    const hours = openingHoursFrom({ schedule: { ...week, mon: { closed: true } } }, 'hours.json')
    expect(hours.schedule.mon).toEqual({ closed: true })
  })

  it('fills in the null halves of an override', () => {
    const hours = openingHoursFrom(
      {
        schedule: week,
        overrides: [{ date: '2026-12-24', kind: 'closed', status: 'published' }],
      },
      'hours.json',
    )
    expect(hours.overrides).toEqual([
      { date: '2026-12-24', kind: 'closed', opensAt: null, closesAt: null, status: 'published' },
    ])
  })

  it('refuses a missing weekday and an open day without both times, naming the day', () => {
    const sixDays = { mon: closed, tue: closed, wed: open, thu: open, fri: open, sat: open }
    expect(() => openingHoursFrom({ schedule: sixDays }, 'content/site/hours.json')).toThrow(
      /content\/site\/hours\.json: schedule\.sun is missing/,
    )
    expect(() =>
      openingHoursFrom({ schedule: { ...week, fri: { closed: false, from: '15:00' } } }, 'hours.json'),
    ).toThrow(/schedule\.fri: an open day needs both "from" and "to"/)
  })
})

describe('announcementFrom', () => {
  const where = 'content/site/announcement.json'

  it('reads an inactive document as no announcement at all, whatever else it says', () => {
    expect(announcementFrom({ active: false }, where)).toBeNull()
    expect(
      announcementFrom(
        { active: false, message: 'Lukket juleaften', expiresAt: '2026-12-25T00:00:00+01:00' },
        where,
      ),
    ).toBeNull()
  })

  it('refuses an active document without a message or an expiry, by name', () => {
    expect(() => announcementFrom({ active: true, message: 'Hej' }, where)).toThrow(
      /content\/site\/announcement\.json is active but has no message or no expiresAt/,
    )
  })

  it('hands the link to the existing resolver, so a page link keeps the site\'s own rules', () => {
    const announcement = announcementFrom(
      {
        active: true,
        message: 'Nye åbningstider fra 1. oktober',
        expiresAt: '2026-10-01T00:00:00+02:00',
        link: { type: 'page', page: '/find-os' },
      },
      where,
    )
    expect(announcement).toEqual({
      message: 'Nye åbningstider fra 1. oktober',
      expiresAt: '2026-10-01T00:00:00+02:00',
      link: { href: '/find-os', label: 'Find os', external: false },
    })
  })

  it('drops a link the resolver refuses, and renders the message alone', () => {
    const announcement = announcementFrom(
      {
        active: true,
        message: 'Menu til 89 kr. i dag',
        expiresAt: '2026-10-01T00:00:00+02:00',
        link: { type: 'url', url: 'http://example.test/', label: 'Læs mere' },
      },
      where,
    )
    expect(announcement?.link).toBeNull()
    expect(announcement?.message).toBe('Menu til 89 kr. i dag')
  })
})

describe('newsArticleFrom', () => {
  const file: NewsFile = {
    title: 'Ny burger i oktober',
    published: true,
    publishedAt: '2026-10-01',
    body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Menu til 124 kr.' }] }] },
  }

  it('reads a published file as the article at the address its file name gives', () => {
    const article = newsArticleFrom('ny-burger-i-oktober', file)
    expect(article).toMatchObject({
      id: 'ny-burger-i-oktober',
      slug: 'ny-burger-i-oktober',
      title: 'Ny burger i oktober',
      category: null,
      displayDate: '2026-10-01',
      updatedAt: '2026-10-01',
      image: null,
    })
    expect(article?.body.blocks[0]?.spans[0]?.text).toBe('Menu til 124 kr.')
  })

  it('keeps a stated updatedAt', () => {
    expect(newsArticleFrom('a', { ...file, updatedAt: '2026-10-03T08:00:00.000Z' })?.updatedAt).toBe(
      '2026-10-03T08:00:00.000Z',
    )
  })

  it('reads anything but "published": true as a draft that does not exist', () => {
    expect(newsArticleFrom('kladde', { ...file, published: false })).toBeNull()
    const unstated: NewsFile = { title: file.title, publishedAt: file.publishedAt, body: file.body }
    expect(newsArticleFrom('kladde', unstated)).toBeNull()
  })

  it('refuses a file name that is not a slug, and a published article without a title', () => {
    expect(() => newsArticleFrom('Ny Burger', file)).toThrow(/content\/site\/news\/Ny Burger\.json/)
    expect(() => newsArticleFrom('uden-titel', { ...file, title: '' })).toThrow(/has no title/)
  })

  it('finds no article in the tree: nothing has been written, and nothing is invented', () => {
    expect(loadNews()).toEqual([])
  })
})
