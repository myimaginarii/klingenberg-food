import { draftMode } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentProfile, isActiveStaff } from '@/lib/auth/session'
import { previewPath } from '@/lib/drafts/targets'

/**
 * Start a preview — technical plan §3, §6, §8.
 *
 * Forhåndsvis is a link to this route. It does five things, in this order, and refuses
 * at the first one that fails:
 *
 *   1. **Require a real staff session.** Not the middleware's redirect — this route is
 *      outside `/admin`, so nothing has run before it. `getCurrentProfile()` verifies
 *      the token with the Auth server on every call, so an expired or revoked session
 *      is refused here even though its cookie is still in the browser.
 *   2. **Refuse a deactivated account**, for the same reason.
 *   3. **Validate the destination against a closed set of internal paths.** No URL is
 *      accepted from the request at any point; see `lib/drafts/targets.ts`.
 *   4. **Enable Draft Mode** — `await draftMode()`, which is asynchronous in this
 *      version of Next.js — setting the signed, httpOnly `__prerender_bypass` cookie.
 *   5. **Redirect to the public path**, built from the request's own origin, so the
 *      destination cannot be influenced by a forwarded header.
 *
 * WHY THE COOKIE IS SITE-WIDE, AND WHY THAT IS NOT A COOKIE ON THE PUBLIC SITE
 *
 * The whole point of preview is to look at the real public page, so the bypass cookie
 * has to be sent on public routes; scoping it to `/admin` would leave the preview
 * showing exactly what a visitor sees. §12's promise is that a *visitor* receives no
 * cookies, and that is unaffected: this route is the only thing that ever sets one,
 * and it refuses everybody who is not signed-in staff. A visitor never reaches step 4,
 * so a visitor never receives a cookie — asserted in tests/e2e/public-site.spec.ts and
 * again in tests/e2e/draft-publish.spec.ts.
 *
 * DRAFT MODE IS NOT AUTHORIZATION
 *
 * Holding the cookie does not let anyone see a draft. `lib/drafts/preview.ts` requires
 * an active staff session on every request as well, so a cookie that outlives its
 * session shows the published site.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const profile = await getCurrentProfile()

  if (!isActiveStaff(profile)) {
    // A person who is not signed in is sent to the login form; the query string is a
    // closed set of codes the page knows how to translate, never a message from
    // anywhere else.
    return NextResponse.redirect(new URL('/admin/login?fejl=log-ind', request.nextUrl.origin), {
      status: 303,
    })
  }

  const path = previewPath(request.nextUrl.searchParams.get('maal'))

  if (path === null) {
    return NextResponse.redirect(
      new URL('/admin?fejl=ukendt-forhaandsvisning', request.nextUrl.origin),
      { status: 303 },
    )
  }

  const draft = await draftMode()
  draft.enable()

  // `new URL(path, origin)` with a path that is always a literal from our own module.
  // Nothing from the request contributes to the destination.
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303 })
}
