import type { SiteContact } from '@/lib/content/types'

import { readContentJson } from './source'

/**
 * The restaurant's contact facts — `content/site/contact.json`.
 *
 * The file is the domain shape written down: every field of {@link SiteContact}, in
 * the same words, so this loader has nothing to convert. It exists anyway, because the
 * pages must not know that the facts are a JSON file rather than a database row — the
 * storage detail stops here (technical plan §4).
 */
export function loadContact(): SiteContact {
  return readContentJson<SiteContact>('contact.json')
}
