import { requireStaff } from '@/lib/auth/guards'

import { setNewPassword } from '../actions'
import { AdminShell, Card, Field, Notice, SubmitButton } from '../ui'

/**
 * Choose a new password — technical plan §5.
 *
 * PHASE 1 SCOPE. Foundation-level, not the designed screen.
 *
 * Reached from `/admin/bekraeft`, which has already established a session from the
 * recovery link. `requireStaff()` runs here anyway: a recovery session is a session
 * like any other, and this page must not be usable by someone holding a stale cookie
 * and no profile. Without a session the visitor is sent to the login form.
 *
 * The minimum length mirrors `minimum_password_length` in supabase/config.toml. Supabase
 * remains the authority; this only produces a better message than a raw API error.
 */
const MESSAGES: Record<string, string> = {
  uens: 'De to adgangskoder er ikke ens.',
  kort: 'Adgangskoden skal være mindst 12 tegn.',
  afvist: 'Adgangskoden blev afvist. Prøv en anden.',
}

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ fejl?: string }>
}) {
  const profile = await requireStaff()
  const params = await searchParams
  const error = params.fejl ? MESSAGES[params.fejl] : undefined

  return (
    <AdminShell eyebrow="Klingenberg Food · administration" title="Vælg ny adgangskode">
      <Card>
        <form action={setNewPassword} className="flex flex-col gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}

          <p className="text-meta text-ink-2">
            Vælg en ny adgangskode til <span className="font-mono">{profile.email}</span>.
            Mindst 12 tegn med både store og små bogstaver og tal.
          </p>

          <Field
            label="Ny adgangskode"
            name="password"
            type="password"
            autoComplete="new-password"
          />
          <Field
            label="Gentag adgangskode"
            name="gentag"
            type="password"
            autoComplete="new-password"
          />

          <SubmitButton>Gem adgangskode</SubmitButton>
        </form>
      </Card>
    </AdminShell>
  )
}
