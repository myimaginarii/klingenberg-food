import { describe, expect, it } from 'vitest'

import {
  CONTACT_FIELD_KEYS,
  CONTACT_FIELDS,
  contactDraftWrite,
  contactFormValues,
  contactValuesOf,
  describeContactPending,
  pendingContactFields,
  toContactSubmission,
  type ContactFormValues,
} from '@/lib/contact/editor'
import { siteContactDraft } from '@/lib/schemas/contact'
import { telHref } from '@/lib/site/links'

/**
 * The Kontaktoplysninger editor's rules — phase 11B; technical plan §4, §5, §6, §8.
 *
 * 1v's fields and only those, the schema's own validation bound per field, the
 * per-field delta, and the public `tel:` derivation the stored value has to survive.
 */

const SEEDED: ContactFormValues = {
  primary_phone: '+45 63 90 83 00',
  secondary_phone: '+45 51 79 45 66',
  address_line1: 'Lumbyvej 62',
  postal_code: '5792',
  city: 'Nørre Lyndelse',
  email: '',
  facebook_url: 'https://www.facebook.com/carlnielsencafeen',
}

describe('the fields are 1v\'s, and only 1v\'s', () => {
  it('draws the seven facts in the frame\'s order, and no Instagram, venue name or map credit', () => {
    expect(CONTACT_FIELDS.map((field) => field.key)).toEqual([...CONTACT_FIELD_KEYS])
    expect(CONTACT_FIELD_KEYS).toEqual([
      'primary_phone',
      'secondary_phone',
      'address_line1',
      'postal_code',
      'city',
      'email',
      'facebook_url',
    ])
    for (const absent of ['instagram_url', 'venue_name', 'map_attribution', 'whatsapp']) {
      expect((CONTACT_FIELD_KEYS as readonly string[]).includes(absent), absent).toBe(false)
    }
  })

  it('every field is a field of the schema', () => {
    for (const key of CONTACT_FIELD_KEYS) expect(siteContactDraft.fields).toContain(key)
  })

  it('carries 1v\'s helper sentences', () => {
    const hints = Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, field.hint]))
    expect(hints.primary_phone).toBe('Bruges af alle Ring-knapper og står størst på Find os.')
    expect(hints.secondary_phone).toContain('aldrig som Ring-knap')
    expect(hints.facebook_url).toContain('forsvinder hele Følg os-afsnittet')
  })
})

describe('toContactSubmission — the schema\'s own rules, per field', () => {
  it('accepts the seeded facts, trimmed, blank as null', () => {
    const result = toContactSubmission({ ...SEEDED, city: ' Nørre Lyndelse ' })
    expect(result).toEqual({
      ok: true,
      values: {
        primary_phone: '+45 63 90 83 00',
        secondary_phone: '+45 51 79 45 66',
        address_line1: 'Lumbyvej 62',
        postal_code: '5792',
        city: 'Nørre Lyndelse',
        email: null,
        facebook_url: 'https://www.facebook.com/carlnielsencafeen',
      },
    })
  })

  it('keeps the Danish phone formatting and refuses a value that is not a number', () => {
    expect(toContactSubmission({ ...SEEDED, primary_phone: '63 90 83 00' }).ok).toBe(true)
    for (const bad of ['ring til os', 'tel:+4563908300', '+45 63 90 83 00 ext 2', '123']) {
      const result = toContactSubmission({ ...SEEDED, primary_phone: bad })
      expect(result.ok, bad).toBe(false)
      if (result.ok) return
      expect(result.issues[0]?.field).toBe('primary_phone')
      expect(result.issues[0]?.message).toContain('telefonnummer')
    }
  })

  it('accepts only an https Facebook address — never javascript:, data:, http: or a bare name', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://www.facebook.com/x', 'facebook.com/x', '<a href=x>']) {
      const result = toContactSubmission({ ...SEEDED, facebook_url: bad })
      expect(result.ok, bad).toBe(false)
      if (result.ok) return
      expect(result.issues[0]).toEqual({ field: 'facebook_url', message: 'Facebook-adressen skal være en https-adresse.' })
    }
    expect(toContactSubmission({ ...SEEDED, facebook_url: '' }).ok).toBe(true)
  })

  it('refuses an e-mail that is not one, and reports every refusal at once', () => {
    const result = toContactSubmission({ ...SEEDED, email: 'ikke en adresse', primary_phone: 'x' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toEqual(['primary_phone', 'email'])
  })

  it('every accepted submission is accepted by the strict schema too, whole', () => {
    const result = toContactSubmission(SEEDED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(siteContactDraft.input.safeParse(result.values).success).toBe(true)
  })
})

describe('the public tel: link survives what the editor stores', () => {
  it('derives a dialable href from the stored, spaced Danish form', () => {
    expect(telHref('+45 63 90 83 00')).toBe('tel:+4563908300')
    expect(telHref('63908300')).toBe('tel:63908300')
  })
})

describe('the delta (§4)', () => {
  const live = contactValuesOf({
    primary_phone: '+45 63 90 83 00',
    secondary_phone: '+45 51 79 45 66',
    address_line1: 'Lumbyvej 62',
    postal_code: '5792',
    city: 'Nørre Lyndelse',
    email: null,
    facebook_url: 'https://www.facebook.com/carlnielsencafeen',
  })

  it('writes the changed fields and clears the unchanged ones', () => {
    const submitted = { ...live, secondary_phone: null, email: 'hej@klingenberg.test' }
    expect(contactDraftWrite(submitted, live)).toEqual({
      values: { secondary_phone: null, email: 'hej@klingenberg.test' },
      clear: ['primary_phone', 'address_line1', 'postal_code', 'city', 'facebook_url'],
    })
  })

  it('an unchanged submission clears everything and writes nothing', () => {
    expect(contactDraftWrite(live, live).values).toEqual({})
    expect(contactDraftWrite(live, live).clear).toEqual([...CONTACT_FIELD_KEYS])
  })

  it('the form values are the stored values with null as the empty string', () => {
    expect(contactFormValues(live)).toEqual(SEEDED)
  })
})

describe('the sentences the screen says', () => {
  it('names the waiting fields in 1v\'s order, without "(valgfrit)"', () => {
    expect(describeContactPending([])).toBeNull()
    expect(describeContactPending(['email'])).toBe('E-mail afventer offentliggørelse.')
    expect(describeContactPending(['facebook_url', 'primary_phone', 'secondary_phone'])).toBe(
      'Primært telefonnummer, Ekstra telefonnummer og Facebook afventer offentliggørelse.',
    )
    expect([...pendingContactFields(['city', 'noget_andet'])]).toEqual(['city'])
  })
})
