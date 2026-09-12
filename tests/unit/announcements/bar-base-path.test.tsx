import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { AnnouncementBar } from '@/components/site/announcement/AnnouncementBar'
import { resolveAnnouncementLink } from '@/lib/announcements/link'

/**
 * The announcement bar on a site served under a sub-path — the GitHub Pages
 * project-site fallback the README documents, where every page lives under
 * `/klingenberg-food/`.
 *
 * `next.config.ts` derives `basePath` from `SITE_URL`, and the framework prefixes every
 * `next/link` href with it. A raw `<a href>` gets no such prefix: an announcement
 * pointing at `/find-os` on a site served under `/klingenberg-food/` would send the guest
 * to the host's root, where there is no page. The bar once rendered exactly that anchor,
 * and this suite is what stops it coming back.
 *
 * HOW THE PREFIX REACHES THE TEST. The build inlines `basePath` as
 * `process.env.__NEXT_ROUTER_BASEPATH`, and `next/dist/client/add-base-path` reads that
 * variable **once, when the module loads**. So the stub is hoisted above the imports,
 * and this suite is a file of its own rather than a case in `bar.test.tsx`: that suite
 * keeps asserting the root-path site, and the two never share a module registry.
 *
 * Two behaviours, asserted separately as the fix demands:
 *
 *   * an **internal** destination is prefixed — the real bug;
 *   * an **external** address is left exactly as written, still with its `rel` and still
 *     without a `target` — a `next/link` around it would have been the wrong fix.
 */

const BASE_PATH = vi.hoisted(() => {
  const basePath = '/klingenberg-food'
  vi.stubEnv('__NEXT_ROUTER_BASEPATH', basePath)
  return basePath
})

afterAll(() => {
  vi.unstubAllEnvs()
})

const MESSAGE = 'Ændrede åbningstider søndag · 17:00–19:00'

function render(link: Parameters<typeof AnnouncementBar>[0]['link']): string {
  return renderToStaticMarkup(<AnnouncementBar link={link} message={MESSAGE} />)
}

/** The `class` attribute of the one anchor in a rendering, or `null` when there is none. */
function anchorClass(markup: string): string | null {
  return markup.match(/<a [^>]*class="([^"]*)"/)?.[1] ?? null
}

const INTERNAL = resolveAnnouncementLink({
  link_type: 'page',
  link_page: '/find-os',
  link_url: null,
  link_label: 'Se tider',
})

const EXTERNAL = resolveAnnouncementLink({
  link_type: 'url',
  link_page: null,
  link_url: 'https://example.test/arrangement',
  link_label: 'Læs mere',
})

describe('the announcement bar under a base path', () => {
  it('prefixes an internal destination with the base path', () => {
    const markup = render(INTERNAL)

    // `trailingSlash` is a build-time setting this environment does not carry, so the
    // href is asserted up to the slash the deployment may add.
    expect(markup).toContain(`href="${BASE_PATH}/find-os`)
    expect(markup).not.toContain('href="/find-os"')
    expect(markup).toContain('Se tider')
    // Still our own page: no `rel` on an internal navigation.
    expect(markup).not.toContain('rel=')
  })

  it('leaves an external address exactly as written', () => {
    const markup = render(EXTERNAL)

    expect(markup).toContain('href="https://example.test/arrangement"')
    expect(markup).not.toContain(BASE_PATH)
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).not.toContain('target=')
  })

  it('draws both kinds of link with the same classes', () => {
    // One treatment, whichever element carries it: the 44 px target and the phone's
    // stretched hit area (design 1ac) belong to the link, not to the branch it took.
    const internal = anchorClass(render(INTERNAL))
    const external = anchorClass(render(EXTERNAL))

    expect(internal).not.toBeNull()
    expect(internal).toBe(external)
    expect(internal).toContain('min-h-tap')
    expect(internal).toContain('after:absolute')
  })
})
