import { describe, expect, it } from 'vitest'

import {
  ABOUT_CARD_LABELS,
  ABOUT_FIELD_KEYS,
  ABOUT_IMAGE_SLOTS,
  ABOUT_STORY_TEXT_MAX,
  aboutImageWrite,
  aboutSectionWrite,
  aboutSlotImageId,
  aboutStoryWrite,
  aboutValuesOf,
  describeAboutPending,
  pendingAboutCards,
  readAboutImageSlot,
  storyBlocksToText,
  textToStoryBlocks,
  toAboutMethod,
  toAboutStory,
  toAboutTeam,
  type AboutValues,
} from '@/lib/pages/about'
import { aboutDraft } from '@/lib/schemas/page-documents'

/**
 * The Om os document's rules — phase 14B1; technical plan §4, §6, §7e item 4.
 *
 * Pure functions, asserted directly: the normalisation the public page and the editor
 * share, the story's paragraphs through one field, the per-key and per-section deltas
 * that keep a page draft holding only what changed, the three slots' writes, and the
 * sentences the screen says.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const SEEDED = {
  heading: 'Vores historie',
  story_blocks: ['Første afsnit.', 'Andet afsnit.'],
  team: { text: 'Holdet bag disken.' },
  method: { heading: 'Sådan laver vi burgere', text: 'Råvarer, brød og tilberedning.' },
}

const live: AboutValues = aboutValuesOf(SEEDED)

describe('aboutValuesOf — one normalisation for the page and the editor', () => {
  it('reads the seeded document (no image keys) with every key and section whole', () => {
    expect(live).toEqual<AboutValues>({
      heading: 'Vores historie',
      story_blocks: ['Første afsnit.', 'Andet afsnit.'],
      venue_image_id: null,
      team: { text: 'Holdet bag disken.', image_id: null },
      method: { heading: 'Sådan laver vi burgere', text: 'Råvarer, brød og tilberedning.', image_id: null },
    })
  })

  it('reads the three image ids, lower-cased, and drops anything that is not a uuid', () => {
    const values = aboutValuesOf({
      venue_image_id: A.toUpperCase(),
      team: { text: null, image_id: '../etc/passwd' },
      method: { heading: null, text: null, image_id: 42 },
    })

    expect(values.venue_image_id).toBe(A)
    expect(values.team.image_id).toBeNull()
    expect(values.method.image_id).toBeNull()
  })

  it('renders a missing, malformed or empty document as empty values rather than throwing', () => {
    for (const document of [null, undefined, 'tekst', [], {}, { team: 'ikke et objekt', story_blocks: 'x' }]) {
      const values = aboutValuesOf(document)
      expect(values.heading).toBeNull()
      expect(values.story_blocks).toEqual([])
      expect(values.team).toEqual({ text: null, image_id: null })
      expect(values.method).toEqual({ heading: null, text: null, image_id: null })
    }
  })

  it('drops blank paragraphs and non-strings from the story, and trims the rest', () => {
    expect(aboutValuesOf({ story_blocks: ['  Et  ', '', '   ', 3, null, 'To'] }).story_blocks).toEqual(['Et', 'To'])
  })

  it('agrees with the strict schema about what a whole document is', () => {
    // What the editor writes is exactly what the schema accepts: every key present.
    const whole = { ...live, story_blocks: [...live.story_blocks] }
    expect(aboutDraft.input.safeParse(whole).success).toBe(true)
  })
})

describe('the story through one field', () => {
  it('joins paragraphs with a blank line and splits them back — a round trip', () => {
    const text = storyBlocksToText(['Et.', 'To.', 'Tre.'])
    expect(text).toBe('Et.\n\nTo.\n\nTre.')
    expect(textToStoryBlocks(text)).toEqual(['Et.', 'To.', 'Tre.'])
  })

  it('treats any run of blank lines as one break, trims, drops empties and accepts Windows line ends', () => {
    expect(textToStoryBlocks('  Et. \r\n\r\n\r\n  To.\n \t \nTre.\n\n\n')).toEqual(['Et.', 'To.', 'Tre.'])
    expect(textToStoryBlocks('')).toEqual([])
    expect(textToStoryBlocks('\n\n   \n')).toEqual([])
  })

  it('keeps single line breaks inside a paragraph', () => {
    expect(textToStoryBlocks('Linje ét\nlinje to\n\nAndet afsnit')).toEqual(['Linje ét\nlinje to', 'Andet afsnit'])
  })

  it('the field limit is ten paragraphs of two thousand characters plus their separators', () => {
    expect(ABOUT_STORY_TEXT_MAX).toBe(10 * 2000 + 9 * 2)
  })
})

describe('toAboutStory / toAboutTeam / toAboutMethod — what the cards accept', () => {
  it('turns typed text into the heading and the paragraphs, blank as absent', () => {
    expect(toAboutStory({ heading: '  Vores historie ', story: 'Et.\n\nTo.' })).toEqual({
      ok: true,
      values: { heading: 'Vores historie', story_blocks: ['Et.', 'To.'] },
    })
    expect(toAboutStory({ heading: '   ', story: '' })).toEqual({
      ok: true,
      values: { heading: null, story_blocks: [] },
    })
  })

  it('reports every story issue at once: the heading, an overlong paragraph, too many paragraphs', () => {
    const result = toAboutStory({
      heading: 'x'.repeat(121),
      story: [...Array.from({ length: 10 }, () => 'y'), 'z'.repeat(2001)].join('\n\n'),
    })
    expect(result).toEqual({
      ok: false,
      issues: ['overskrift:too_long', 'historie:too_long', 'historie:too_many'],
    })
  })

  it('accepts exactly ten paragraphs of exactly two thousand characters', () => {
    const story = Array.from({ length: 10 }, () => 'x'.repeat(2000)).join('\n\n')
    expect(toAboutStory({ heading: 'Vores historie', story }).ok).toBe(true)
  })

  it('the team and the method carry the slot\'s current image so the section stays whole', () => {
    expect(toAboutTeam({ text: ' Holdet ' }, A)).toEqual({ ok: true, values: { text: 'Holdet', image_id: A } })
    expect(toAboutTeam({ text: 'x'.repeat(2001) }, null)).toEqual({ ok: false, issues: ['holdet_tekst:too_long'] })

    expect(toAboutMethod({ heading: ' Sådan ', text: '' }, B)).toEqual({
      ok: true,
      values: { heading: 'Sådan', text: null, image_id: B },
    })
    expect(toAboutMethod({ heading: 'x'.repeat(121), text: 'y'.repeat(2001) }, null)).toEqual({
      ok: false,
      issues: ['metode_overskrift:too_long', 'metode_tekst:too_long'],
    })
  })
})

describe('aboutStoryWrite — the per-key delta (§4)', () => {
  it('writes only the keys that differ, and clears the ones that no longer do', () => {
    expect(aboutStoryWrite({ heading: 'Ny', story_blocks: live.story_blocks }, live)).toEqual({
      values: { heading: 'Ny' },
      clear: ['story_blocks'],
    })
    expect(aboutStoryWrite({ heading: live.heading, story_blocks: ['Andet.'] }, live)).toEqual({
      values: { story_blocks: ['Andet.'] },
      clear: ['heading'],
    })
  })

  it('a submission equal to the published values clears both keys and writes nothing', () => {
    expect(aboutStoryWrite({ heading: live.heading, story_blocks: [...live.story_blocks] }, live)).toEqual({
      values: {},
      clear: ['heading', 'story_blocks'],
    })
  })

  it('says nothing about the facade photograph, the team or the method', () => {
    const write = aboutStoryWrite({ heading: 'Ny', story_blocks: [] }, live)
    expect(Object.keys(write.values)).toEqual(['heading', 'story_blocks'])
    expect(write.clear).not.toContain('venue_image_id')
  })
})

describe('aboutSectionWrite — the whole-section delta', () => {
  it('writes a changed section whole and clears an unchanged one', () => {
    expect(aboutSectionWrite('team', { text: 'Nyt hold', image_id: null }, live.team)).toEqual({
      values: { team: { text: 'Nyt hold', image_id: null } },
      clear: [],
    })
    expect(aboutSectionWrite('team', { text: live.team.text, image_id: null }, live.team)).toEqual({
      values: {},
      clear: ['team'],
    })
    expect(
      aboutSectionWrite('method', { heading: live.method.heading, text: live.method.text, image_id: A }, live.method),
    ).toEqual({ values: { method: { ...live.method, image_id: A } }, clear: [] })
  })
})

describe('the three photo slots', () => {
  it('names exactly three slots and parses nothing else', () => {
    expect(ABOUT_IMAGE_SLOTS).toEqual(['sted', 'holdet', 'koekken'])
    for (const slot of ABOUT_IMAGE_SLOTS) expect(readAboutImageSlot(slot)).toBe(slot)
    for (const value of ['hero', 'award', '', null, 1, 'STED']) expect(readAboutImageSlot(value)).toBeNull()
  })

  it('reads each slot\'s id from the normalised document', () => {
    const values = aboutValuesOf({ venue_image_id: A, team: { image_id: B }, method: { image_id: null } })
    expect(aboutSlotImageId(values, 'sted')).toBe(A)
    expect(aboutSlotImageId(values, 'holdet')).toBe(B)
    expect(aboutSlotImageId(values, 'koekken')).toBeNull()
  })

  it('the facade is a top-level key: choosing writes the key, choosing the live one clears it, removing writes null', () => {
    expect(aboutImageWrite('sted', A, live, live)).toEqual({ values: { venue_image_id: A }, clear: [] })
    const liveA = aboutValuesOf({ ...SEEDED, venue_image_id: A })
    expect(aboutImageWrite('sted', A, liveA, liveA)).toEqual({ values: {}, clear: ['venue_image_id'] })
    expect(aboutImageWrite('sted', null, liveA, liveA)).toEqual({ values: { venue_image_id: null }, clear: [] })
  })

  it('the team and the kitchen are written as whole sections beside their current words', () => {
    // A pending edit to the words (in `current`) survives choosing a photo.
    const current = aboutValuesOf({ ...SEEDED, team: { text: 'Ændret hold' } })
    expect(aboutImageWrite('holdet', A, current, live)).toEqual({
      values: { team: { text: 'Ændret hold', image_id: A } },
      clear: [],
    })
    expect(aboutImageWrite('koekken', B, live, live)).toEqual({
      values: { method: { ...live.method, image_id: B } },
      clear: [],
    })
    // Choosing the photo that is already live, with the words unchanged, clears the section.
    const liveB = aboutValuesOf({ ...SEEDED, method: { ...SEEDED.method, image_id: B } })
    expect(aboutImageWrite('koekken', B, liveB, liveB)).toEqual({ values: {}, clear: ['method'] })
  })
})

describe('the sentences the screen says', () => {
  it('names the waiting cards in screen order, each once, from the draft\'s own keys', () => {
    expect(describeAboutPending([])).toBeNull()
    expect(describeAboutPending(['heading'])).toBe('Historien afventer offentliggørelse.')
    expect(describeAboutPending(['story_blocks', 'heading'])).toBe('Historien afventer offentliggørelse.')
    expect(describeAboutPending(['method', 'venue_image_id'])).toBe(
      'Billedet af stedet og Køkken og tilberedning afventer offentliggørelse.',
    )
    expect(describeAboutPending([...ABOUT_FIELD_KEYS])).toBe(
      'Historien, Billedet af stedet, Holdet og Køkken og tilberedning afventer offentliggørelse.',
    )
    expect(describeAboutPending(['noget_andet'])).toBeNull()
  })

  it('tells a pending picture apart from pending words inside one section', () => {
    const current = aboutValuesOf({ ...SEEDED, team: { ...SEEDED.team, image_id: A } })
    expect(pendingAboutCards(['team'], current, live)).toEqual({
      story: false,
      venueImage: false,
      teamText: false,
      teamImage: true,
      methodText: false,
      methodImage: false,
    })

    const words = aboutValuesOf({ ...SEEDED, method: { ...SEEDED.method, heading: 'Ny' } })
    expect(pendingAboutCards(['method', 'heading', 'venue_image_id'], words, live)).toEqual({
      story: true,
      venueImage: true,
      teamText: false,
      teamImage: false,
      methodText: true,
      methodImage: false,
    })
  })

  it('the card labels are the frame\'s own where it states one', () => {
    expect(ABOUT_CARD_LABELS.team).toBe('Holdet')
  })
})
