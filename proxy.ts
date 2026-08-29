import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/config'

/**
 * Proxy — technical plan §5, layer 1.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`; `middleware.ts` is
 * deprecated. The behaviour is unchanged, and so is this file's role in the
 * architecture, which the plan states in one line:
 *
 *     **This is routing convenience, not authorization.**
 *
 * Two things happen here and nothing else:
 *
 *   1. The Supabase session is refreshed. A Server Component cannot write cookies, so
 *      something that runs before rendering has to persist a rotated refresh token.
 *      This is that something. Remove it and sessions expire early in confusing ways.
 *   2. An unauthenticated visitor to /admin is redirected to the login page, so they
 *      see a form instead of a flash of an empty dashboard.
 *
 * **Nothing is authorized here.** No role is read, no permission is decided, and no
 * downstream code trusts that this file ran. `requireStaff()` and `requireOwner()`
 * run inside every protected page and every Server Action, and RLS re-checks the same
 * rule in the database. That is a deliberate design property, and it is what makes the
 * known Next.js middleware authorization-bypass advisory class inapplicable to this
 * system: bypassing this file grants nothing, because this file grants nothing.
 *
 * The matcher covers `/admin` only. The public half of the site has no session, no
 * authenticated behaviour, and — per §12 — receives no cookies at all; running an Auth
 * round trip on every public request would buy nothing and risk exactly that property.
 * Because Server Actions are POSTs to the route they are used on, and every admin
 * action lives under `/admin`, the matcher covers them too. Even if a future refactor
 * moved one outside, the guards inside it would still refuse the request.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
        // A response that sets auth cookies must never be cached by a CDN or proxy,
        // or one person's session token can be handed to somebody else. The library
        // supplies the correct no-store headers; setting them is our job.
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue)
        }
      },
    },
  })

  // Must run before any response is generated, so a rotated token can still be written
  // back. `getUser()` rather than `getSession()`: the refresh has to be validated.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // The admin is never indexed (§8). Set on every /admin response, including redirects.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')

  const { pathname, search } = request.nextUrl

  if (!user && !isPublicAdminPath(pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/admin/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('fejl', 'log-ind')
    // Where to return to after signing in. Stored as a path only — never an absolute
    // URL, which would make this an open redirect (§8).
    if (pathname !== '/admin') {
      loginUrl.searchParams.set('videre', `${pathname}${search}`)
    }

    const redirectResponse = NextResponse.redirect(loginUrl)
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
    redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return redirectResponse
  }

  return response
}

/**
 * The handful of /admin routes that must be reachable without a session: the login
 * form itself, the password-reset request and its confirmation link, and the
 * set-a-new-password screen the confirmation link lands on.
 *
 * This list only decides whether the *redirect* above fires. It grants nothing — every
 * page behind it still calls a guard.
 */
function isPublicAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin/login' ||
    pathname === '/admin/glemt-adgangskode' ||
    pathname === '/admin/bekraeft' ||
    pathname === '/admin/ny-adgangskode'
  )
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
