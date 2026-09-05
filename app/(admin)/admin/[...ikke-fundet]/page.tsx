import { notFound } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'

/**
 * Any `/admin/…` address that is not one of the administration's screens — technical
 * plan §10g; phase 13's lock pass (§0ak).
 *
 * Without this the public site's catch-all (`app/(site)/[...ikke-fundet]`) answered
 * such an address for a signed-in person, rendering the public 404 with the public
 * header and footer around it. This catch-all keeps a mistyped administration
 * address inside the administration: it raises `notFound()`, so the response is a
 * real 404 and `../not-found.tsx` renders it.
 *
 * `requireStaff()` runs first, exactly as on every other administration screen:
 * `proxy.ts` has already redirected a visitor without a session, but the guard is the
 * enforcement (§5), and a 404 under `/admin` is not for guests to see. More specific
 * routes always win, so this shadows no screen.
 */
export default async function AdminIkkeFundetPage(): Promise<never> {
  await requireStaff()
  notFound()
}
