import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AdminSectionBar } from '@/components/admin/menu/AdminSectionBar'
import { NewsAdminList } from '@/components/admin/news/NewsAdminList'
import { NewsConfirmDialog } from '@/components/admin/news/NewsConfirmDialog'
import { NewsBody } from '@/components/site/news/NewsBody'

/**
 * The news administration on a phone — phase 12B, design 1z.
 *
 * Server HTML, asserted as markup: the four presentation rules 12B added are each
 * one class decision, and each one was a measured defect at 375 px before it was
 * made. They are pinned here so a later tidy-up cannot quietly undo them; the
 * behaviour they produce (the pinned bar in the viewport while typing, the stacked
 * confirmation, the wrapped title) is measured in `tests/e2e/news-mobile.spec.ts`.
 */

const dialogProps = {
  action: async () => {},
  anchorId: 'slet-bekraeft',
  articleId: 'a',
  articleTitle: 'Nyheden',
  cancelHref: '/admin/nyheder?nyhed=a#slet-nyhed',
  cancelLabel: 'Behold nyheden',
  fieldNames: { articleId: 'nyhed', version: 'version' },
  prompt: { question: 'Slet “Nyheden”?', consequence: 'Kan ikke fortrydes.', confirmLabel: 'Slet nyhed' },
  version: '2026-09-04T10:00:00.000Z',
}

describe('AdminSectionBar pinned — the phone bar the editor keeps in view', () => {
  it('sticks below md, with its hook class, and dissolves the children group there', () => {
    const html = renderToStaticMarkup(
      <AdminSectionBar backHref="/admin/nyheder" backLabel="Nyheder" pinned title="Rediger nyhed">
        <span>Kladde</span>
      </AdminSectionBar>,
    )

    expect(html).toContain('admin-bar-pinned')
    expect(html).toContain('max-md:sticky')
    expect(html).toContain('max-md:top-0')
    expect(html).toContain('max-md:contents')
    // It carries the height publisher — an empty hidden marker in server HTML;
    // the measurement itself is a client effect (`PinnedBarHeight`).
    expect(html).toContain('<span hidden=""></span>')
    // …and no height of its own in the markup: the bar's height is measured, never
    // predicted — a multi-line conflict is allowed to make it taller.
    expect(html).not.toMatch(/max-md:(h|max-h)-/)
  })

  it('is exactly the block it was when not pinned', () => {
    const html = renderToStaticMarkup(
      <AdminSectionBar backHref="/admin" title="Nyheder">
        <span>+ Ny</span>
      </AdminSectionBar>,
    )

    expect(html).not.toContain('sticky')
    expect(html).not.toContain('admin-bar-pinned')
    expect(html).not.toContain('contents')
    expect(html).not.toContain('<span hidden')
  })
})

describe('the toolbar and the scroll padding follow the bar’s measured height', () => {
  // The toolbar exists only once scripting runs, so its class is pinned at the
  // source rather than in server HTML; the CSS rule likewise.
  it('sticks the news toolbar at --admin-bar-height, with the two ordinary rows as the fallback', async () => {
    const { readFile } = await import('node:fs/promises')
    const field = await readFile(new URL('../../../components/admin/news/NewsBodyField.tsx', import.meta.url), 'utf8')
    expect(field).toContain('max-md:top-[var(--admin-bar-height,6.25rem)]')
    expect(field).not.toContain('max-md:top-[6.25rem]')

    const css = await readFile(new URL('../../../app/globals.css', import.meta.url), 'utf8')
    expect(css).toContain('scroll-padding-top: calc(var(--admin-bar-height, 6.25rem) + 0.75rem)')
  })
})

describe('NewsAdminList — a long title wraps inside the card', () => {
  it('never truncates the title, and lets an unbroken word break', () => {
    const html = renderToStaticMarkup(
      <NewsAdminList
        createHref="/admin/nyheder?ny=1"
        rows={[
          {
            id: 'a',
            title: 'x'.repeat(200),
            href: '/admin/nyheder?nyhed=a',
            state: { pill: 'Kladde', line: 'Rettet 04.09.2026', tone: 'draft' },
          },
        ]}
      />,
    )

    expect(html).toContain('wrap-anywhere')
    expect(html).not.toContain('truncate')
    // The state is still in words beside it.
    expect(html).toContain('Kladde')
  })
})

describe('NewsConfirmDialog — the phone stacks the safe choice first', () => {
  it('lays the footer out as a column below md and a row from md, safe control first', () => {
    const html = renderToStaticMarkup(<NewsConfirmDialog {...dialogProps} destructive />)

    expect(html).toContain('flex flex-col gap-3 md:flex-row')
    // The question quotes the title, which may be one unbroken word.
    expect(html).toMatch(/<h2[^>]*wrap-anywhere/)
    expect(html).toContain('md:justify-end')
    // The safe way out precedes the committing control in the DOM at every width.
    expect(html.indexOf('Behold nyheden')).toBeLessThan(html.indexOf('Slet nyhed'))
    // Both controls are full width in the column: they centre their words.
    expect(html.match(/justify-center/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('NewsBody — the public paragraph never scrolls the phone sideways', () => {
  it('lets a run without a break opportunity wrap', () => {
    const html = renderToStaticMarkup(
      <NewsBody body={{ blocks: [{ type: 'paragraph', spans: [{ text: 'y'.repeat(150) }] }] }} />,
    )

    expect(html).toContain('wrap-anywhere')
  })
})
