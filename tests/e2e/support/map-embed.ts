import type { Frame, Request } from '@playwright/test'

/**
 * The one third party the public site loads on purpose — technical plan §7g
 * (decision 6, revised for launch), phase 14B3 (§0ap) as finalised by §0aq.
 *
 * `components/site/GoogleMap.tsx` renders Google's own generated embed in an
 * `<iframe>` on the Forside and on Find os. That frame is a separate browsing
 * context: once Google's document loads, it pulls its own scripts, fonts and
 * tiles from `maps.googleapis.com`, `maps.gstatic.com` and friends, and this
 * origin neither chooses nor controls that list. Enumerating Google's hosts in a
 * test would pin something Google changes at will.
 *
 * So the rule the suites assert is not "these hosts are allowed" but **whose
 * frame asked**: the site's own document must still reach nothing but this origin
 * and Supabase Storage, and everything foreign must come from inside Google's
 * frame. A pixel, a tag manager or an analytics script added to the site would sit
 * in the main frame and still fail, which is the guarantee worth keeping (§12).
 *
 * The privacy question this embed raises — third-party content in a guest's
 * browser, which the retired static map never did — is deliberately not decided
 * here; it is the later privacy/cookie review's (docs/runbooks/launch-notes.md §8).
 */
export const MAP_EMBED_PREFIX = 'https://www.google.com/maps/embed?pb='

/**
 * Is this request Google's map frame doing its own work, rather than the site's
 * own page reaching off-origin?
 *
 * Two cases, both measured against the running site rather than assumed:
 *
 *   1. the frame's own document — a navigation request for the embed `src`, made
 *      before the frame has committed a URL, so it has no frame URL to match on;
 *   2. everything the frame then loads — matched by walking from the requesting
 *      frame up through its parents, so a frame Google nests inside its own is
 *      covered too. The walk ends at the main frame, whose URL is this site's, so
 *      a request made by the page itself never matches.
 */
export function belongsToMapEmbed(request: Request): boolean {
  if (request.isNavigationRequest() && request.url().startsWith(MAP_EMBED_PREFIX)) return true

  try {
    for (let frame: Frame | null = request.frame(); frame; frame = frame.parentFrame()) {
      if (frame.url().startsWith(MAP_EMBED_PREFIX)) return true
    }
  } catch {
    /* A frame detached before it could be read: not something we can attribute to
       the embed, so it stays foreign and the caller's assertion reports it. */
  }

  return false
}
