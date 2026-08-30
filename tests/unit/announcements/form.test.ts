import { describe, expect, it } from 'vitest'

import { announcementExpirySuggestions } from '@/lib/announcements/expiry-editor'
import {
  announcementErrorField,
  announcementFormValues,
  decodeAnnouncementErrors,
  encodeAnnouncementEcho,
  EXTERNAL_LINK_CHOICE,
  NO_LINK_CHOICE,
  readAnnouncementForm,
  toAnnouncementSubmission,
  type AnnouncementFormValues,
} from '@/app/(admin)/admin/besked/forms'
import { copenhagenInstantOf } from '@/lib/time/copenhagen'

import { CONFIRMED_SCHEDULE } from '../fixtures/hours'

/**
 * What 1ad's card submits, and what the server makes of it.
 *
 * This is the outer edge of the announcement's trust boundary: every value here arrived
 * from a browser, and the assertions are about what is *refused*. Nothing in this suite
 * touches a database, so a refusal it asserts is a refusal that happens before any query
 * is built.
 */

/** Wednesday 2026-09-16, 18:00 Copenhagen: open, closing at 20:00. */
const NOW = copenhagenInstantOf('2026-09-16', '18:00')
const SUGGESTIONS = announcementExpirySuggestions(NOW, CONFIRMED_SCHEDULE, [])

function form(overrides: Partial<AnnouncementFormValues> = {}): AnnouncementFormValues {
  return {
    message: 'Ændrede åbningstider søndag · 17:00–19:00',
    linkChoice: NO_LINK_CHOICE,
    linkUrl: '',
    linkLabel: '',
    expiryChoice: 'custom',
    expiryDate: '2026-09-20',
    expiryTime: '20:00',
    ...overrides,
  }
}

function errorsFor(overrides: Partial<AnnouncementFormValues>): string[] {
  const result = toAnnouncementSubmission(form(overrides), SUGGESTIONS, NOW)
  return result.ok ? [] : [...result.errors]
}

describe('reading the form', () => {
  it('reads every field the card submits', () => {
    const data = new URLSearchParams({
      besked: 'Hej',
      link: '/find-os',
      adresse: 'https://example.test',
      linktekst: 'Se tider',
      udloeb: 'closing',
      udloeb_dato: '2026-09-20',
      udloeb_tid: '20:00',
    })

    expect(readAnnouncementForm(data)).toEqual({
      message: 'Hej',
      linkChoice: '/find-os',
      linkUrl: 'https://example.test',
      linkLabel: 'Se tider',
      expiryChoice: 'closing',
      expiryDate: '2026-09-20',
      expiryTime: '20:00',
    })
  })

  it('treats an absent or unrecognised chip as "the fields as typed"', () => {
    // The only reading that cannot silently substitute a value nobody chose.
    expect(readAnnouncementForm(new URLSearchParams()).expiryChoice).toBe('custom')
    expect(
      readAnnouncementForm(new URLSearchParams({ udloeb: 'lukketid' })).expiryChoice,
    ).toBe('custom')
  })

  it('treats an absent link choice as no link', () => {
    expect(readAnnouncementForm(new URLSearchParams()).linkChoice).toBe(NO_LINK_CHOICE)
  })
})

