import 'server-only'

import type { AnnouncementReplacement } from '@/lib/announcements/replacement'

/**
 * The 8C-1 integration harness — **not part of the administration**, and temporary.
 *
 * WHY IT EXISTS
 *
 * The 8C-1 brief requires proof, through the *real* cache path, that a replacement and
 * its restore each land on the **first** guest request:
 *
 *     published A → replace with B → first guest request sees B
 *                 → restore → first guest request sees A
 *
 * That path is `expirePublicCacheTags()`, and `updateTag()` may only be called from
 * inside a Server Action — so proving it needs a Server Action, and a Server Action is
 * only reachable when something renders a form that dispatches to it. 8C-1 must not add
 * a replacement control to `/admin/besked` (the ordinary editor is unchanged) and must
 * not add an announcement control to the opening-hours screen (1ae's conflict sheet is
 * 8C-3). So the form lives here, on an address nothing links to, behind a flag that is
 * off unless a test switched it on.
 *
 * **8C-3 deletes this directory.** The real caller is the conflict sheet, on the
 * opening-hours screen, with a payload composed by 8C-2 — and once that exists there is
 * a production form dispatching to a production action, and nothing left for this to
 * prove.
 *
 * WHAT KEEPS IT SAFE
 *
 *   1. **The flag.** `ANNOUNCEMENT_REPLACEMENT_HARNESS=1` must be set in the server's
 *      environment. It is set by `playwright.config.ts` for the test server and by
 *      nothing else; a deployed build has no such variable, so the page is a 404 and
 *      both actions refuse before they read anything.
 *   2. **`requireStaff()`**, in the page and in both actions, exactly as every other
 *      admin screen does. The flag is not the authorization.
 *   3. **The browser chooses no content.** The submission is a **closed variant key**
 *      and a version token — nothing else. The replacement payload is resolved on the
 *      server from {@link HARNESS_REPLACEMENTS} below, which is exactly the shape 8C-3
 *      will have: a server-composed payload and a person choosing between two named
 *      outcomes. There is deliberately no field for a message, a link, an expiry, a
 *      source, `previous`, `replaced_at`, `draft`, an entity name or a row id — so the
 *      security properties this phase claims are not weakened by the thing that tests
 *      them.
 *   4. **No link anywhere.** The dashboard does not render a tile for it, the
 *      navigation does not name it, and no other page links to it.
 */

/** The flag. Off unless a test server was started with it. */
export const HARNESS_FLAG = 'ANNOUNCEMENT_REPLACEMENT_HARNESS'

export function harnessEnabled(): boolean {
  return process.env[HARNESS_FLAG] === '1'
}

/** The closed set of replacements this harness can ask for. Two, by name. */
export const HARNESS_VARIANTS = ['b', 'd'] as const

export type HarnessVariant = (typeof HARNESS_VARIANTS)[number]

export function isHarnessVariant(value: unknown): value is HarnessVariant {
  return typeof value === 'string' && (HARNESS_VARIANTS as readonly string[]).includes(value)
}

/**
 * The messages, composed on the server.
 *
 * Deliberately **not** opening-hours wording: nothing in 8C-1 generates a message from a
 * date and a pair of times, and a fixture that looked like one would blur the boundary
 * this phase is asked to keep. `source` is `'opening_hours'` because that is the value
 * the mechanism must be *capable* of writing, and this is the only place in the
 * repository that passes it.
 */
const MESSAGES: Record<HarnessVariant, string> = {
  b: 'Testbesked B fra erstatningsmekanismen',
  d: 'Testbesked D fra erstatningsmekanismen',
}

/** Two hours ahead of whenever this is called — always a valid future expiry. */
export function harnessReplacement(variant: HarnessVariant): AnnouncementReplacement {
  return {
    message: MESSAGES[variant],
    link_type: 'none',
    link_page: null,
    link_url: null,
    link_label: null,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    source: 'opening_hours',
  }
}

/** The field names the two forms submit. A version token, and a closed variant key. */
export const HARNESS_FORM = {
  version: 'version',
  variant: 'variant',
} as const

export const HARNESS_PATH = '/admin/intern/besked-erstatning'
