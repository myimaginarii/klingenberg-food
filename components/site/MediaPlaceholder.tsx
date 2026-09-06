/**
 * A reserved image frame for photography the restaurant has not supplied yet —
 * design 1aa ("Billedcontainere — faste forhold") and the `.ph` treatment used
 * throughout the approved frames.
 *
 * Two things matter here and both are deliberate.
 *
 * **The space is reserved by aspect ratio, never by a fixed height.** "Pladsen
 * reserveres altid med aspect-ratio, så siden ikke hopper, når billedet loader" (1aa).
 * When the real photograph arrives in phase 14 it drops into the same box and nothing
 * on the page moves.
 *
 * **It is hidden from assistive technology.** The hatching and its caption are a
 * development marker addressed to us, not information a guest needs; announcing "hero
 * photo, 3:2, awaiting the restaurant" to a screen-reader user would be noise. No
 * content is lost — every placeholder sits beside real text.
 *
 * 1ab lists the outstanding photography. Nothing here fetches a third-party image and
 * no stock photograph is substituted.
 *
 * Since phase 10C-2 the entity slots (dish, Ugens ret, Månedens burger, news) render a
 * real library photograph through `SiteImage` when one is selected, and this frame
 * when none is — or when a stored record cannot be rendered safely. The page documents'
 * frames followed: the Forside's three (11A), Mad ud af huset's one (11B) and Om os's
 * three (14B1). Every public frame now goes through `SiteImage`; this component is the
 * no-image half of it.
 */

export type MediaRatio = 'hero' | 'card' | 'square' | 'portrait' | 'team'

/** The aspect-ratio box per frame (1aa) — shared with `SiteImage`, which fills the same box. */
export const RATIO_CLASSES: Record<MediaRatio, string> = {
  hero: 'aspect-hero',
  card: 'aspect-card',
  square: 'aspect-square',
  portrait: 'aspect-portrait',
  team: 'aspect-team',
}

const TONE_CLASSES = {
  default: 'border-border text-ink-3',
  /** On the burgundy band the hatching is drawn in white instead (1g, 1i, 1l). */
  inverse: 'border-white/25 text-white/75',
} as const

export function MediaPlaceholder({
  ratio,
  label,
  detail,
  tone = 'default',
  className = '',
}: {
  ratio: MediaRatio
  /** The short caption the design prints in the frame: "HERO-FOTO", "RETFOTO 4:3". */
  label: string
  /** The second line, where the design gives one: "3:2 · 1200 × 800 · afventer". */
  detail?: string
  tone?: keyof typeof TONE_CLASSES
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={`media-placeholder flex flex-col items-center justify-center gap-1 border p-3 text-center ${RATIO_CLASSES[ratio]} ${TONE_CLASSES[tone]} ${className}`}
    >
      <span className="font-mono text-eyebrow uppercase">{label}</span>
      {detail ? <span className="font-mono text-chip leading-relaxed">{detail}</span> : null}
    </div>
  )
}
