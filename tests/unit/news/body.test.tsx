import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NewsBody } from '@/components/site/news/NewsBody'
import { newsArticleFrom, newsBodyFrom, type NewsFile } from '@/lib/content/load/news'
import { articleExcerpt } from '@/lib/news/excerpt'

/**
 * A news article's text, end to end — phase 4B.
 *
 * **What an editor writes is a list of paragraphs.** One string each, in the order
 * they are read; no blocks, no runs, no type selector, no bold switch, no link field,
 * no Markdown and no HTML. That is the whole of the format, and there is nothing about
 * it a person has to be taught.
 *
 * The three layers it passes through are asserted here together, because the value of
 * the format is precisely that they cannot disagree: the loader turns the list into
 * the block document the renderer walks, the renderer draws one paragraph per block,
 * and the excerpt on the news list and the Forside is the first paragraph. Nothing in
 * an article reaches the page as anything but text — the last case below writes markup
 * into a paragraph and finds it escaped on the page, which is what "no sanitizer to
 * get wrong" means when there is nothing to sanitise.
 */

const file = (body: string[]): NewsFile => ({
  title: 'Ny burger i oktober',
  published: true,
  publishedAt: '2026-10-01',
  body,
})

const html = (body: string[]) =>
  renderToStaticMarkup(<NewsBody body={newsBodyFrom(body)} />)

describe('a news article body', () => {
  it('is stored as one string per paragraph', () => {
    const article = newsArticleFrom('ny-burger-i-oktober', file(['Første afsnit.', 'Andet afsnit.']))

    expect(article?.body).toEqual({
      blocks: [
        { type: 'paragraph', text: 'Første afsnit.' },
        { type: 'paragraph', text: 'Andet afsnit.' },
      ],
    })
  })

  it('renders one paragraph per string, in order', () => {
    const markup = html(['Første afsnit.', 'Andet afsnit.'])

    expect(markup.match(/<p\b/g)).toHaveLength(2)
    expect(markup.indexOf('Første afsnit.')).toBeLessThan(markup.indexOf('Andet afsnit.'))
  })

  it('draws no link and no mark: an article carries neither', () => {
    const markup = html(['Ring på 63 90 83 00, så finder vi ud af det.'])

    expect(markup).not.toMatch(/<a\b/)
    expect(markup).not.toMatch(/<strong\b/)
  })

  it('escapes markup an editor happens to type — a paragraph is text, always', () => {
    const markup = html(['<script>alert(1)</script> og <a href="javascript:alert(1)">link</a>'])

    expect(markup).not.toMatch(/<script/)
    expect(markup).not.toMatch(/<a href/)
    expect(markup).toContain('&lt;script&gt;')
  })

  it('takes the teaser from the first paragraph, and has none without one', () => {
    const article = newsArticleFrom('a', file(['Første afsnit.', 'Andet afsnit.']))
    expect(articleExcerpt(article!)).toBe('Første afsnit.')

    const empty = newsArticleFrom('b', { ...file([]), published: true })
    expect(articleExcerpt(empty!)).toBeNull()
  })
})
