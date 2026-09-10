import { describe, expect, it } from 'vitest'

import { validateContact } from '@/lib/content/validate/contact'
import { validateHours } from '@/lib/content/validate/hours'
import type { Problem } from '@/lib/content/validate/problems'

/** The two documents every page reads: who to call, and when the doors are open. */

const CONTACT = 'content/site/contact.json'
const HOURS = 'content/site/hours.json'

const messages = (problems: readonly Problem[]) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join('\n')

const contact = (over: Record<string, unknown> = {}) => ({
  venueName: 'Carl Nielsen Hallen',
  addressLine1: 'Lumbyvej 62',
  postalCode: '5792',
  city: 'Nørre Lyndelse',
  primaryPhone: '+45 63 90 83 00',
  secondaryPhone: '+45 51 79 45 66',
  email: 'kontakt@eksempel.test',
  facebookUrl: 'https://www.facebook.com/carlnielsencafeen',
  ...over,
})

describe('the contact facts', () => {
  it('accepts the confirmed set, and a set without the optional fields', () => {
    expect(validateContact(contact(), CONTACT)).toEqual([])
    expect(
      validateContact(contact({ secondaryPhone: null, facebookUrl: null }), CONTACT),
    ).toEqual([])
  })

  it.each(['+45 63 90 83', '63 90 83 00 11', 'ring til os', '004563908300'])(
    'refuses the phone number %j',
    (primaryPhone) => {
      const problems = validateContact(contact({ primaryPhone }), CONTACT)

      expect(problems[0]?.where).toBe('content/site/contact.json → primaryPhone')
      expect(messages(problems)).toMatch(/dansk telefonnummer på otte cifre/)
    },
  )

  it('accepts a Danish number however it is spaced', () => {
    for (const primaryPhone of ['63908300', '63 90 83 00', '+4563908300', '63-90-83-00']) {
      expect(validateContact(contact({ primaryPhone }), CONTACT)).toEqual([])
    }
  })

  it.each(['kontakt', 'kontakt@', 'kontakt@eksempel', 'to adresser@en.test to@to.test'])(
    'refuses the e-mail address %j',
    (email) => {
      const problems = validateContact(contact({ email }), CONTACT)

      expect(problems[0]?.where).toBe('content/site/contact.json → email')
      expect(messages(problems)).toMatch(/navn, et snabel-a og et domæne/)
    },
  )

  it('refuses a number where a written phone number belongs, and an empty e-mail', () => {
    expect(messages(validateContact(contact({ primaryPhone: 12345678 }), CONTACT))).toMatch(
      /primaryPhone: Skal være tekst i anførselstegn/,
    )
    expect(messages(validateContact(contact({ email: '' }), CONTACT))).toMatch(
      /email: Skal udfyldes\./,
    )
  })

  it('refuses a Facebook link that is not on Facebook', () => {
    const problems = validateContact(
      contact({ facebookUrl: 'https://example.test/carlnielsencafeen' }),
      CONTACT,
    )

    expect(problems[0]?.where).toBe('content/site/contact.json → facebookUrl')
    expect(messages(problems)).toMatch(/Skal pege på facebook\.com eller www\.facebook\.com/)
  })

  it('refuses a Facebook link that is not https, through the site’s own external-link rule', () => {
    const problems = validateContact(
      contact({ facebookUrl: 'http://www.facebook.com/carlnielsencafeen' }),
      CONTACT,
    )

    expect(messages(problems)).toMatch(/Skal være en fuld https-adresse/)
  })

  it('refuses a postal code that is not four digits, and an address with a hole in it', () => {
    expect(messages(validateContact(contact({ postalCode: '5792 Årslev' }), CONTACT))).toMatch(
      /fire cifre/,
    )
    expect(messages(validateContact(contact({ addressLine1: '' }), CONTACT))).toMatch(
      /addressLine1: Skal udfyldes\./,
    )
  })
})

const closed = { closed: true, from: null, to: null }
const open = { closed: false, from: '15:00', to: '20:00' }
const week = (over: Record<string, unknown> = {}) => ({
  mon: closed,
  tue: closed,
  wed: open,
  thu: open,
  fri: open,
  sat: open,
  sun: open,
  ...over,
})

