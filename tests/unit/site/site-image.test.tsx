import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SiteImage } from '@/components/site/SiteImage'
import { buildPublicImage, IMAGE_SIZES } from '@/lib/images/public'

/**
 * The one public image renderer — phase 10C-2 (brief §5, §6, §8, §28, §38).
 *
 * Server HTML, asserted as markup: a `<picture>` with an AVIF source and a WebP
 * `<img>` over the processed ladder, `sizes` from the slot, intrinsic dimensions,
 * the authored alt (or `alt=""`), lazy by default — and the reserved placeholder
 * when there is no image. Nothing here needs a browser, so nothing here needs
 * JavaScript.
 */

const ORIGIN = 'http://localhost:54321'
const UPLOAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const PUBLIC = `${ORIGIN}/storage/v1/object/public/media/${UPLOAD}`

function image(altText: string | null) {
  return buildPublicImage(ORIGIN, {
    storage_path: `${UPLOAD}/original.jpg`,
    alt_text: altText,
    derivatives: {
      formats: ['avif', 'webp'],
      widths: [
        { width: 480, height: 360 },
        { width: 960, height: 720 },
      ],
    },
  })!
}

function render(props: Partial<Parameters<typeof SiteImage>[0]> = {}): string {
  return renderToStaticMarkup(
    <SiteImage
      image={image('Burgeren fra siden.')}
      ratio="card"
      sizes="dishCard"
      placeholder={{ label: 'Retfoto' }}
      className="w-24 rounded-[0.5rem]"
      {...props}
    />,
  )
}

describe('SiteImage with an image', () => {
  it('renders a <picture> with an AVIF source and a WebP <img>, both over the ladder', () => {
    const html = render()

    expect(html).toMatch(/^<picture class="block overflow-hidden aspect-card w-24 rounded-\[0\.5rem\]">/)
    expect(html).toContain(
      `<source type="image/avif" srcSet="${PUBLIC}/480.avif 480w, ${PUBLIC}/960.avif 960w" sizes="${IMAGE_SIZES.dishCard}"/>`,
    )
    expect(html).toContain(`srcSet="${PUBLIC}/480.webp 480w, ${PUBLIC}/960.webp 960w"`)
    expect(html).toContain(`src="${PUBLIC}/960.webp"`)
    expect(html).toContain(`sizes="${IMAGE_SIZES.dishCard}"`)
  })

  it('carries the intrinsic dimensions and fills its aspect box — no layout shift', () => {
    const html = render()

    expect(html).toContain('width="960"')
    expect(html).toContain('height="720"')
    expect(html).toContain('class="size-full object-cover"')
  })

  it('renders the authored alt, and alt="" when none is authored', () => {
    expect(render()).toContain('alt="Burgeren fra siden."')
    expect(render({ image: image(null) })).toContain('alt=""')
    expect(render({ image: image('   ') })).toContain('alt=""')
  })

  it('lazy-loads by default and eagerly only when asked', () => {
    expect(render()).toContain('loading="lazy"')
    expect(render({ loading: 'eager' })).toContain('loading="eager"')
  })

  it('never emits the private bucket, a storage path or JavaScript', () => {
    const html = render()

    expect(html).not.toContain('media-originals')
    expect(html).not.toContain('original.jpg')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })
})

describe('SiteImage without an image', () => {
  it('renders the reserved placeholder exactly as before, hidden from assistive technology', () => {
    const html = render({ image: null, placeholder: { label: 'Retfoto', detail: 'valgfrit' } })

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('media-placeholder')
    expect(html).toContain('aspect-card')
    expect(html).toContain('w-24 rounded-[0.5rem]')
    expect(html).toContain('Retfoto')
    expect(html).toContain('valgfrit')
    expect(html).not.toContain('<picture')
    expect(html).not.toContain('<img')
  })
})
