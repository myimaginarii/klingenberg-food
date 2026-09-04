import Link from 'next/link'

import { ROLE_LABELS } from '@/lib/accounts/model'
import type { Role } from '@/lib/auth/session'

/**
 * The burgundy bar across the top of the dashboard — design 1x (phone) and 1q (desktop).
 *
 * 1q draws the wordmark ("Klingenberg Food" over "Administration"), *"Logget ind som Navn
 * · Ejer"*, "Se hjemmesiden" and "Log ud". 1x draws the logo, "Administration" and "Se
 * siden". One bar, one DOM order at every width — the wordmark, the account line, the
 * link, the button — and the phone simply wraps the account line onto a second row
 * (`max-md:basis-full max-md:order-last`), so the name is on screen at 375 px too rather
 * than dropped: who is signed in is the one fact a shared phone at the counter has to
 * show. The link's label is 1q's; "Se siden" was 1x's abbreviation of it.
 *
 * "Log ud" is a form posting to the sign-out action, as it has been since phase 1 — it is
 * a write, not a navigation — and the action is handed in as a prop, because a component
 * in `components/` importing from `app/` would be the dependency the wrong way round.
 *
 * The logo is the same reserved circle the public header draws (`SiteLogo`): the file
 * has not been supplied in a usable format yet (1ab), and a placeholder that looks like
 * the frame's white disc is honest about that.
 */
export function DashboardBar({
  name,
  role,
  signOut,
}: {
  name: string
  role: Role
  signOut: () => Promise<void>
}) {
  return (
    <header className="bg-brand-900 text-white">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-4 gap-y-1 px-gutter py-3 md:px-8 md:py-3.5">
        <p className="mr-auto flex min-w-0 items-center gap-2.5 md:gap-3">
          <span
            aria-hidden="true"
            className="media-placeholder size-8 shrink-0 rounded-full border border-white/30 md:size-[2.375rem]"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="hidden font-semibold md:block">Klingenberg Food</span>
            <span className="truncate font-semibold md:text-micro md:font-normal md:text-white/65">
              Administration
            </span>
          </span>
        </p>

        {/*
          One row on the phone is 1x's bar, and 343 px does not hold the wordmark, the
          account line and both controls: so below `md` the account line and "Log ud"
          share a second row (`order`), and "Logget ind som" is spoken but not drawn there.
          The DOM order is 1q's at every width — the wordmark, the account, the link, the
          button.
        */}
        <p className="text-meta min-w-0 truncate text-white/80 max-md:order-2 max-md:min-w-[14rem] max-md:flex-1 md:text-nav md:font-normal">
          <span className="max-md:sr-only">Logget ind som </span>
          <b className="font-medium text-white/90">{name}</b> · {ROLE_LABELS[role]}
        </p>

        <Link
          className="rounded-field min-h-tap inline-flex items-center border border-white/50 px-3 text-meta font-medium text-white hover:border-white hover:text-white max-md:order-1 md:px-4"
          href="/"
        >
          Se hjemmesiden
        </Link>

        <form action={signOut} className="max-md:order-3">
          <button
            className="rounded-field min-h-tap -mr-2 inline-flex items-center px-2 text-meta font-medium text-white/85 hover:text-white md:-mr-3 md:px-3"
            type="submit"
          >
            Log ud
          </button>
        </form>
      </div>
    </header>
  )
}
