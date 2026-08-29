import Link from 'next/link'

import { requireOwner } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { AdminShell, Card } from '../ui'

/**
 * Owner-only page — technical plan §5, §15 phase 1.
 *
 * PHASE 1 SCOPE. Not a designed screen. It exists to prove one specific claim from the
 * plan: that an Owner-only route is refused on the server for a signed-in Staff member,
 * not merely omitted from their navigation. "A hidden button is never a permission."
 *
 * It reads two Owner-only resources — the weekly opening hours and the audit log — so
 * the page also demonstrates the second layer. Even if this guard were removed, RLS
 * would return the audit log as empty for Staff, because `public.is_owner()` is false
 * for them in the database. The two layers are independent by design.
 *
 * The real owner surfaces (`/admin/aabningstider`, `/admin/kontakt`, `/admin/forsiden`,
 * `/admin/brugere`) arrive in phases 8 and 11.
 */
export default async function OwnerOnlyPage() {
  const profile = await requireOwner()

  const supabase = await createSupabaseServerClient()

  const [{ data: hours }, { count: auditCount }] = await Promise.all([
    supabase.from('opening_hours').select('schedule').maybeSingle(),
    supabase.from('audit_log').select('*', { count: 'exact', head: true }),
  ])

  return (
    <AdminShell eyebrow="Kun for ejere" title="Ejer-område">
      <Card>
        <h2 className="text-heading font-semibold">Adgang bekræftet</h2>
        <p className="text-ink-2 text-meta mt-2">
          {profile.name} er logget ind som ejer. En medarbejder får en afvisning her —
          også ved at indtaste adressen direkte.
        </p>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Normale åbningstider</h2>
        <p className="text-ink-2 text-meta mt-2">
          Kun ejeren må ændre dem. Redigeringen bygges i fase 8.
        </p>
        <pre className="bg-section rounded-field text-meta mt-3 overflow-x-auto p-3 font-mono">
          {JSON.stringify(hours?.schedule ?? null, null, 2)}
        </pre>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Ændringslog</h2>
        <p className="text-ink-2 text-meta mt-2">
          {auditCount ?? 0} post(er). Medarbejdere kan ikke læse loggen — hverken her
          eller i databasen.
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
