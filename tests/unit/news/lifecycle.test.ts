import { describe, expect, it } from 'vitest'

import {
  describeArticleAddress,
  describeDelete,
  describeNewsState,
  describePublish,
  describeSaveConsequence,
  describeUnpublish,
  isArticlePublic,
} from '@/lib/news/lifecycle'

/**
 * The words the news administration uses about state — asserted here so the screen
 * arranges sentences it cannot reword, and so the model's one sharp edge (a published
 * article's edit is live when saved) is a sentence someone deliberately wrote.
 */

describe('isArticlePublic — published/public eligibility', () => {
  it('is exactly the status: published is public, draft is not', () => {
    expect(isArticlePublic('published')).toBe(true)
    expect(isArticlePublic('draft')).toBe(false)
  })
})

describe('describeNewsState — 1z’s pill and date line, in words', () => {
  it('says Udgivet with the publication date, in Copenhagen', () => {
    expect(
      describeNewsState({
        status: 'published',
        publishedAt: '2026-08-20T08:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
      }),
    ).toEqual({ pill: 'Udgivet', line: 'Offentliggjort 20.08.2026', tone: 'published' })
  })

  it('says Kladde with the last-edited date', () => {
    expect(
      describeNewsState({
        status: 'draft',
        publishedAt: null,
        updatedAt: '2026-09-01T10:00:00.000Z',
      }),
    ).toEqual({ pill: 'Kladde', line: 'Rettet 01.09.2026', tone: 'draft' })
  })

  it('reads the date in Copenhagen, not UTC — late evening crosses midnight', () => {
    // 23:30 UTC on the 31st is 01:30 on the 1st in Copenhagen (CEST).
    expect(
      describeNewsState({
        status: 'draft',
        publishedAt: null,
        updatedAt: '2026-08-31T23:30:00.000Z',
      }).line,
    ).toBe('Rettet 01.09.2026')
  })

  it('an unpublished-again article is a Kladde whatever published_at remembers', () => {
    // After "Fjern fra hjemmesiden", published_at survives (it freezes the slug) but
    // the state a person acts on is the status.
    expect(
      describeNewsState({
        status: 'draft',
        publishedAt: '2026-08-20T08:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
      }).pill,
    ).toBe('Kladde')
  })
})

describe('describeArticleAddress — §7f under the title field', () => {
  it('shows the address and says it still follows the title before first publish', () => {
    const address = describeArticleAddress({ slug: 'ny-burger', publishedAt: null })

    expect(address.path).toBe('/nyheder/ny-burger')
    expect(address.note).toContain('dannes ud fra overskriften')
  })

  it('says the address is locked once the article has been published', () => {
    const address = describeArticleAddress({
      slug: 'ny-burger',
      publishedAt: '2026-08-20T08:00:00.000Z',
    })

    expect(address.note).toContain('låst')
  })
})

describe('describeSaveConsequence — the model, said out loud (§4)', () => {
  it('says a published article’s save is on the hjemmeside immediately', () => {
    expect(describeSaveConsequence('published')).toContain('med det samme')
  })

  it('says a draft stays invisible until it is published', () => {
    expect(describeSaveConsequence('draft')).toContain('ikke se den')
  })
})

describe('the three confirmations', () => {
  it('publish asks with 1s’s own sentence', () => {
    const prompt = describePublish('Ny burger')

    expect(prompt.question).toBe('Offentliggør “Ny burger”?')
    expect(prompt.consequence).toBe('Den bliver synlig på hjemmesiden og på forsiden.')
    expect(prompt.confirmLabel).toBe('Offentliggør')
  })

  it('unpublish states §7f whole: gone, address dead, kept, same address on return', () => {
    const prompt = describeUnpublish('Ny burger')

    expect(prompt.question).toContain('Fjern')
    expect(prompt.consequence).toContain('adressen holder op med at virke')
    expect(prompt.consequence).toContain('samme adresse')
    expect(prompt.confirmLabel).toBe('Fjern fra hjemmesiden')
  })

  it('deleting a published article says it is visible now and that there is no undo', () => {
    const prompt = describeDelete({ title: 'Ny burger', status: 'published' })

    expect(prompt.consequence).toContain('synlig på hjemmesiden')
    expect(prompt.consequence).toContain('ikke fortrydes')
  })

  it('deleting a draft says the draft goes, with no claim about the hjemmeside', () => {
    const prompt = describeDelete({ title: 'Ny burger', status: 'draft' })

    expect(prompt.consequence).toContain('Kladden')
    expect(prompt.consequence).not.toContain('synlig')
  })
})
