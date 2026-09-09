import { assetPath } from '@/lib/config/site'

/**
 * The competition's own seal — "Fyns bedste burger 2026" — as the restaurant supplied
 * it (`launch-assets/award.png`, tracked unaltered as `public/brand/award.png`).
 *
 * A brand asset in the same sense as the logo (`SiteLogo`), and placed the same way: a
 * plain `<img>` from `public/brand/`, not a library photograph, so it does not go
 * through the derivative ladder or `SiteImage`. The path goes through `assetPath` for
 * the same reason the logo's does — a plain `<img src>` is not rewritten for a
 * `basePath` deployment.
 *
 * Decorative on purpose: the seal's own words are the facts the text beside it already
 * states ("Fyns bedste burger 2026", "Vinder af Fyn & Øer", "nr. 4 i Danmark"), and a
 * screen reader hearing them twice helps nobody.
 */
export function AwardMark({ className = '' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not a library photograph; SiteImage is for the image library only.
    <img
      src={assetPath('/brand/award.png')}
      alt=""
      aria-hidden="true"
      width={1254}
      height={1254}
      className={`shrink-0 ${className}`}
    />
  )
}
