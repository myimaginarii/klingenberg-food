import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ABOUT_MESSAGES, AboutMalformedDraftNotice, AboutStatusNotice } from '@/components/admin/about/AboutNotices'

/**
 * Every outcome the Om os screen's actions can redirect with has a sentence — phase
 * 14B1. The codes are the closed set the three action files produce plus the
 * machinery's own vocabularies (`SaveDraftStatus`, `PublishStatus`); a code without a
 * sentence would leave a person with a silent screen.
 */

const SAVE_STATUSES = ['saved', 'conflict', 'forbidden', 'invalid', 'not_found', 'failed']
const PUBLISH_STATUSES = ['published', 'conflict', 'nothing_to_publish', 'not_found', 'forbidden', 'invalid_draft', 'failed']

describe('ABOUT_MESSAGES — the screen\'s result wording', () => {
  it('covers every machinery status the actions can hand back (saved/published are named by the screen)', () => {
    for (const status of [...SAVE_STATUSES, ...PUBLISH_STATUSES]) {
      if (status === 'saved' || status === 'published') continue
      expect(ABOUT_MESSAGES[status], status).toBeDefined()
    }
  })

  it('covers every code the three action files redirect with', () => {
    for (const code of [
      'gemt', 'uaendret', 'ugyldig',
      'billede_gemt', 'billede_fjernet', 'billede_findes_ikke',
      'offentliggjort', 'intet_valgt', 'publish_failed', 'for_mange',
    ]) {
      expect(ABOUT_MESSAGES[code], code).toBeDefined()
    }
  })

  it('says the design\'s own conflict sentence, and every draft sentence says the hjemmeside is unchanged', () => {
    expect(ABOUT_MESSAGES.conflict?.text).toContain('Nogen andre har rettet dette.')
    for (const code of ['gemt', 'billede_gemt', 'billede_fjernet']) {
      expect(ABOUT_MESSAGES[code]?.text, code).toContain('Hjemmesiden er uændret')
    }
  })

  it('a refusal is never a success tone', () => {
    for (const code of ['forbidden', 'conflict', 'billede_findes_ikke', 'invalid_draft', 'for_mange']) {
      expect(ABOUT_MESSAGES[code]?.tone, code).not.toBe('success')
    }
  })

  it('renders a known code as a status in words, and an unknown one as nothing', () => {
    expect(renderToStaticMarkup(<AboutStatusNotice status="gemt" />)).toContain('role="status"')
    expect(renderToStaticMarkup(<AboutStatusNotice status="gemt" />)).toContain('Gemt som kladde')
    expect(renderToStaticMarkup(<AboutStatusNotice status="<script>" />)).toBe('')
    expect(renderToStaticMarkup(<AboutStatusNotice />)).toBe('')
  })

  it('says a malformed stored draft out loud, and nothing otherwise', () => {
    expect(renderToStaticMarkup(<AboutMalformedDraftNotice malformed />)).toContain('kan ikke læses')
    expect(renderToStaticMarkup(<AboutMalformedDraftNotice malformed={false} />)).toBe('')
  })
})
