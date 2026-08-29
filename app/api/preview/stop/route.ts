import { draftMode } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

import { previewPath } from '@/lib/drafts/targets'

/**
 * Leave a preview — technical plan §6.
 *
 * Disables Draft Mode by deleting the bypass cookie, then returns to a page. From the
 * next request onward the staff member is browsing the published site exactly as a
 * visitor does, served from the same cached pages.
 *
 * NO SESSION CHECK, DELIBERATELY
 *
 * Every other route in this phase refuses a caller without a staff session. This one
 * does the opposite and refuses nobody, because the only thing it can do is *remove* a
 * capability. Requiring a valid session to stop previewing would strand a staff member
 * whose session expired mid-preview in a state they could not leave, and would give an
 * expired cookie more staying power than a valid one. There is nothing to protect
 * here: a person with no bypass cookie who calls it is redirected, unchanged.
 *
 * The destination is validated exactly as it is on the way in — a target key from a
 * closed set, never a URL — so this cannot become an open redirect either.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const draft = await draftMode()
  draft.disable()

  const path = previewPath(request.nextUrl.searchParams.get('maal')) ?? '/admin'

  return NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303 })
}
