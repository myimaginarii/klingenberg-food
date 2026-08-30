import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AnnouncementBar } from '@/components/site/announcement/AnnouncementBar'
import { resolveAnnouncementLink } from '@/lib/announcements/link'

/**
 * The public announcement bar, rendered — design 1ac.
 *
 * The *decision* to show a bar lives in `lib/announcements/lifecycle.ts` and
 * `lib/content/announcement.ts` and is tested there; what is asserted here is the markup
 * that decision produces, and specifically the four things 1ac promises about it in
 * words:
 *
 *   * an announcement with no link is **plain text** — "ingen tom knap, ingen pil";
 *   * an external address carries `rel="noopener noreferrer"` (§8);
 *   * the message is never truncated;
 *   * there is no dismiss control of any kind, because a guest cannot close this bar.
 *
 * Rendered with `react-dom/server`, which the project already depends on. No test
 * renderer, no DOM environment and no new dependency.
 */

const MESSAGE = 'Ændrede åbningstider søndag · 17:00–19:00'

function render(link: Parameters<typeof AnnouncementBar>[0]['link']): string {
  return renderToStaticMarkup(<AnnouncementBar link={link} message={MESSAGE} />)
}

describe('the announcement bar', () => {
  it('prints the message', () => {
    expect(render(null)).toContain('Ændrede åbningstider søndag')
  })

  it('renders no anchor at all when there is no link', () => {
    const markup = render(null)

    expect(markup).not.toContain('<a ')
    // 1ac: "Uden link er hele bjælken ren tekst — ingen tom knap, ingen pil."
    expect(markup).not.toContain('›')
  })

  it('renders an internal link as an ordinary relative href', () => {
    const markup = render(
      resolveAnnouncementLink({
        link_type: 'page',
        link_page: '/find-os',
        link_url: null,
        link_label: 'Se tider',
      }),
    )

    expect(markup).toContain('href="/find-os"')
    expect(markup).toContain('Se tider')
    // No `rel` on our own page: `noreferrer` on an internal navigation would only strip
    // information from our own server.
    expect(markup).not.toContain('rel=')
  })

  it('renders an external link with rel="noopener noreferrer" and no target', () => {
    const markup = render(
      resolveAnnouncementLink({
        link_type: 'url',
        link_page: null,
        link_url: 'https://example.test/arrangement',
        link_label: 'Læs mere',
      }),
    )

    expect(markup).toContain('href="https://example.test/arrangement"')
    expect(markup).toContain('rel="noopener noreferrer"')
    // §8 asks for the `rel`, not for a new tab — and a new tab would need its own
    // "åbner i nyt vindue" announcement to be accessible.
    expect(markup).not.toContain('target=')
  })

  it('gives the link a 44 px target', () => {
    const markup = render(
      resolveAnnouncementLink({
        link_type: 'page',
        link_page: '/menu',
        link_url: null,
        link_label: 'Se menuen',
      }),
    )

    // 1aa: "Tryk-mål mindst 44 × 44 px", which 1ac's 41 px desktop bar does not reach on
    // its own. The measured assertion is in the browser suite; this is the class that
    // makes it true.
    expect(markup).toContain('min-h-tap')
  })

  it('never truncates the message', () => {
    // 1ac: "Beskeden ombrydes frit — den bliver aldrig klippet af med '…'".
    for (const markup of [render(null), render({ href: '/menu', label: 'Se menuen', external: false })]) {
      expect(markup).not.toMatch(/line-clamp|truncate|text-ellipsis|overflow-hidden/)
    }
  })

  it('offers a guest no way to dismiss it', () => {
    // 1ac and 1ad: one message, no archive, no per-visitor state — and therefore no X.
    for (const markup of [render(null), render({ href: '/menu', label: 'Se menuen', external: false })]) {
      expect(markup).not.toContain('<button')
      expect(markup).not.toMatch(/Luk|Skjul|Afvis/)
    }
  })

  it('is not a popup or an overlay', () => {
    // 1ac: "Den ligger i sidens flow — ikke som pop-up, ikke som overlay — og skubber
    // indholdet ned i stedet for at dække det."
    const markup = render(null)

    expect(markup).not.toMatch(/\bfixed\b|\bsticky\b|\bz-\d|position:\s*(fixed|absolute)/)
    expect(markup).not.toContain('role="dialog"')
  })
})
