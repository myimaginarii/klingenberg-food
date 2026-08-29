/**
 * The masthead — design 1g, 1l, 1n and the footer.
 *
 * The restaurant's logo file has not been supplied in a usable format yet (1ab lists
 * "Logofil i vektor (SVG/AI)" and the favicon crop as outstanding), so the circular mark
 * renders as the design's own placeholder hatching. The name is real text either way,
 * which is what a search engine, a screen reader and a copy-paste actually need.
 *
 * Swapping in the real mark is a change to this one component.
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
      <span
        aria-hidden="true"
        className={`media-placeholder border-border shrink-0 rounded-full border ${
          compact ? 'size-10' : 'size-10 md:size-13'
        }`}
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
