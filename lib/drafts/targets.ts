import { isNewsSlug, newsArticlePath } from '@/lib/news/slug'
import type { EntityKey } from '@/lib/publishing/entities'

/**
 * Where a preview may go — technical plan §6, §8.
 *
 * Forhåndsvis opens "the real public URL", which means the preview route has to be
 * told which one. The obvious way to do that is a `?redirect=` parameter, and the
 * obvious way is an open redirect: anyone who can get a staff member to follow a
 * preview link whose redirect parameter points somewhere else entirely has turned this
 * site into a jumping-off point wearing its own domain.
 *
 * So no URL is ever accepted. The route takes a **target key** — a short name from the
 * closed set below — and looks the path up here. The path is a literal in this file,
 * relative, and begins with a single `/`. There is no code path from a request to a
 * destination that is not one of these values, which is a stronger statement than any
 * amount of validating a URL that arrived from outside.
 *
 * `/nyheder/[slug]` is the one target that is not a fixed path, because previewing one
 * article needs a slug and a slug is data rather than a name from a closed set. Phase
 * 9A added it the narrowest way that stays true to the rule above: `newsPreviewPath`
 * accepts only a string the slug grammar accepts — lowercase letters, digits and
 * single hyphens, so it cannot contain `/`, `.`, `?`, `#` or anything else that could
 * steer a URL — and the preview route additionally requires the article to exist,
 * read through the staff member's own JWT (§6: the preview opens the real
 * `/nyheder/[slug]` URL for an unpublished article). No URL is still ever accepted.
 */

export const PREVIEW_TARGETS = {
  forside: { path: '/', label: 'Forsiden' },
  menu: { path: '/menu', label: 'Menu' },
  'mad-ud-af-huset': { path: '/mad-ud-af-huset', label: 'Mad ud af huset' },
  'om-os': { path: '/om-os', label: 'Om os' },
  nyheder: { path: '/nyheder', label: 'Nyheder' },
  'find-os': { path: '/find-os', label: 'Find os' },
} as const

export type PreviewTargetKey = keyof typeof PREVIEW_TARGETS

const TARGET_KEYS = Object.keys(PREVIEW_TARGETS) as PreviewTargetKey[]

/** The internal path for a target key, or `null` when the key is not one of ours. */
export function previewPath(key: unknown): string | null {
  if (typeof key !== 'string') return null
  if (!TARGET_KEYS.includes(key as PreviewTargetKey)) return null

  return PREVIEW_TARGETS[key as PreviewTargetKey].path
}

/**
 * The internal path for one article's preview, or `null` when the value is not a
 * slug. The grammar is the whole gate here — the caller still checks the article
 * exists before enabling Draft Mode.
 */
export function newsPreviewPath(slug: unknown): string | null {
  return isNewsSlug(slug) ? newsArticlePath(slug) : null
}

/**
 * The page a pending change is most usefully previewed on.
 *
 * A judgement about content, not about routing, which is why it lives beside the
 * targets rather than in the publish registry: the registry answers "who may publish
 * this and what does it invalidate", and this answers "where would you look at it".
 */
export function previewTargetForEntity(entity: EntityKey): PreviewTargetKey {
  switch (entity) {
    case 'page:home':
      return 'forside'
    case 'page:takeaway':
      return 'mad-ud-af-huset'
    case 'page:about':
      return 'om-os'
    case 'menu_category':
    case 'dish':
    case 'weekly_special':
    case 'monthly_burger':
      return 'menu'
    case 'news':
      return 'nyheder'
    case 'site_contact':
    case 'opening_hours':
    case 'opening_hours_override':
    case 'announcement':
      // These appear on every page; the Forside is where a person will look first.
      return 'forside'
  }
}
