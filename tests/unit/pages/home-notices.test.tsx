import { describe, expect, it } from 'vitest'

import { HOME_MESSAGES } from '@/components/admin/home/HomeNotices'

/**
 * Every outcome the Forsiden screen's actions can redirect with has a sentence —
 * phase 11A. The codes are the closed set the four action files produce plus the
 * machinery's own vocabularies (`SaveDraftStatus`, `PublishStatus`); a code without
 * a sentence would leave a person with a silent screen.
 */

const SAVE_STATUSES = ['saved', 'conflict', 'forbidden', 'invalid', 'not_found', 'failed']
const PUBLISH_STATUSES = [
  'published',
  'conflict',
  'nothing_to_publish',
  'not_found',
  'forbidden',
  'invalid_draft',
  'failed',
]

describe('HOME_MESSAGES — the screen\'s result wording', () => {
  it('covers every machinery status the actions can hand back (saved/published are named by the screen)', () => {
    for (const status of [...SAVE_STATUSES, ...PUBLISH_STATUSES]) {
      if (status === 'saved' || status === 'published') continue
      expect(HOME_MESSAGES[status], status).toBeDefined()
    }
  })

  it('covers every code the four action files redirect with', () => {
    for (const code of [
      'gemt', 'uaendret', 'ugyldig',
      'billede_gemt', 'billede_fjernet', 'billede_findes_ikke',
      'ret_tilfoejet', 'ret_skiftet', 'ret_fjernet', 'ret_flyttet',
      'ret_findes_ikke', 'ret_allerede_valgt', 'ret_fuld', 'ret_ugyldig',
      'offentliggjort', 'intet_valgt', 'publish_failed',
    ]) {
      expect(HOME_MESSAGES[code], code).toBeDefined()
    }
  })

  it('says the design\'s own conflict sentence, and every draft sentence says the hjemmeside is unchanged', () => {
    expect(HOME_MESSAGES.conflict?.text).toContain('Nogen andre har rettet dette.')
    for (const code of ['gemt', 'billede_gemt', 'billede_fjernet', 'ret_tilfoejet', 'ret_skiftet', 'ret_fjernet', 'ret_flyttet']) {
      expect(HOME_MESSAGES[code]?.text, code).toContain('Hjemmesiden er uændret')
    }
  })

  it('a refusal is never a success tone', () => {
    for (const code of ['forbidden', 'conflict', 'ret_fuld', 'ret_allerede_valgt', 'billede_findes_ikke', 'invalid_draft']) {
      expect(HOME_MESSAGES[code]?.tone, code).not.toBe('success')
    }
  })
})
