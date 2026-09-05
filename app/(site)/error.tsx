'use client'

import { ActionLink } from '@/components/site/ActionLink'
import { PageContainer } from '@/components/site/PageContainer'

/**
 * The public site's error state — technical plan §10g ("`error.tsx` and
 * `not-found.tsx` in both route groups, in the approved visual language"); phase 13's
 * lock pass (§0ak).
 *
 * The framework renders this in place of a public page whose server render threw
 * something nothing caught. Without it a guest reads the framework's own English
 * "Application error" page outside the site's header and footer; with it they read
 * one Danish sentence in the same composition as the 404 (`./not-found.tsx`) — the
 * site's type scale, its two button treatments, a way back — inside the site's own
 * shell, which the boundary does not replace.
 *
 * An error boundary must be a Client Component (the framework's rule), so this is one
 * of the public site's few — recorded as such in
 * `tests/unit/policy/public-javascript.test.ts`. It renders only after a page has
 * already failed, so the ordinary public site's budget is untouched, and it is
 * server-rendered like every Client Component, so a guest without JavaScript reads
 * the same sentence (the retry control then does nothing, and the links still work).
 *
 * It reports nothing and logs nothing: the server already reported the failure
 * through `onRequestError` (§0aj) before this rendered, and the browser is not
 * monitored (§12). The error's message is not shown — in production the framework
 * hands a generic one anyway (`error.digest` is what matches the server log).
 */
export default function SiteError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer className="py-12 md:py-20">
      <p className="font-mono text-label text-ink-3 uppercase">Noget gik galt</p>
      <h1 className="font-display mt-3 text-[2.25rem] tracking-[-0.03em] md:text-[3rem]">
        Siden kunne ikke vises
      </h1>
      <p className="text-ink-2 mt-3 max-w-[52ch]">
        Der opstod en fejl på vores side. Prøv igen om et øjeblik, eller gå til forsiden.
      </p>
      <div className="mt-6 flex flex-col gap-2.5 md:flex-row">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-button bg-brand-700 hover:bg-brand-500 active:bg-brand-900 duration-fast ease-standard inline-flex min-h-12 w-full items-center justify-center gap-2 px-6 text-center text-base font-semibold text-white transition-colors md:w-auto"
        >
          Prøv igen
        </button>
        <ActionLink href="/" variant="secondary" block className="md:w-auto">
          Til forsiden
        </ActionLink>
      </div>
    </PageContainer>
  )
}
