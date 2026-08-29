import { isActiveOwner, isActiveStaff, type Profile } from '@/lib/auth/session'

import { publishableEntity, type EntityKey } from './entities'

/**
 * May this person change this entity — technical plan §5, §8.
 *
 * `requireStaff()` and `requireOwner()` in `lib/auth/guards.ts` redirect, which is
 * exactly right for a page or a single-purpose action and exactly wrong here: the
 * dashboard publishes a *list*, and one item a staff member may not touch must not
 * abandon the four they may. So this returns an answer instead of throwing one.
 *
 * That makes it the answer to the global-publish problem in the phase brief:
 *
 *     "A global/dashboard publish must not let Staff publish Owner-only content
 *      merely because it appears in a submitted checkbox list. Each selected item
 *      must be re-authorized server-side individually."
 *
 * `lib/publishing/publish.ts` calls this once per selected item, against the entity
 * the *server* resolved from `pending_changes` — never against the entity name the
 * browser sent alongside the id. A checkbox is a request, not a permission.
 *
 * ONE QUESTION, NOT TWO
 *
 * Editing a draft and publishing it are governed by the same row of the §5 matrix:
 * the matrix grants a capability whole ("Forsiden (hero, award, featured dishes,
 * about excerpt): Owner"), not a right to draft without a right to publish. So there
 * is one function rather than two identical ones. If a future matrix ever separates
 * them, this is the single place that has to learn the difference.
 *
 * RLS is the independent second layer and is not replaced by any of this: every
 * publish function and every draft write goes to the database through the caller's own
 * JWT, so the same rule is enforced again there. This function exists to produce a
 * clear message, not to be the only gate.
 */
export function mayChangeEntity(entity: EntityKey, profile: Profile): boolean {
  const required = publishableEntity(entity).requiredRole

  return required === 'owner' ? isActiveOwner(profile) : isActiveStaff(profile)
}
