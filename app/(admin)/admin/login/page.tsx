import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentProfile, isActiveStaff } from '@/lib/auth/session'
import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { signIn } from '../actions'
import { AdminShell, Card, Field, Notice, SubmitButton } from '../ui'

/**
 * Login — technical plan §5.
 *
 * PHASE 1 SCOPE. A foundation-level form, not the approved login screen. It exists to
 * verify that email/password authentication, httpOnly session cookies and the guards
 * work end to end. The designed screen is built in a later phase and replaces this.
 *
 * The form posts to a Server Action and works with JavaScript disabled. There is no
 * sign-up link, because public signup does not exist (§5).
 */

/** The closed set of codes the actions may return. Never an auth-server message. */
const MESSAGES: Record<string, string> = {
  'log-ind': 'Log ind for at fortsætte.',
  forkert: 'Forkert e-mail eller adgangskode.',
  mangler: 'Udfyld både e-mail og adgangskode.',
  deaktiveret: 'Din konto er deaktiveret. Kontakt ejeren.',
  // The sign-in throttle (phase 13B). One sentence for an address that exists and
  // one that does not; no count, no window.
  [RATE_LIMIT_STATUS]: 'Der er gjort for mange forsøg på kort tid. Vent lidt, og prøv igen.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fejl?: string; besked?: string; videre?: string }>
}) {
  const params = await searchParams

  // Someone already signed in has no use for a login form.
  const profile = await getCurrentProfile()
  if (isActiveStaff(profile)) {
    redirect('/admin')
  }

  const error = params.fejl ? MESSAGES[params.fejl] : undefined
  const loggedOut = params.besked === 'logget-ud'

  // Only a site-relative /admin path survives; anything else would be an open
  // redirect. The action re-checks this — this copy is for the hidden field only (§8).
  const next =
    typeof params.videre === 'string' &&
    params.videre.startsWith('/admin') &&
    !params.videre.startsWith('//')
      ? params.videre
      : undefined

  return (
    <AdminShell eyebrow="Klingenberg Food · administration" title="Log ind">
      <Card>
        <form action={signIn} className="flex flex-col gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {loggedOut ? <Notice tone="success">Du er logget ud.</Notice> : null}

          <Field label="E-mail" name="email" type="email" autoComplete="username" />
          <Field
            label="Adgangskode"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          {next ? <input type="hidden" name="videre" value={next} /> : null}

          <SubmitButton>Log ind</SubmitButton>
        </form>
      </Card>

      <p className="text-meta">
        <Link className="text-brand-700 underline" href="/admin/glemt-adgangskode">
          Glemt adgangskode?
        </Link>
      </p>
    </AdminShell>
  )
}
