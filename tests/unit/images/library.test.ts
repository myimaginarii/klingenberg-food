import { describe, expect, it } from 'vitest'

import {
  describeImageDeletion,
  describeImageReplacement,
  imageAccessibleName,
  imageDisplayName,
  parseAltText,
  planThumbnail,
  readDerivativeRecord,
  thumbnailAlt,
  usageLabel,
  ALT_TEXT_MAX_LENGTH,
  UNUSED_LABEL,
  type ImageUsage,
} from '@/lib/images/library'

/**
 * The library view model — design 1w; phase 10B (brief §2, §3, §10–§12, §14, §17, §25).
 *
 * The pure half of the 1w screen: usage labels derived from ids, the thumbnail
 * rung selection, the alt-text rules, and the confirmation sentences.
 */

const STORAGE_PATH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/original.jpg'

const dish = (name: string, pending = false): ImageUsage => ({ kind: 'dish', name, pending })
const WEEKLY: ImageUsage = { kind: 'weekly', name: 'Ugens ret', pending: false }
const NEWS: ImageUsage = { kind: 'news', name: 'Nyheden “Lukket i påsken”', pending: false }

describe('usageLabel — 1w\'s captions', () => {
  it('an unused image reads exactly the frame\'s muted state', () => {
    expect(usageLabel([])).toBe(UNUSED_LABEL)
    expect(usageLabel([])).toBe('Bruges ikke endnu')
  })

  it('one dish usage reads the brief\'s own example', () => {
    expect(usageLabel([dish('Odin')])).toBe('Bruges på: Odin')
  })

  it('multiple usages are all named, joined with the interpunct', () => {
    expect(usageLabel([dish('Odin'), WEEKLY, NEWS])).toBe(
      'Bruges på: Odin · Ugens ret · Nyheden “Lukket i påsken”',
    )
  })

  // Phase 10C-1: pending draft references, in simple Danish (brief §12).
  it('a reference that exists only in a draft is marked (kladde)', () => {
    expect(usageLabel([dish('Odin', true)])).toBe('Bruges på: Odin (kladde)')
  })

  it('one place with both a live and a pending reference is named once, unmarked', () => {
    expect(usageLabel([dish('Odin'), dish('Odin', true)])).toBe('Bruges på: Odin')
  })

  it('live and pending places mix without confusing each other', () => {
    expect(
      usageLabel([
        dish('Odin'),
        { kind: 'weekly', name: 'Ugens ret', pending: true },
        NEWS,
      ]),
    ).toBe('Bruges på: Odin · Ugens ret (kladde) · Nyheden “Lukket i påsken”')
  })
})

describe('planThumbnail — the smallest public derivative (brief §12)', () => {
  it('chooses the smallest rung, both formats, with its own dimensions', () => {
    const plan = planThumbnail(STORAGE_PATH, {
      formats: ['avif', 'webp'],
      widths: [
        { width: 480, height: 336 },
        { width: 960, height: 672 },
        { width: 1440, height: 1008 },
      ],
    })

    expect(plan).toEqual({
      webpPath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/480.webp',
      avifPath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/480.avif',
      width: 480,
      height: 336,
    })
  })

  it('never selects a larger rung even if the record is ordered oddly', () => {
    const plan = planThumbnail(STORAGE_PATH, {
      formats: ['avif', 'webp'],
      widths: [
        { width: 960, height: 672 },
        { width: 480, height: 336 },
      ],
    })

    expect(plan?.width).toBe(480)
  })

  it('a below-ladder original uses its single own-width rung', () => {
    const plan = planThumbnail(STORAGE_PATH, {
      formats: ['avif', 'webp'],
      widths: [{ width: 300, height: 200 }],
    })

    expect(plan?.webpPath).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/300.webp')
    expect(plan?.height).toBe(200)
  })

  it('a record with no rungs plans nothing rather than inventing a path', () => {
    expect(planThumbnail(STORAGE_PATH, { formats: ['avif', 'webp'], widths: [] })).toBeNull()
  })
})

describe('readDerivativeRecord — projection of the stored document', () => {
  it('accepts exactly the shape create_image() validated', () => {
    expect(
      readDerivativeRecord({
        formats: ['avif', 'webp'],
        widths: [{ width: 480, height: 360 }],
      }),
    ).toEqual({ formats: ['avif', 'webp'], widths: [{ width: 480, height: 360 }] })
  })

  it.each([
    ['null', null],
    ['a string', 'derivatives'],
    ['missing widths', { formats: ['avif', 'webp'] }],
    ['an unknown format', { formats: ['gif'], widths: [{ width: 480, height: 360 }] }],
    ['a non-numeric width', { formats: ['avif', 'webp'], widths: [{ width: '480', height: 360 }] }],
    ['a zero height', { formats: ['avif', 'webp'], widths: [{ width: 480, height: 0 }] }],
    ['an empty ladder', { formats: ['avif', 'webp'], widths: [] }],
  ])('refuses %s', (_name, value) => {
    expect(readDerivativeRecord(value)).toBeNull()
  })
})

