import { describe, expect, it } from 'vitest'

import { isAnnouncementExpired } from '@/lib/announcements/expiry'
import {
  ANNOUNCEMENT_DRAFT_FIELDS,
  ANNOUNCEMENT_EDITOR_FIELDS,
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  ANNOUNCEMENT_REGION_LABEL,
  announcementDraftDelta,
  announcementDraftWrite,
  announcementPublishOutlook,
  describeAnnouncementPending,
  describeAnnouncementState,
  describePublishObstacle,
  isAnnouncementPubliclyVisible,
  type AnnouncementValues,
} from '@/lib/announcements/lifecycle'
import { announcementDraft } from '@/lib/schemas/announcement'

/**
 * What an announcement is, and when a guest sees it — design 1ac, 1ad; §4, §6, §7c.
 *
 * The rules 1ac states in five lines, asserted one at a time.
 */

const MOMENT = '2026-09-14T18:00:00.000Z'

function values(overrides: Partial<AnnouncementValues> = {}): AnnouncementValues {
  return {
    message: 'Ændrede åbningstider søndag · 17:00–19:00',
    link_type: 'none',
    link_page: null,
    link_url: null,
    link_label: null,
    expires_at: MOMENT,
    ...overrides,
  }
}

describe('the editable field list', () => {
  it('is exactly the fields the draft schema carries', () => {
    // The editor owns every field of this entity — an announcement has no image and no
    // sort order — so the two lists coincide. Asserted rather than assumed, because a
    // field added to the schema and not to the editor would be a field nobody can set.
    expect([...ANNOUNCEMENT_EDITOR_FIELDS].sort()).toEqual([...ANNOUNCEMENT_DRAFT_FIELDS].sort())
  })

  it('does not include is_visible, source, previous or replaced_at', () => {
    // §6: showing and hiding the bar is the immediate path and never a draft. The other
    // three are written by the system (phase 7B and phase 8), never by an editor.
    for (const field of ['is_visible', 'source', 'previous', 'replaced_at']) {
      expect(ANNOUNCEMENT_EDITOR_FIELDS).not.toContain(field)
      expect(announcementDraft.fields).not.toContain(field)
    }
  })

  it('states the message limit the design and the CHECK both carry', () => {
    expect(ANNOUNCEMENT_MESSAGE_MAX_LENGTH).toBe(90)
  })

  it('states 1ac’s screen-reader label exactly', () => {
    expect(ANNOUNCEMENT_REGION_LABEL).toBe('Besked fra restauranten')
  })
})

describe('the message limit, at its boundary', () => {
  const parse = (message: string) => announcementDraft.input.safeParse({ message })

  it('accepts a message of exactly 90 characters', () => {
    expect(parse('x'.repeat(90)).success).toBe(true)
  })

  it('refuses a message of 91 characters rather than truncating it', () => {
    const result = parse('x'.repeat(91))

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).join(' ')).toContain('90 tegn')
  })

  it('trims a message before measuring it', () => {
    const result = parse(`  ${'x'.repeat(90)}  `)

    expect(result.success).toBe(true)
    expect(result.data?.message).toBe('x'.repeat(90))
  })

  it('turns a blank message into null rather than an empty string', () => {
    expect(parse('   ').data?.message).toBeNull()
  })

  it('refuses an unknown key outright', () => {
    // The draft is written through a strict schema, so a submission carrying
    // `is_visible` is a refusal rather than something to ignore silently.
    expect(
      announcementDraft.input.safeParse({ message: 'x', is_visible: true }).success,
    ).toBe(false)
  })
})

