import Link from 'next/link'

import { AdminShell, Card } from './ui'

/**
 * The administration's 404 — technical plan §10g ("`error.tsx` and `not-found.tsx`
 * in both route groups"); phase 13's lock pass (§0ak).
 *
 * Rendered when an administration screen calls `notFound()` — a menu section that
 * does not exist, an editor whose row is gone — and for an `/admin/…` address that
 * matches no screen (`./[...ikke-fundet]/page.tsx`). Before this file existed the
 * former fell through to the framework's default 404 and the latter to the public
 * site's, inside the public header and footer. Both now land here, inside the
 * administration, with the way back a signed-in person needs.
 *
 * The response is a real 404 and carries the framework's `noindex`; `proxy.ts` has
 * already redirected anybody without a session, so this screen is never a guest's.
 */
export default function AdminNotFound() {
  return (
    <AdminShell eyebrow="Siden findes ikke" title="Vi kunne ikke finde siden">
      <Card>
        <p className="text-meta">
          Adressen findes ikke i administrationen, eller det, den peger på, er væk. Prøv
          oversigten.
        </p>
      </Card>

      <p className="text-meta">
        <Link className="text-brand-700 underline" href="/admin">
          Tilbage til oversigten
        </Link>
      </p>
    </AdminShell>
  )
}
