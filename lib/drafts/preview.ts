import 'server-only'

import { cache } from 'react'
import { draftMode } from 'next/headers'

import { getCurrentProfile, isActiveStaff, type Profile } from '@/lib/auth/session'

/**
 * Who, if anyone, is previewing — technical plan §6, §8.
 *
 * Draft Mode is a cookie. This module is the reason that cookie is not, on its own,
 * permission to see anything:
 *
 *     **Draft Mode decides that a request wants drafts.
 *       A staff session decides that it may have them.**
 *
 * Both must hold. A visitor who somehow acquires or forges the bypass cookie gets the
 * published site, because `getCurrentProfile()` returns null for them and this
 * function returns null in turn. A staff member who has not started a preview gets the
 * published site too, because the cookie is absent. There is no third way in.
 *
 * The gate is deliberately re-evaluated here rather than trusted from the route that
 * enabled preview: sessions expire, accounts are deactivated, and a bypass cookie
 * outlives both. `getCurrentProfile()` verifies the token with the Auth server on
 * every request (see `lib/auth/session.ts`), so a revoked session stops previewing at
 * once.
 *
 * WHY READING THIS DOES NOT MAKE THE PUBLIC SITE DYNAMIC
 *
 * `draftMode()` reports `isEnabled: false` during a prerender without opting the route
 * out of static generation — only `enable()` and `disable()` do that, which is why
 * both live in Route Handlers. So the six public pages are still prerendered and still
 * revalidate on the five-minute safety net (§7a); a request carrying the bypass cookie
 * is the only one that renders per request. `cache()` keeps it to one evaluation per
 * render pass, so a page and its layout ask once between them.
 */

export type PreviewSession = {
  /** The staff member looking at the draft. Shown in the preview bar. */
  readonly profile: Profile
}

export const readPreviewSession = cache(async (): Promise<PreviewSession | null> => {
  const { isEnabled } = await draftMode()
  if (!isEnabled) return null

  const profile = await getCurrentProfile()
  if (!isActiveStaff(profile)) return null

  return { profile }
})

/** True when this request should read drafts. The one question the loaders ask. */
export async function isPreviewingDrafts(): Promise<boolean> {
  return (await readPreviewSession()) !== null
}