describe('public eligibility', () => {
  const live = { ...values(), is_visible: true }

  it('shows the bar before the expiry', () => {
    expect(isAnnouncementPubliclyVisible(live, new Date(Date.parse(MOMENT) - 1))).toBe(true)
  })

  it('hides it at exactly the expiry instant', () => {
    expect(isAnnouncementPubliclyVisible(live, new Date(Date.parse(MOMENT)))).toBe(false)
  })

  it('hides it after the expiry', () => {
    expect(isAnnouncementPubliclyVisible(live, new Date(Date.parse(MOMENT) + 1))).toBe(false)
  })

  it('hides it when the bar is switched off', () => {
    expect(
      isAnnouncementPubliclyVisible(
        { ...live, is_visible: false },
        new Date(Date.parse(MOMENT) - 1),
      ),
    ).toBe(false)
  })

  it.each([null, '', '   '])('hides it when the message is %s', (message) => {
    expect(
      isAnnouncementPubliclyVisible(
        { ...live, message },
        new Date(Date.parse(MOMENT) - 1),
      ),
    ).toBe(false)
  })

  it('hides it when there is no expiry at all', () => {
    expect(isAnnouncementPubliclyVisible({ ...live, expires_at: null }, new Date())).toBe(false)
  })

  it('is the composition the loader and the region make between them', () => {
    /*
     * `lib/content/announcement.ts` answers the two time-free conditions, because a
     * clock inside a cached read would be frozen with the entry; `AnnouncementRegion`
     * answers the third against its own render's clock. This asserts that the two halves
     * add up to the whole, so neither can drift.
     */
    for (const candidate of [
      live,
      { ...live, is_visible: false },
      { ...live, message: null },
      { ...live, expires_at: null },
      { ...live, expires_at: '2020-01-01T00:00:00Z' },
    ]) {
      for (const now of [
        new Date(Date.parse(MOMENT) - 1),
        new Date(Date.parse(MOMENT)),
        new Date(Date.parse(MOMENT) + 1),
      ]) {
        const loaderWouldReturnIt =
          candidate.is_visible &&
          candidate.message !== null &&
          candidate.message.trim().length > 0 &&
          candidate.expires_at !== null

        const regionWouldRenderIt =
          loaderWouldReturnIt && !isAnnouncementExpired(candidate.expires_at, now)

        expect(regionWouldRenderIt).toBe(isAnnouncementPubliclyVisible(candidate, now))
      }
    }
  })
})

describe('whether a draft can be published', () => {
  const before = new Date(Date.parse(MOMENT) - 60_000)

  it('is ready with a message and a future expiry', () => {
    expect(announcementPublishOutlook(values(), before)).toBe('ready')
    expect(describePublishObstacle('ready')).toBeNull()
  })

  it.each([null, '', '  '])('refuses a blank message (%s)', (message) => {
    expect(announcementPublishOutlook(values({ message }), before)).toBe('blank')
  })

  it('refuses a missing expiry', () => {
    expect(announcementPublishOutlook(values({ expires_at: null }), before)).toBe('no_expiry')
  })

  it('refuses an expiry that has already passed', () => {
    expect(
      announcementPublishOutlook(values(), new Date(Date.parse(MOMENT) + 1)),
    ).toBe('expired')
  })

  it('refuses an expiry at exactly now', () => {
    expect(announcementPublishOutlook(values(), new Date(Date.parse(MOMENT)))).toBe('expired')
  })

  it('names 1ad’s own sentence for both expiry refusals', () => {
    const sentence =
      'Vælg et tidspunkt ude i fremtiden — beskeden kan ikke offentliggøres uden.'

    expect(describePublishObstacle('no_expiry')).toBe(sentence)
    expect(describePublishObstacle('expired')).toBe(sentence)
  })

  it('says something different, and actionable, for a blank message', () => {
    expect(describePublishObstacle('blank')).toBe('Skriv en besked, før du offentliggør den.')
  })
})