describe('the message', () => {
  it('is trimmed', () => {
    const result = toAnnouncementSubmission(form({ message: '  Hej  ' }), SUGGESTIONS, NOW)

    expect(result.ok && result.values.message).toBe('Hej')
  })

  it.each(['', '   ', '\n\t'])('is refused when blank (%j)', (message) => {
    expect(errorsFor({ message })).toContain('besked:tom')
  })

  it('accepts exactly 90 characters', () => {
    expect(errorsFor({ message: 'x'.repeat(90) })).toEqual([])
  })

  it('refuses 91 characters rather than truncating', () => {
    const result = toAnnouncementSubmission(
      form({ message: 'x'.repeat(91) }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok).toBe(false)
    expect(result.ok || result.errors).toContain('besked:for_lang')
  })

  it('reports every problem at once rather than the first', () => {
    const errors = errorsFor({ message: '', expiryDate: '', expiryTime: '' })

    expect(errors).toContain('besked:tom')
    expect(errors).toContain('udloeb:mangler')
  })
})

describe('the link', () => {
  it('produces no link at all when "Intet link" is chosen', () => {
    const result = toAnnouncementSubmission(form(), SUGGESTIONS, NOW)

    expect(result.ok && result.values).toMatchObject({
      link_type: 'none',
      link_page: null,
      link_url: null,
      link_label: null,
    })
  })

  it('drops a label that was left behind when the link was removed', () => {
    const result = toAnnouncementSubmission(
      form({ linkChoice: NO_LINK_CHOICE, linkLabel: 'Se tider' }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values.link_label).toBeNull()
  })

  it.each(['/', '/menu', '/mad-ud-af-huset', '/om-os', '/nyheder', '/find-os'])(
    'accepts the approved internal route %s',
    (route) => {
      const result = toAnnouncementSubmission(
        form({ linkChoice: route, linkLabel: 'Se mere' }),
        SUGGESTIONS,
        NOW,
      )

      expect(result.ok && result.values).toMatchObject({
        link_type: 'page',
        link_page: route,
        link_url: null,
        link_label: 'Se mere',
      })
    },
  )

  it('accepts an internal route with no label, leaving the fallback to the renderer', () => {
    const result = toAnnouncementSubmission(
      form({ linkChoice: '/find-os' }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values.link_label).toBeNull()
  })

  it.each([
    '/admin',
    '/admin/besked',
    '/tilbud',
    '/menu?x=1',
    '/menu#burgere',
    '/menu/../admin',
    '//evil.test',
    'https://evil.test',
    'menu',
  ])('refuses the unapproved internal route %s', (route) => {
    expect(errorsFor({ linkChoice: route, linkLabel: 'X' })).toContain('link:ukendt')
  })

  it('accepts an https address with a label', () => {
    const result = toAnnouncementSubmission(
      form({
        linkChoice: EXTERNAL_LINK_CHOICE,
        linkUrl: 'https://example.test/arrangement',
        linkLabel: 'Læs mere',
      }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values).toMatchObject({
      link_type: 'url',
      link_page: null,
      link_url: 'https://example.test/arrangement',
      link_label: 'Læs mere',
    })
  })

  it.each([
    ['http', 'http://example.test/side'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['a protocol-relative address', '//example.test/side'],
    ['a malformed address', 'https://'],
    ['nonsense', 'ikke en adresse'],
  ])('refuses %s as an external address', (_name, url) => {
    expect(
      errorsFor({ linkChoice: EXTERNAL_LINK_CHOICE, linkUrl: url, linkLabel: 'X' }),
    ).toContain('adresse:ugyldig')
  })

  it('refuses an external link with no address', () => {
    expect(
      errorsFor({ linkChoice: EXTERNAL_LINK_CHOICE, linkUrl: '  ', linkLabel: 'X' }),
    ).toContain('adresse:mangler')
  })

  it('refuses an external link with no label, because it has no name of its own', () => {
    expect(
      errorsFor({
        linkChoice: EXTERNAL_LINK_CHOICE,
        linkUrl: 'https://example.test',
        linkLabel: '',
      }),
    ).toContain('linktekst:mangler')
  })

  it('refuses a link label longer than the column allows', () => {
    expect(errorsFor({ linkChoice: '/menu', linkLabel: 'x'.repeat(61) })).toContain(
      'linktekst:for_lang',
    )
  })

  it('never lets HTML into a value — it is stored and rendered as text', () => {
    // There is no HTML field anywhere in this form: the message is a string, and React
    // escapes it. This asserts the value survives unchanged rather than being "cleaned",
    // because a sanitizer that can be got wrong is exactly what §8 avoids having.
    const result = toAnnouncementSubmission(
      form({ message: '<script>alert(1)</script>' }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values.message).toBe('<script>alert(1)</script>')
  })
})

describe('the expiry', () => {
  it('accepts a future date and time as the instant they name in Copenhagen', () => {
    const result = toAnnouncementSubmission(
      form({ expiryDate: '2026-09-20', expiryTime: '20:00' }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values.expires_at).toBe('2026-09-20T18:00:00.000Z')
  })

  it.each([
    ['no date', { expiryDate: '' }],
    ['no time', { expiryTime: '' }],
    ['neither', { expiryDate: '', expiryTime: '' }],
  ])('refuses %s', (_name, overrides) => {
    expect(errorsFor(overrides)).toContain('udloeb:mangler')
  })

  it.each([
    ['a date that is not a date', { expiryDate: '20-09-2026' }],
    ['a day that does not exist', { expiryDate: '2026-02-29' }],
    ['a time that is not a time', { expiryTime: '25:00' }],
  ])('refuses %s', (_name, overrides) => {
    expect(errorsFor(overrides)).toContain('udloeb:ugyldig')
  })

  it('refuses an expiry in the past', () => {
    expect(errorsFor({ expiryDate: '2026-09-15', expiryTime: '20:00' })).toContain(
      'udloeb:fortid',
    )
  })

  it('refuses an expiry at exactly now', () => {
    expect(errorsFor({ expiryDate: '2026-09-16', expiryTime: '18:00' })).toContain(
      'udloeb:fortid',
    )
  })

  it('accepts an expiry one minute from now', () => {
    expect(errorsFor({ expiryDate: '2026-09-16', expiryTime: '18:01' })).toEqual([])
  })

  it('resolves a chip to the instant the server computed, ignoring the two fields', () => {
    const result = toAnnouncementSubmission(
      // Deliberately contradictory: the fields say one thing, the chip another.
      form({ expiryChoice: 'closing', expiryDate: '2020-01-01', expiryTime: '00:00' }),
      SUGGESTIONS,
      NOW,
    )

    expect(result.ok && result.values.expires_at).toBe(
      copenhagenInstantOf('2026-09-16', '20:00').toISOString(),
    )
  })

  it('refuses a chip the screen never offered rather than substituting another', () => {
    // `SUGGESTIONS` here holds only "Om en uge": a schedule with nothing open offers no
    // closing chip, so a submission naming one has no value to resolve to.
    const withoutClosing = SUGGESTIONS.filter((suggestion) => suggestion.choice === 'week')

    expect(
      toAnnouncementSubmission(form({ expiryChoice: 'closing' }), withoutClosing, NOW),
    ).toEqual({ ok: false, errors: ['udloeb:mangler'] })
  })
})

describe('round-tripping a refusal', () => {
  it('carries the codes and the values back, and reads them again unchanged', () => {
    const submitted = form({ message: 'Hej', linkChoice: '/menu', linkLabel: 'Se menuen' })
    const echo = encodeAnnouncementEcho(submitted, ['besked:tom'])

    expect(decodeAnnouncementErrors(echo.getAll('fejl'))).toEqual(['besked:tom'])
    expect(readAnnouncementForm(echo)).toEqual(submitted)
  })

  it('drops a code this application did not define', () => {
    expect(decodeAnnouncementErrors(['besked:tom', 'noget:andet', ''])).toEqual([
      'besked:tom',
    ])
  })

  it('binds every code to the field it belongs to', () => {
    expect(announcementErrorField('besked:tom')).toBe('besked')
    expect(announcementErrorField('adresse:ugyldig')).toBe('adresse')
    expect(announcementErrorField('udloeb:fortid')).toBe('udloeb')
  })
})

describe('showing a stored row in the form', () => {
  it('reads the expiry back as the Copenhagen wall clock it was typed as', () => {
    const values = announcementFormValues(
      {
        message: 'Hej',
        link_type: 'none',
        link_page: null,
        link_url: null,
        link_label: null,
        expires_at: '2026-09-20T18:00:00.000Z',
      },
      'custom',
    )

    expect(values).toMatchObject({
      message: 'Hej',
      linkChoice: NO_LINK_CHOICE,
      expiryDate: '2026-09-20',
      expiryTime: '20:00',
    })
  })

  it('selects the page in the list for an internal link', () => {
    expect(
      announcementFormValues(
        {
          message: 'Hej',
          link_type: 'page',
          link_page: '/find-os',
          link_url: null,
          link_label: 'Se tider',
          expires_at: null,
        },
        'custom',
      ),
    ).toMatchObject({ linkChoice: '/find-os', linkLabel: 'Se tider' })
  })

  it('selects "Anden adresse" for an external link', () => {
    expect(
      announcementFormValues(
        {
          message: 'Hej',
          link_type: 'url',
          link_page: null,
          link_url: 'https://example.test',
          link_label: 'Læs mere',
          expires_at: null,
        },
        'custom',
      ),
    ).toMatchObject({ linkChoice: EXTERNAL_LINK_CHOICE, linkUrl: 'https://example.test' })
  })

  it('leaves both expiry fields empty when nothing is stored', () => {
    const values = announcementFormValues(
      {
        message: null,
        link_type: 'none',
        link_page: null,
        link_url: null,
        link_label: null,
        expires_at: null,
      },
      'custom',
    )

    expect(values).toMatchObject({ message: '', expiryDate: '', expiryTime: '' })
  })
})
