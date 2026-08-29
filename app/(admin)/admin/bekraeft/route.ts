import { NextResponse, type NextRequest } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Recovery-link landing route — technical plan §5, §10c.
 *
 * The Danish recovery email (`supabase/templates/recovery.html`) links here with a
 * one-time `token_hash`. This handler exchanges it for a session **on the server** and
 * writes the httpOnly session cookies, then sends the person to the set-a-new-password
 * form.
 *
 * Doing the exchange here rather than in the browser is the whole point: the token
 * never reaches client-side JavaScript, no Supabase client exists in the browser
 * (§1, adjustment 2), and the resulting session is an ordinary httpOnly cookie session
 * like any other.
 *
 * A missing, expired or already-used token produces a plain error on the login form.
 * The route reveals nothing about why.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  const failure = new URL('/admin/login?fejl=link-ugyldigt', request.url)

  // Only the two flows this application actually uses. Anything else is refused rather
  // than passed through to the auth server.
  if (!tokenHash || (type !== 'recovery' && type !== 'invite')) {
    return NextResponse.redirect(failure)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    return NextResponse.redirect(failure)
  }

  return NextResponse.redirect(new URL('/admin/ny-adgangskode', request.url))
}
