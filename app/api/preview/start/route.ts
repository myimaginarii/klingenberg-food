import { draftMode } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

import { getCurrentProfile, isActiveStaff } from '@/lib/auth/session'
import { newsPreviewPath, previewPath } from '@/lib/drafts/targets'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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

  const target = request.nextUrl.searchParams.get('maal')

  /*
   * `maal=nyhed` is the one target that carries data — the article's slug (§6: the
   * preview opens the real `/nyheder/[slug]` URL for an unpublished article; phase
   * 9A). It stays inside the closed-set rule in two steps: `newsPreviewPath` accepts
   * only the slug grammar, which cannot spell a path, a query or another origin; and
   * the article must exist, read through this staff member's own JWT — so the address
   * previews the article they are actually editing, or nothing.
   */
  const path =
    target === 'nyhed'
      ? await existingArticlePreviewPath(request.nextUrl.searchParams.get('slug'))
      : previewPath(target)

  if (path === null) {
    return NextResponse.redirect(
      new URL('/admin?fejl=ukendt-forhaandsvisning', request.nextUrl.origin),
      { status: 303 },
    )
  }

  const draft = await draftMode()
  draft.enable()

  // `new URL(path, origin)` with a path from our own module: a literal for the fixed
  // targets, and for `nyhed` a slug that passed the grammar and named a real article.
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303 })
}

/**
 * The article's preview path, or `null` — for a value that is not a slug, and for a
 * slug no article this person can see actually has. RLS decides the second half:
 * `news_select_staff` shows staff every article, drafts included, which is exactly
 * what previewing an unpublished one needs.
 */
async function existingArticlePreviewPath(slug: string | null): Promise<string | null> {
  const path = newsPreviewPath(slug)
  if (path === null) return null

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('news')
    .select('id')
    .eq('slug', slug)
    .maybeSingle<{ id: string }>()

  if (error !== null) {
    console.error(`Could not resolve the news preview slug: ${error.message}`)
    return null
  }

  return data === null ? null : path
}
