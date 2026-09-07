import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Work_Sans } from 'next/font/google'

import { getSiteUrlObject } from '@/lib/config/site'

import './globals.css'

/**
 * The three approved faces (design 1b / 1aa). next/font self-hosts them, so the public
 * site makes no request to a third-party font host — which is what keeps the "zero
 * cookies, no third-party script" property in technical plan §12 true.
 *
 * **Only the weights the design actually uses are downloaded**, and only the `latin`
 * subset. Phase 0 requested `latin-ext` "because it carries Æ Ø Å"; it does not — those
 * three live in Latin-1 Supplement, which the `latin` subset covers, along with the en
 * dash and the middot the design sets its ranges and lists with. Dropping the second
 * subset and the four unused weights (Bricolage 800, Work Sans 700 and its italics)
 * halves the font payload with no visible change: measured on the Forside, 261 KiB of
 * fonts across eleven files became 105 KiB across five.
 *
 * The weights that remain are exactly the type scale in 1b: Bricolage 600 (section
 * headings, prices) and 700 (display and page titles); Work Sans 400 (body), 500
 * (navigation and labels) and 600 (section headings, buttons); IBM Plex Mono 400 and
 * 500 (the spaced labels).
 */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-bricolage',
})

const workSans = Work_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-work-sans',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  // Absolute URLs resolve through lib/config/site.ts and nowhere else (§10d).
  metadataBase: getSiteUrlObject(),
  title: 'Klingenberg Food, Carl Nielsen Hallen',
  description: 'Klingenberg Food, Carl Nielsen Hallen.',
  // The site is not launched. Real photography, the final copy, the domain and the
  // whole of §11 — canonicals, sitemap, Open Graph, JSON-LD — are still ahead of us
  // (phases 13 and 14), so nothing here should be indexed yet. Per-route titles and
  // descriptions are set by each page through lib/seo/metadata.ts.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#fbf7f0', // --color-bg
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="da"
      className={`${bricolage.variable} ${workSans.variable} ${plexMono.variable}`}
      /*
        `app/globals.css` sets `scroll-behavior: smooth` on this element for the
        in-page anchors (1m's chips). Next 16 no longer switches that off by itself
        while it scrolls a *route transition* to the top of the new page; this
        attribute is its documented way of asking for exactly that (the framework's
        earlier default). Without it a route change scrolls to the top as an animation
        that is still running when the new page's own effects look at where things are.
        Hash-only changes keep their smooth scroll; nothing else changes.
      */
      data-scroll-behavior="smooth"
    >
      <body>{children}</body>
    </html>
  )
}