describe('the opening hours', () => {
  it('accepts the confirmed week, with and without a list of special days', () => {
    expect(validateHours({ schedule: week(), overrides: [] }, HOURS)).toEqual([])
    expect(validateHours({ schedule: week() }, HOURS)).toEqual([])
  })

  it('accepts a week that changes — nothing here pins today’s hours', () => {
    expect(
      validateHours(
        { schedule: week({ mon: { closed: false, from: '11:30', to: '21:45' }, sun: closed }) },
        HOURS,
      ),
    ).toEqual([])
  })

  it('refuses a missing weekday: a gap is not the same as a closed day', () => {
    const six = Object.fromEntries(Object.entries(week()).filter(([day]) => day !== 'sun'))
    const problems = validateHours({ schedule: six }, HOURS)

    expect(problems[0]?.where).toBe('content/site/hours.json → schedule → sun')
    expect(problems[0]?.message).toMatch(/Ugedagen mangler/)
  })

  /** The clock grammar is `parseIsoTime`'s, covered in `tests/unit/time/calendar.test.ts`. */
  it.each(['25:00', '3pm'])('refuses the clock time %j under the weekday that carries it', (from) => {
    const problems = validateHours({ schedule: week({ wed: { closed: false, from, to: '20:00' } }) }, HOURS)

    expect(problems[0]?.where).toBe('content/site/hours.json → schedule → wed → from')
    expect(problems[0]?.message).toMatch(/klokkeslæt skrevet som "15:00"/)
  })

  it('refuses a day that closes before, or exactly when, it opens', () => {
    for (const [from, to] of [
      ['20:00', '15:00'],
      ['15:00', '15:00'],
    ]) {
      const problems = validateHours(
        { schedule: week({ wed: { closed: false, from, to } }) },
        HOURS,
      )
      expect(messages(problems)).toMatch(/skal ligge senere på dagen/)
    }
  })

  it('refuses a closed day that also carries hours nobody would ever see', () => {
    const problems = validateHours(
      { schedule: week({ mon: { closed: true, from: '15:00', to: '20:00' } }) },
      HOURS,
    )

    expect(messages(problems)).toMatch(/markeret som lukket, men har også åbningstider/)
  })

  it('refuses an override on a date that does not exist in the calendar', () => {
    const problems = validateHours(
      {
        schedule: week(),
        overrides: [{ date: '2026-02-31', kind: 'closed', status: 'published' }],
      },
      HOURS,
    )

    expect(messages(problems)).toMatch(/rigtig dato skrevet som "2026-12-24"/)
  })

  it('refuses two published overrides for one date — the engine indexes one per day', () => {
    const problems = validateHours(
      {
        schedule: week(),
        overrides: [
          { date: '2026-12-24', kind: 'closed', status: 'published' },
          { date: '2026-12-24', kind: 'custom', opensAt: '12:00', closesAt: '16:00', status: 'published' },
        ],
      },
      HOURS,
    )

    expect(messages(problems)).toMatch(/mere end én offentliggjort særlig dag for 2026-12-24/)
  })

  it('accepts two drafts for one date: only a published override reaches the site', () => {
    expect(
      validateHours(
        {
          schedule: week(),
          overrides: [
            { date: '2026-12-24', kind: 'closed', status: 'draft' },
            { date: '2026-12-24', kind: 'closed', status: 'draft' },
          ],
        },
        HOURS,
      ),
    ).toEqual([])
  })

  it('refuses a custom override with only half its hours, and a closed one carrying hours', () => {
    expect(
      messages(
        validateHours(
          {
            schedule: week(),
            overrides: [{ date: '2026-12-24', kind: 'custom', opensAt: '12:00', status: 'published' }],
          },
          HOURS,
        ),
      ),
    ).toMatch(/både "opensAt" og "closesAt"/)

    expect(
      messages(
        validateHours(
          {
            schedule: week(),
            overrides: [
              { date: '2026-12-24', kind: 'closed', opensAt: '12:00', closesAt: '16:00', status: 'published' },
            ],
          },
          HOURS,
        ),
      ),
    ).toMatch(/markeret som lukket, men har også åbningstider/)
  })
})