describe('the draft delta', () => {
  const live = values({ message: 'Gammel besked' })

  it('holds only the fields that changed', () => {
    expect(announcementDraftDelta({ ...live, message: 'Ny besked' }, live)).toEqual({
      message: 'Ny besked',
    })
  })

  it('holds nothing when the values are the published ones', () => {
    expect(announcementDraftDelta({ ...live }, live)).toEqual({})
  })

  it('treats the same instant written differently as no change', () => {
    // PostgREST returns `+00:00`; this application writes `Z`. A string comparison would
    // put a Kladde badge on a change nobody made.
    const delta = announcementDraftDelta(
      { ...live, expires_at: '2026-09-14T20:00:00+02:00' },
      { ...live, expires_at: '2026-09-14T18:00:00.000Z' },
    )

    expect(delta).toEqual({})
  })

  it('treats a genuinely different instant as a change', () => {
    const delta = announcementDraftDelta(
      { ...live, expires_at: '2026-09-14T21:00:00+02:00' },
      { ...live, expires_at: '2026-09-14T18:00:00.000Z' },
    )

    expect(delta).toEqual({ expires_at: '2026-09-14T21:00:00+02:00' })
  })

  it('treats clearing an expiry as a change, and setting one from nothing too', () => {
    expect(
      announcementDraftDelta({ ...live, expires_at: null }, live).expires_at,
    ).toBeNull()

    expect(
      announcementDraftDelta({ ...live }, { ...live, expires_at: null }).expires_at,
    ).toBe(MOMENT)
  })

  it('clears the fields a save no longer changes, and only those', () => {
    const write = announcementDraftWrite({ ...live, message: 'Ny besked' }, live)

    expect(write.values).toEqual({ message: 'Ny besked' })
    expect([...write.clear].sort()).toEqual(
      ANNOUNCEMENT_EDITOR_FIELDS.filter((field) => field !== 'message').sort(),
    )
  })

  it('preserves an unrelated key a stored draft happens to hold', () => {
    /*
     * `clear` never names a field outside this editor's own list, so a key the editor
     * does not own survives a save untouched — the same guarantee the dish, weekly and
     * monthly editors make about `image_id`. The announcement has no such field today,
     * which is exactly why the guarantee is asserted rather than left to be true by luck.
     */
    const write = announcementDraftWrite({ ...live, message: 'Ny besked' }, live)

    expect([...write.clear, ...Object.keys(write.values)].sort()).toEqual(
      [...ANNOUNCEMENT_EDITOR_FIELDS].sort(),
    )
  })
})

describe('what the administration says about the hjemmeside', () => {
  const before = new Date(Date.parse(MOMENT) - 60_000)

  it('says there is no message when nothing is written', () => {
    const state = describeAnnouncementState(
      { ...values({ message: null }), is_visible: false },
      before,
      null,
    )

    expect(state.badge).toBe('Ingen besked')
    expect(state.tone).toBe('neutral')
    expect(state.sentence).toBe('Der står ingen besked på hjemmesiden lige nu.')
  })

  it('says the message is showing, and until when', () => {
    const state = describeAnnouncementState(
      { ...values(), is_visible: true },
      before,
      'søndag 14.09.2026 kl. 20:00',
    )

    expect(state.badge).toBe('Vises nu')
    expect(state.tone).toBe('success')
    expect(state.sentence).toBe(
      'Beskeden vises øverst på hjemmesiden indtil søndag 14.09.2026 kl. 20:00.',
    )
  })

  it('says the message has expired, and when', () => {
    const state = describeAnnouncementState(
      { ...values(), is_visible: true },
      new Date(Date.parse(MOMENT) + 1),
      'søndag 14.09.2026 kl. 20:00',
    )

    expect(state.badge).toBe('Udløbet')
    expect(state.sentence).toContain('udløb søndag 14.09.2026 kl. 20:00')
  })

  it('says the message is switched off', () => {
    // Reachable only once phase 7B builds the switch, and stated now so the screen is
    // right about a row a later phase can produce.
    const state = describeAnnouncementState(
      { ...values(), is_visible: false },
      before,
      'søndag 14.09.2026 kl. 20:00',
    )

    expect(state.badge).toBe('Slået fra')
  })

  it('reads the published values, so a draft never changes what it says', () => {
    // The function only takes one set of values, which is the point: the page passes it
    // `live`, and there is no parameter through which a draft could reach it.
    expect(describeAnnouncementState.length).toBe(3)
  })
})

describe('the Kladde band', () => {
  it('says nothing when nothing is pending', () => {
    expect(describeAnnouncementPending([])).toBeNull()
  })

  it('names the field that changed', () => {
    expect(describeAnnouncementPending(['message'])).toBe(
      'Ændringer i beskeden venter på at blive offentliggjort.',
    )
  })

  it('names several fields in a Danish list', () => {
    expect(describeAnnouncementPending(['message', 'expires_at'])).toBe(
      'Ændringer i beskeden og udløbstidspunktet venter på at blive offentliggjort.',
    )
  })

  it('collapses the three link columns into one word', () => {
    expect(describeAnnouncementPending(['link_type', 'link_page', 'link_url'])).toBe(
      'Ændringer i linket venter på at blive offentliggjort.',
    )
  })

  it('ignores a key that is not an editable field', () => {
    expect(describeAnnouncementPending(['is_visible', 'source'])).toBeNull()
  })
})
