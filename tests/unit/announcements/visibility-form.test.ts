import { describe, expect, it } from 'vitest'

import {
  ANNOUNCEMENT_FORM,
  ANNOUNCEMENT_VISIBILITY_FORM,
  readAnnouncementForm,
  readAnnouncementVisibilityForm,
} from '@/app/(admin)/admin/besked/forms'
import {
  ANNOUNCEMENT_PARAM,
  announcementHref,
} from '@/app/(admin)/admin/besked/routes'

/**
 * What the immediate path will and will not accept from a browser — design 1ad;
 * technical plan §6, §8.
 *
 * The submission for "Vis besked" off, "Fjern beskeden nu" and the Fortryd that follows
 * either is two fields wide: a state to move to, and the version token the screen was
 * rendered from. This file holds it to that.
 *
 * The negatives here are the point. §8's rule is that authority never comes from the
 * browser, and the way this screen keeps it is structural: the parser reads two names and
 * no others, so a forged POST carrying a message, a link, a `source`, a `previous` or a
 * `replaced_at` is not sanitised — those fields are never looked at. The assertions below
 * pass because the shape does not have the fields, not because something strips them.
 */

const VERSION = '2026-08-30T16:00:00.000Z'

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

describe('what a visibility submission may say', () => {
  it('reads a request to take the bar down now', () => {
    expect(
      readAnnouncementVisibilityForm(
        form({
          [ANNOUNCEMENT_VISIBILITY_FORM.visible]: '0',
          [ANNOUNCEMENT_VISIBILITY_FORM.version]: VERSION,
        }),
      ),
    ).toEqual({ visible: false, expectedUpdatedAt: VERSION })
  })

  it('reads a Fortryd — the same two fields, with the state inverted', () => {
    expect(
      readAnnouncementVisibilityForm(
        form({
          [ANNOUNCEMENT_VISIBILITY_FORM.visible]: '1',
          [ANNOUNCEMENT_VISIBILITY_FORM.version]: VERSION,
        }),
      ),
    ).toEqual({ visible: true, expectedUpdatedAt: VERSION })
  })

  it.each([
    ['a state that is neither 0 nor 1', { vis: 'ja', version: VERSION }],
    ['no state at all', { version: VERSION }],
    ['no version token', { vis: '0' }],
    ['a version token that is not an instant', { vis: '0', version: 'i går' }],
    ['a version token with no offset', { vis: '0', version: '2026-08-30T16:00:00' }],
  ])('refuses %s', (_what, entries) => {
    expect(readAnnouncementVisibilityForm(form(entries))).toBeNull()
  })
})

describe('what it cannot say, however the browser is edited (§8)', () => {
  const forged = form({
    [ANNOUNCEMENT_VISIBILITY_FORM.visible]: '0',
    [ANNOUNCEMENT_VISIBILITY_FORM.version]: VERSION,
    // Everything a hand-written POST might try to carry along with the intent.
    besked: 'Smuglet besked',
    message: 'Smuglet besked',
    link: '/menu',
    adresse: 'https://andet.test',
    linktekst: 'Se her',
    udloeb_dato: '2099-01-01',
    udloeb_tid: '20:00',
    expires_at: '2099-01-01T20:00:00Z',
    source: 'opening_hours',
    previous: '{"message":"noget andet"}',
    replaced_at: '2026-08-30T16:00:00.000Z',
    is_visible: '1',
    entity: 'pages',
    id: '00000000-0000-4000-8000-000000000000',
    draft: '{"message":"kladde"}',
  })

  it('reads exactly two fields and ignores every other one', () => {
    expect(readAnnouncementVisibilityForm(forged)).toEqual({
      visible: false,
      expectedUpdatedAt: VERSION,
    })
  })

  it('the vocabulary itself has only those two names', () => {
    expect(Object.keys(ANNOUNCEMENT_VISIBILITY_FORM).sort()).toEqual(['version', 'visible'])
  })

  it('names no field for a message, a link, an expiry, a source or a replacement', () => {
    const names = Object.values(ANNOUNCEMENT_VISIBILITY_FORM as Record<string, string>)

    for (const forbidden of [
      'besked',
      'message',
      'link',
      'adresse',
      'linktekst',
      'udloeb',
      'expires_at',
      'source',
      'previous',
      'replaced_at',
      'draft',
      'entity',
      'id',
    ]) {
      expect(names, `no field is called ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('the two vocabularies stay apart', () => {
  it('a content submission cannot reach the visibility action', () => {
    const content = form({
      [ANNOUNCEMENT_FORM.version]: VERSION,
      [ANNOUNCEMENT_FORM.message]: 'Ændrede åbningstider søndag',
      [ANNOUNCEMENT_FORM.expiryChoice]: 'custom',
    })

    expect(readAnnouncementVisibilityForm(content)).toBeNull()
  })

  it('a visibility submission carries nothing the content parser would use', () => {
    const visibility = form({
      [ANNOUNCEMENT_VISIBILITY_FORM.visible]: '0',
      [ANNOUNCEMENT_VISIBILITY_FORM.version]: VERSION,
    })

    const read = readAnnouncementForm(visibility)

    expect(read.message).toBe('')
    expect(read.linkUrl).toBe('')
    expect(read.linkLabel).toBe('')
    expect(read.expiryDate).toBe('')
    expect(read.expiryTime).toBe('')
  })
})

describe('the Fortryd offer lives in the address, and carries no authority', () => {
  it('builds the offer from the version the write returned and the state to restore', () => {
    const href = announcementHref({
      focus: true,
      undo: { version: VERSION, visible: true },
    })

    const query = new URLSearchParams(href.split('?')[1]?.split('#')[0] ?? '')

    expect(query.get(ANNOUNCEMENT_PARAM.undoVersion)).toBe(VERSION)
    expect(query.get(ANNOUNCEMENT_PARAM.undoVisible)).toBe('1')
    expect(href.endsWith('#besked')).toBe(true)
  })

  it('offers nothing when there is nothing to undo', () => {
    const href = announcementHref({ focus: true, status: 'uaendret', undo: null })

    expect(href).not.toContain(ANNOUNCEMENT_PARAM.undoVersion)
    expect(href).not.toContain(ANNOUNCEMENT_PARAM.undoVisible)
  })

  it('uses its own parameter names, so no other screen’s Fortryd can be read as this one', () => {
    expect(ANNOUNCEMENT_PARAM.undoVersion).toBe('fortryd_version')
    expect(ANNOUNCEMENT_PARAM.undoVisible).toBe('fortryd_vis')
  })
})
