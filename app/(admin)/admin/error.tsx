'use client'

import Link from 'next/link'

import { AdminShell, Card, Notice } from './ui'

/**
 * The administration's error state — technical plan §10g ("`error.tsx` and
 * `not-found.tsx` in both route groups"; "admin errors surface as the designed
 * inline error state … never as a stack trace"); phase 13's lock pass (§0ak).
 *
 * Every refusal a person can act on is already an inline notice on its own screen
 * (a validation error, a stale version, `for_mange`, a forbidden action). What
 * reaches this boundary is the rest: a screen whose server render threw something
 * nothing caught. The framework has already logged it and reported it through
 * `onRequestError` (§0aj); this file only decides what the staff member reads —
 * the administration's own notice, in Danish, with a retry and a way back, instead
 * of the framework's English default. No message and no stack is shown; the
 * `digest` the framework hands over is the operator's key, not the screen's.
 *
 * An error boundary must be a Client Component. The administration may require
 * JavaScript (§7e item 11), so nothing about the public budget is affected.
 */
export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <AdminShell eyebrow="Fejl" title="Noget gik galt">
      <Notice tone="error">Siden kunne ikke vises. Prøv igen om et øjeblik.</Notice>

      <Card>
        <p className="text-meta">
          Der opstod en fejl på vores side, og dine seneste ændringer er måske ikke gemt.
          Prøv igen — hvis det sker flere gange, så sig det til den, der står for
          hjemmesiden.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => retry()}
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap px-6 font-semibold text-white"
          >
            Prøv igen
          </button>
          <Link className="text-brand-700 min-h-tap inline-flex items-center underline" href="/admin">
            Tilbage til oversigten
          </Link>
        </div>
      </Card>
    </AdminShell>
  )
}
