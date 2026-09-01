import { describe, expect, it } from 'vitest'

import {
  decodeNewsErrors,
  emptyNewsForm,
  encodeNewsFormEcho,
  errorField,
  NEWS_ERROR_MESSAGES,
  newsFormValues,
  readNewsForm,
  toNewsArticleValues,
  type NewsFormValues,
} from '@/app/(admin)/admin/nyheder/article-form'
import type { AdminNewsArticle } from '@/lib/content/news-admin'

/**
 * The form → domain mapping for the news editor — every refusal it can word, the
 * §7f slug decision it hands the action, and the round trip a refused save survives.
 * The database constraints stay the final gate; this layer exists so a person is told
 * what is wrong in Danish, attached to the right field.
 */

const VALID: NewsFormValues = {
  title: 'Ny burger i oktober',
  displayDate: '2026-09-01',
  category: 'Ny burger',
  body: 'Første afsnit.\n\nAndet afsnit.',
}

function form(overrides: Partial<NewsFormValues>): NewsFormValues {
  return { ...VALID, ...overrides }
}

describe('toNewsArticleValues — the valid path', () => {
  it('maps the form to database casing, with the generated slug base beside it', () => {
    const result = toNewsArticleValues(VALID, { frozenSlug: null })

    expect(result).toEqual({
      ok: true,
      values: {
        title: 'Ny burger i oktober',
        body: {
          blocks: [
            { type: 'paragraph', spans: [{ text: 'Første afsnit.' }] },
            { type: 'paragraph', spans: [{ text: 'Andet afsnit.' }] },
          ],
        },
        category: 'Ny burger',
        display_date: '2026-09-01',
      },
      slug: { kind: 'generated', base: 'ny-burger-i-oktober' },
    })
  })

  it('trims the title and turns blank optional fields into null — blank is absent', () => {
    const result = toNewsArticleValues(
      form({ title: '  Lukket i påsken  ', displayDate: '', category: '' }),
      { frozenSlug: null },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.values.title).toBe('Lukket i påsken')
    expect(result.values.display_date).toBeNull()
    expect(result.values.category).toBeNull()
  })

  it('restates the frozen slug for a published article instead of generating one (§7f)', () => {
    const result = toNewsArticleValues(form({ title: 'Helt ny overskrift' }), {
      frozenSlug: 'gammel-adresse',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.slug).toEqual({ kind: 'frozen', slug: 'gammel-adresse' })
  })

  it('accepts a letterless title when the slug is frozen — no address is being made', () => {
    const result = toNewsArticleValues(form({ title: '???' }), { frozenSlug: 'fast-adresse' })

    expect(result.ok).toBe(true)
  })
})

describe('toNewsArticleValues — every refusal, attached to its field', () => {
  it.each([
    ['overskrift:mangler', form({ title: '   ' })],
    ['overskrift:for_lang', form({ title: 'x'.repeat(201) })],
    ['overskrift:uden_adresse', form({ title: '???' })],
    ['dato:ugyldig', form({ displayDate: 'i morgen' })],
    ['dato:ugyldig', form({ displayDate: '2026-13-40' })],
    ['kategori:ukendt', form({ category: 'Sladder' })],
    ['tekst:mangler', form({ body: '   \n\n  ' })],
  ] as const)('refuses with %s', (code, values) => {
    const result = toNewsArticleValues(values, { frozenSlug: null })

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors).toContain(code)
  })

  it('reports every problem at once, not one per attempt', () => {
    const result = toNewsArticleValues(
      { title: '', displayDate: 'nix', category: 'Sladder', body: '' },
      { frozenSlug: null },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors).toEqual(
      expect.arrayContaining(['overskrift:mangler', 'dato:ugyldig', 'kategori:ukendt', 'tekst:mangler']),
    )
  })

  it('binds each code to a field and each field to a Danish sentence', () => {
    for (const [code, message] of Object.entries(NEWS_ERROR_MESSAGES)) {
      expect(['overskrift', 'dato', 'kategori', 'tekst']).toContain(
        errorField(code as keyof typeof NEWS_ERROR_MESSAGES),
      )
      expect(message.length).toBeGreaterThan(0)
    }
  })
})

describe('the refusal round trip', () => {
  it('echoes exactly what was typed and re-reads it with the same parser', () => {
    const typed = form({ title: 'Overskrift <med> "tegn" & æøå', body: 'Linje 1\n\nLinje 2' })
    const echo = encodeNewsFormEcho(typed, ['dato:ugyldig'])

    expect(readNewsForm(echo)).toEqual(typed)
    expect(decodeNewsErrors(echo.getAll('fejl'))).toEqual(['dato:ugyldig'])
  })

  it('drops codes this application never defined', () => {
    expect(decodeNewsErrors(['dato:ugyldig', 'evil:injection', ''])).toEqual(['dato:ugyldig'])
  })
})

describe('the form’s two starting points', () => {
  it('starts a new article with today’s date and nothing else', () => {
    expect(emptyNewsForm('2026-09-01')).toEqual({
      title: '',
      displayDate: '2026-09-01',
      category: '',
      body: '',
    })
  })

  it('shows a stored article through the shared body projection', () => {
    const article: AdminNewsArticle = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Overskrift placeholder — ny burger',
      slug: 'overskrift-placeholder-ny-burger',
      status: 'published',
      publishedAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T08:00:00.000Z',
      category: 'Ny burger',
      displayDate: '2026-08-20',
      body: {
        blocks: [
          { type: 'paragraph', spans: [{ text: 'Første afsnit.' }] },
          { type: 'paragraph', spans: [{ text: 'Andet afsnit.' }] },
        ],
      },
    }

    expect(newsFormValues(article)).toEqual({
      title: 'Overskrift placeholder — ny burger',
      displayDate: '2026-08-20',
      category: 'Ny burger',
      body: 'Første afsnit.\n\nAndet afsnit.',
    })
  })
})
