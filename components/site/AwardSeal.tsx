/**
 * The site's own award mark — design 1g and 1i.
 *
 * A ring of type in the site's own visual language. It is **not** the competition's
 * official seal, which we have no permission to reproduce; the approved design draws
 * this instead, and this is what is built.
 *
 * Hidden from assistive technology on purpose: the same three facts are written out as
 * real text in the band beside it, and hearing them twice helps nobody.
 */
export function AwardSeal({ size = 'default' }: { size?: 'default' | 'compact' }) {
  const compact = size === 'compact'

  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-white/55 text-center ${
        compact ? 'size-26' : 'size-33'
      }`}
    >
      <span className="font-mono text-[0.53125rem] leading-tight tracking-[0.13em] text-white/80">
        VINDER AF
      </span>
      <span
        className={`font-display font-bold leading-none text-white ${compact ? 'text-xl' : 'text-[1.625rem]'}`}
      >
        FYN &amp; ØER
      </span>
      <span aria-hidden="true" className="my-1 h-px w-7 bg-white/40" />
      <span className="font-mono text-[0.53125rem] leading-tight tracking-[0.08em] text-white/80">
        DANMARKS BEDSTE
        <br />
        BURGER 2026
      </span>
    </div>
  )
}
