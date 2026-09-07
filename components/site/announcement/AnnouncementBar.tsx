import type { AnnouncementLink } from '@/lib/announcements/link'

import { PageContainer } from '../PageContainer'

/**
 * The bar itself — design 1ac, and the "SÅDAN SER DEN UD" panel of 1ad.
 *
 * A Server Component that takes two values and renders them. It reads nothing, decides
 * nothing about time and holds no state — the whole bar is `content/site/announcement.json`
 * plus this markup, so what a reviewer sees in the diff is what a guest gets.
 *
 * WHAT 1ac ASKS FOR, LINE BY LINE
 *
 *   * *"Tonet burgundy, aldrig fuld burgundy"* — `announce-surface` (#F7EEEA) with an
 *     `announce-border` hairline beneath it. Both tokens were declared from 1aa in phase
 *     3 under the name "BESKEDBJÆLKE"; this phase adds no colour.
 *   * *"Den ligger i sidens flow — ikke som pop-up, ikke som overlay — og skubber
 *     indholdet ned"* — an ordinary block at the top of the layout. No `position`, no
 *     backdrop, no portal, no dismiss control, no animation.
 *   * *"Beskeden ombrydes frit — den bliver aldrig klippet af med '…'"* — no truncation,
 *     no line clamp, no fixed height. The bar grows with the message.
 *   * *"Link er valgfrit. Uden link er hele bjælken ren tekst — ingen tom knap, ingen
 *     pil"* — the anchor and the chevron are rendered only when there is a link.
 *   * *"Hele rækken er ét tryk, når der er et link"* — on a phone the anchor's hit area
 *     is stretched across the row by a pseudo-element. From `md` the frame draws the
 *     link as a phrase after the message, so the stretch is switched off there.
 *
 * ONE MEASURED DEPARTURE FROM THE FRAME, AND WHY
 *
 * 1ac labels the desktop bar "41 PX HØJ". 1aa's own accessibility list says "Tryk-mål
 * mindst 44 × 44 px" and states no exception, so the **link** carries `min-h-tap`. This
 * is the same reading recorded for the 40 px controls elsewhere: where
 * the two frames disagree, the accessibility promise is the one that ships.
 *
 * The cost of that promise is **four pixels, and only four**. From `md` a linked row
 * carries no vertical padding of its own, so the 44 px target *is* the bar's height —
 * 45 px with the hairline, against the frame's 41. An **unlinked** bar has no target in
 * it, keeps `md:py-2.5` and measures the frame's height exactly. The phase-7 lock pass
 * measured the linked bar at 61 px, because the row was padding a control that was
 * already 44 px tall: the promise was being kept twice over, and the frame's proportion —
 * *"bjælken skal læses efter logoet og udmærkelsen, ikke før"* — was paying for it.
 */
export function AnnouncementBar({
  message,
  link,
}: {
  message: string
  /** `null` renders no anchor at all — 1ac: "ingen tom knap, ingen pil". */
  link: AnnouncementLink | null
}) {
  return (
    <div className="bg-announce-surface border-announce-border border-b">
      <PageContainer>
        <div
          className={`relative flex items-center gap-2.5 py-2 md:justify-center md:gap-3.5 ${
            // The phone keeps its padding: there the whole row is the target and the
            // message wraps above the link, so the row is never only as tall as a control.
            link === null ? 'md:py-2.5' : 'md:py-0'
          }`}
        >
          {/* 1ac's 8 px burgundy dot. Decoration: the sentence carries the meaning. */}
          <span
            aria-hidden="true"
            className="bg-brand-700 mt-[0.5rem] size-2 shrink-0 self-start rounded-full md:mt-0 md:self-auto"
          />

          {/*
            `md:flex-initial` rather than `md:flex-none`: from `md` the row is centred, and
            a flex item that cannot shrink would push a 90-character message past the
            gutter instead of wrapping it. `min-w-0` is the other half of the same rule —
            without it the paragraph's own minimum content width would win.
          */}
          <div className="flex min-w-0 flex-1 flex-col md:flex-initial md:flex-row md:items-center md:gap-3.5">
            <p className="text-brand-700 text-nav font-medium text-pretty">{message}</p>

            {/*
              `rel="noopener noreferrer"` on an external address is §8's own half of the
              open-redirect rule, and it is added here rather than by the caller so it
              cannot be forgotten. There is deliberately **no** `target="_blank"`: the
              design does not ask for one, a new tab needs an "åbner i nyt vindue"
              announcement to be accessible, and `noreferrer` keeps the visitor's page
              out of the Referer header either way — which is the half that matters on a
              site that sends a guest nothing else (§12).
            */}
            {link === null ? null : (
              <a
                className="text-brand-700 hover:text-brand-500 min-h-tap inline-flex w-fit items-center font-semibold underline underline-offset-[3px] after:absolute after:inset-0 after:content-[''] md:after:content-none"
                href={link.href}
                {...(link.external ? { rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </a>
            )}
          </div>

          {/* 1ac's mobile chevron. Decorative, and present only where the whole row is
              the target — from `md` the underlined phrase is the affordance. */}
          {link === null ? null : (
            <span aria-hidden="true" className="text-brand-500 shrink-0 text-xl md:hidden">
              ›
            </span>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
