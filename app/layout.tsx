import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, IBM_Plex_Mono, Work_Sans } from 'next/font/google'

import { getSiteUrlObject } from '@/lib/config/site'

import './globals.css'

/**
 * The three approved faces (design 1b / 1aa). next/font self-hosts them, so the
 * public site makes no request to a third-party font host — which is what keeps the
 * "zero cookies, no third-party script" property in technical plan §12 true.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'], // latin-ext carries Æ Ø Å
  weight: ['600', '700', '800'],
  display: 'swap',
  variable: '--font-bricolage',
})

const workSans = Work_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-work-sans',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  // Absolute URLs resolve through lib/config/site.ts and nowhere else (§10d).
  metadataBase: getSiteUrlObject(),
  title: 'Klingenberg Food',
  description: 'Klingenberg Food, Carl Nielsen Hallen.',
  // Phase 0 is a development foundation, not the public site. Nothing here is
  // ready to be indexed; per-route metadata arrives with the real pages.
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
    >
      <body>{children}</body>
    </html>
  )
}
