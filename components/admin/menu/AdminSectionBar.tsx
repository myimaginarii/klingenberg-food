import Link from 'next/link'

/**
 * The burgundy bar across the top of a section screen — design 1r (desktop) and 1y
 * (mobile).
 *
 * Both frames draw the same three things on `brand-900`: a way back, the screen's
 * name, and the screen's own actions. They differ only in what fits — desktop shows
 * "Forhåndsvis" and "Offentliggør ændringer" side by side, the phone shows the short
 * "Offentliggør" — so the bar is one component and the *labels* adapt, rather than two
 * bars adapting.
 *
 * It is a `<header>` with the screen's `<h1>` inside it, so the page has exactly one
 * top-level heading and it is the one a person reads first.
 */
export function AdminSectionBar({
  title,
  backHref,
  backLabel = 'Tilbage',
  children,
}: {
  title: string
  backHref: string
  backLabel?: string
  children?: React.ReactNode
}) {
  return (
    <header className="bg-brand-900 text-white">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-3 px-gutter py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <Link
            className="min-h-tap -mx-2 inline-flex items-center px-2 text-nav font-medium text-white/85 hover:text-white"
            href={backHref}
          >
            <span aria-hidden="true">‹ </span>
            {backLabel}
          </Link>
          <h1 className="font-sans truncate text-[1.125rem] font-semibold text-white">{title}</h1>
        </div>

        {children === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{children}</div>
        )}
      </div>
    </header>
  )
}

/**
 * "Forhåndsvis" — outlined on the burgundy bar (1r).
 *
 * 44 px tall, not the 40 the frame draws. 1aa's own accessibility list says "Tryk-mål
 * mindst 44 × 44 px" and states no exception for the bar — and this bar is the one on a
 * phone where a mis-tap costs the most, because Offentliggør is the control beside it.
 */
export function BarLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="rounded-field min-h-tap inline-flex items-center border border-white/50 px-4 text-meta font-medium text-white hover:border-white"
      href={href}
    >
      {children}
    </a>
  )
}

/**
 * "Offentliggør ændringer" — the one filled control on the bar (1r). 44 px, per 1aa.
 *
 * `id` is optional and exists for one reason: a screen whose publish opens a
 * confirmation has to be able to send focus **back to this button** when the
 * confirmation is dismissed, and it does that through the address (`#…`) rather than
 * through a script — see `ModalDialog`. A bar without such a dialog passes nothing and
 * renders exactly as before.
 */
export function BarSubmit({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <button
      className="rounded-field text-brand-700 min-h-tap inline-flex items-center bg-white px-4 text-meta font-semibold hover:bg-brand-50"
      id={id}
      type="submit"
    >
      {children}
    </button>
  )
}