describe('the display identity — no sizes, formats or pixel measurements', () => {
  it('shows the person\'s filename when one survived sanitisation', () => {
    expect(imageDisplayName('IMG_2024 fra telefonen.jpg')).toBe('IMG_2024 fra telefonen.jpg')
  })

  it('falls back to a neutral Danish name', () => {
    expect(imageDisplayName(null)).toBe('Billede uden filnavn')
  })

  it('a thumbnail\'s alt is the description, or empty — never the filename', () => {
    expect(thumbnailAlt('Burgeren fra siden')).toBe('Burgeren fra siden')
    expect(thumbnailAlt(null)).toBe('')
  })

  it('a card\'s accessible name is the description, or the filename', () => {
    expect(imageAccessibleName('Burgeren fra siden', 'IMG.jpg')).toBe('Burgeren fra siden')
    expect(imageAccessibleName(null, 'IMG.jpg')).toBe('IMG.jpg')
    expect(imageAccessibleName(null, null)).toBe('Billede uden filnavn')
  })
})

describe('parseAltText — brief §10 and §11', () => {
  it('a sentence is kept, trimmed', () => {
    expect(parseAltText('  Burgeren fra siden, med pommes frites.  ')).toEqual({
      ok: true,
      value: 'Burgeren fra siden, med pommes frites.',
    })
  })

  it('blank is absent, not an error — empty alt text stays allowed', () => {
    expect(parseAltText('')).toEqual({ ok: true, value: null })
    expect(parseAltText('   ')).toEqual({ ok: true, value: null })
  })

  it('the cap refuses with a named error', () => {
    const result = parseAltText('x'.repeat(ALT_TEXT_MAX_LENGTH + 1))
    expect(result).toEqual({ ok: false, error: 'for_lang' })
  })

  it('exactly the cap is accepted', () => {
    expect(parseAltText('x'.repeat(ALT_TEXT_MAX_LENGTH)).ok).toBe(true)
  })

  it('control characters are refused, never silently stripped', () => {
    expect(parseAltText('en\u0000beskrivelse')).toEqual({ ok: false, error: 'ugyldig' })
  })

  it('Danish letters and ordinary punctuation pass', () => {
    expect(parseAltText('Ugens ret — æbleflæsk på rugbrød, 2 stk.').ok).toBe(true)
  })
})

describe('describeImageDeletion — 1w\'s warning (brief §14)', () => {
  it('an unused image gets a plain confirmation', () => {
    const prompt = describeImageDeletion([])

    expect(prompt.question).toBe('Slet billedet?')
    expect(prompt.consequence).toContain('kan ikke fortrydes')
    expect(prompt.consequence).not.toContain('Bruges')
    expect(prompt.confirmLabel).toBe('Slet billede')
  })

  it('a used image names every place and states the removal explicitly', () => {
    const prompt = describeImageDeletion([dish('Odin'), WEEKLY])

    // 1w's own sentence shape, with the real usage list.
    expect(prompt.consequence).toContain('Billedet bruges på: Odin · Ugens ret.')
    expect(prompt.consequence).toContain('forsvinder det også der')
    expect(prompt.consequence).toContain('fjernes fra alle de nævnte steder')
    expect(prompt.consequence).toContain('kladder medregnet')
    expect(prompt.consequence).toContain('kan ikke fortrydes')
  })

  // Phase 10C-1: an image referenced only by a pending draft still warns, with the
  // same kladde marker the library caption uses — the count and the caption read
  // the same trusted reference set.
  it('a draft-only reference warns with its (kladde) marker', () => {
    const prompt = describeImageDeletion([dish('Odin', true)])

    expect(prompt.consequence).toContain('Billedet bruges på: Odin (kladde).')
    expect(prompt.consequence).toContain('kan ikke fortrydes')
  })
})

describe('describeImageReplacement — what Erstat promises (brief §17)', () => {
  it('a used image\'s replacement names where the new image takes over', () => {
    const sentence = describeImageReplacement([dish('Odin')])

    expect(sentence).toContain('Det nye billede overtager alle de steder')
    expect(sentence).toContain('Odin')
    // The ordering promise: nothing old is destroyed before the new is ready.
    expect(sentence).toContain('Det gamle billede slettes først, når det nye er uploadet')
  })

  it('an unused image\'s replacement is honest about what it amounts to', () => {
    const sentence = describeImageReplacement([])

    expect(sentence).toContain('bruges ikke endnu')
    expect(sentence).toContain('slettes først, når det nye er uploadet')
  })
})
