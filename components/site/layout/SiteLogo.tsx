/**
 * The masthead — design 1g, 1l, 1n and the footer.
 *
 * The mark is the restaurant's real logo (phase 14B2, `public/brand/logo.svg` — the
 * supplied handmade K, unaltered: no redraw, no smoothing, no reinterpretation). It is
 * already a self-contained circular badge — a dark red K inside a dark red circular
 * border with an opaque white interior and a transparent exterior — so it is placed
 * directly at each caller's size with no wrapping border or fill of our own. The name
 * beside it is real text either way, which is what a search engine, a screen reader and
 * a copy-paste actually need; the mark itself is decorative (`alt=""`) for exactly that
 * reason.
 */
export function SiteLogo({
  size = 'default',
  tone = 'default',
  showVenue = true,
}: {
  size?: 'default' | 'compact'
  /** `inverse` is the fullscreen mobile menu and the footer, both on burgundy (1n, 1g). */
  tone?: 'default' | 'inverse'
  showVenue?: boolean
}) {
  const compact = size === 'compact'
  const inverse = tone === 'inverse'

  return (
    <span className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not a library photograph; SiteImage is for the image library only. */}
      <img
        src="/brand/logo.svg"
        alt=""
        aria-hidden="true"
        width={1254}
        height={1254}
        className={`shrink-0 ${compact ? 'size-10' : 'size-10 md:size-13'}`}
      />
      <span className="flex flex-col leading-tight">
        <span
          className={`font-display font-bold ${inverse ? 'text-white' : 'text-brand-700'} ${
            compact ? 'text-[0.9375rem]' : 'text-[0.9375rem] md:text-[1.1875rem]'
          }`}
        >
          Klingenberg Food
        </span>
        {showVenue ? (
          <span
            className={`text-micro ${inverse ? 'text-white/70' : 'text-ink-3'}`}
          >
            Carl Nielsen Hallen
          </span>
        ) : null}
      </span>
    </span>
  )
}
