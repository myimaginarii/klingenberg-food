import { describe, expect, it } from 'vitest'

import {
  CONTACT_ERROR_FIELD,
  CONTACT_FORM,
  decodeContactErrors,
  encodeContactEcho,
  readContactForm,
} from '@/app/(admin)/admin/kontakt/forms'
import { contactHref } from '@/app/(admin)/admin/kontakt/routes'
import { CONTACT_FIELD_KEYS } from '@/lib/contact/editor'

/** The Kontaktoplysninger form's vocabulary — phase 11B; technical plan §8. */

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('the vocabulary', () => {
  it('is the seven columns and the version token, and nothing the row must not be told', () => {
    expect(Object.values(CONTACT_FORM).sort()).toEqual(['version', ...CONTACT_FIELD_KEYS].sort())
    for (const forbidden of ['venue_name', 'map_attribution', 'is_singleton', 'draft', 'id']) {
      expect(Object.values(CONTACT_FORM) as string[]).not.toContain(forbidden)
    }
  })

  it('reads exactly what was typed, a missing field as the empty string', () => {
    expect(readContactForm(form({ primary_phone: ' +45 63 90 83 00 ', city: 'Odense' }))).toEqual({
      primary_phone: ' +45 63 90 83 00 ',
      secondary_phone: '',
      address_line1: '',
      postal_code: '',
      city: 'Odense',
      email: '',
      facebook_url: '',
    })
  })
})

describe('errors and echoes', () => {
  it('round-trips the issues and the typed values through the address', () => {
    const typed = readContactForm(form({ primary_phone: 'x', facebook_url: 'javascript:1' }))
    const echo = encodeContactEcho(typed, [
      { field: 'primary_phone', message: 'Hovednummeret skal være et telefonnummer, fx +45 63 90 83 00.' },
      { field: 'facebook_url', message: 'Facebook-adressen skal være en https-adresse.' },
    ])

    expect(decodeContactErrors(echo.getAll(CONTACT_ERROR_FIELD))).toEqual([
      { field: 'primary_phone', message: 'Hovednummeret skal være et telefonnummer, fx +45 63 90 83 00.' },
      { field: 'facebook_url', message: 'Facebook-adressen skal være en https-adresse.' },
    ])
    expect(readContactForm(echo)).toEqual(typed)
  })

  it('ignores a hand-typed issue for a field this screen does not have, or with no message', () => {
    expect(decodeContactErrors(['venue_name:x', 'primary_phone:', 'noget', ':x'])).toEqual([])
  })

  it('builds addresses on this screen only', () => {
    expect(contactHref()).toBe('/admin/kontakt')
    expect(contactHref({ status: 'gemt', focus: true })).toBe('/admin/kontakt?status=gemt#kontaktoplysninger')
  })
})
