import Link from 'next/link'

import type { AnnouncementStateReport } from '@/lib/announcements/lifecycle'

/**
 * "Besked på hjemmesiden" — the card above the tiles, design 1x / 1q.
 *
 * Both frames draw it the same way: the title with the state pill beside it ("Vises nu"),
 * the message in quotation marks, the line *"Forsvinder af sig selv søndag 14.09.2026 kl.
 * 20:00"*, and "Rediger besked" — full width under the text on the phone, at the end of
 * the row from `md`.
 *
 * READ, NEVER WRITTEN, FROM THE PUBLISHED ROW
 *
 * Everything on the card is phase 7's own answer to "what is the hjemmeside showing?":
 * `describeAnnouncementState()` over the **live** values — the same function, with the
 * same four badges, the editor's own state banner uses — and the expiry worded by the
 * same formatter. A pending draft is not part of the picture, because a guest has not
 * seen it; the dashboard states what is true, not what is proposed. There is no second
 * editor here and no shortcut that writes: "Rediger besked" is the way to the one screen
 * that does (1ad, phase 7), where the temporary-only model, the required expiry, the
 * immediate "Vis besked" path and its Fortryd all live untouched.
 *
 * The pill's meaning is in its words; the dot and the tone are the frames' decoration
 * (1aa: status is never colour alone).
 */
export function AnnouncementCard({
  state,
  message,
  expiresAtLabel,
  href,
}: {
  state: AnnouncementStateReport
  /** The published message, or `null` when there is none. */
  message: string | null
  /** "søndag 14.09.2026 kl. 20:00", or `null`. */
  expiresAtLabel: string | null
  href: string
}) {
  const showing = state.tone === 'success'
  const headingId = 'besked-kort-titel'

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card shadow-admin-card border border-l-4 border-l-brand-700 p-3.5 md:rounded-card-lg md:px-5 md:py-4"
    >
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-4">
        <span
          aria-hidden="true"
          className="bg-brand-50 hidden size-10 shrink-0 items-center justify-center rounded-[10px] md:flex"
        >
          <span className="bg-brand-700 size-2.5 rounded-full" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2
              className="font-sans text-[0.96875rem] font-semibold md:text-[1.0625rem]"
              id={headingId}
            >
              Besked på hjemmesiden
            </h2>
            <span
              className={`rounded-badge inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[0.71875rem] leading-none font-semibold ${
                showing
                  ? 'border-success-border bg-success-surface text-success-ink'
                  : 'border-field-border bg-neutral-surface text-neutral-ink'
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-[7px] shrink-0 rounded-full ${showing ? 'bg-success' : 'bg-ink-3'}`}
              />
              {state.badge}
            </span>
          </div>

          {message === null ? (
            <p className="text-ink-2 mt-1 text-meta md:text-[0.96875rem]">{state.sentence}</p>
          ) : (
            <>
              <p className="text-neutral-ink mt-1 text-[0.90625rem] leading-[1.45] wrap-anywhere md:text-[0.96875rem]">
                “{message}”
              </p>
              <p className="text-ink-3 mt-0.5 text-meta tabular-nums">
                {showing && expiresAtLabel !== null
                  ? `Forsvinder af sig selv ${expiresAtLabel}`
                  : state.sentence}
              </p>
            </>
          )}
        </div>

        <Link
          className="rounded-button border-ink text-ink hover:bg-section flex min-h-[3rem] shrink-0 items-center justify-center border-[1.5px] px-5 font-semibold md:min-h-[2.875rem] md:rounded-field"
          href={href}
        >
          Rediger besked
        </Link>
      </div>
    </section>
  )
}
