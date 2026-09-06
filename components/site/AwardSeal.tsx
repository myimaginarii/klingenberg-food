/**
 * The site's own award mark — design 1g and 1i.
 *
 * A ring of type in the site's own visual language. It is **not** the competition's
 * official seal, which we have no permission to reproduce; the approved design draws
 * this instead, and this is what is built.
 *
 * Hidden from assistive technology on purpose: the same three facts are written out as
 * real text in the band beside it, and hearing them twice helps nobody.
 *
 * THE LABEL SIZE FOLLOWS THE DIAMETER. "DANMARKS BEDSTE" is the widest line and it sits
 * low in the circle, where the chord is much narrower than the diameter — roughly 91 px
 * inside the compact 104 px ring against 115 px inside the default 132 px one. So the two
 * sizes carry different type: the larger ring can take the 10 px the rest of the site
 * reads at, the compact one cannot, and forcing it to would push the line out through
 * the ring on both sides. Everything else about the mark is identical.
 */
export function AwardSeal({ size = 'default' }: { size?: 'default' | 'compact' }) {
  const compact = size === 'compact'
  const label = compact
    ? 'font-mono text-[0.53125rem] leading-tight text-white/80'
    : 'font-mono text-[0.625rem] leading-tight text-white/80'

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-white/55 text-center ${
        compact ? 'size-26' : 'size-33'
      }`}
    >
      <span className={`${label} ${compact ? 'tracking-[0.13em]' : 'tracking-[0.11em]'}`}>
        VINDER AF
      </span>
      <span
        className={`font-display font-bold leading-none text-white ${compact ? 'text-xl' : 'text-[1.625rem]'}`}
      >
        FYN &amp; ØER
      </span>
      <span aria-hidden="true" className="my-1 h-px w-7 bg-white/40" />
      <span className={`${label} ${compact ? 'tracking-[0.08em]' : 'tracking-[0.06em]'}`}>
        DANMARKS BEDSTE
        <br />
        BURGER 2026
      </span>
    </div>
  )
}
