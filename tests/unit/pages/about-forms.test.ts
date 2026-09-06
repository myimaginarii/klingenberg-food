import { describe, expect, it } from 'vitest'

import {
  ABOUT_ECHO_BUDGET,
  ABOUT_ERROR_MESSAGES,
  ABOUT_IMAGE_FORM,
  ABOUT_METHOD_FORM,
  ABOUT_STORY_FORM,
  ABOUT_TEAM_FORM,
  aboutErrorFor,
  decodeAboutErrors,
  encodeAboutMethodEcho,
  encodeAboutStoryEcho,
  encodeAboutTeamEcho,
  hasAboutEcho,
  readAboutMethodForm,
  readAboutStoryForm,
  readAboutTeamForm,
  storyFieldError,
} from '@/app/(admin)/admin/om-os/forms'
import { aboutHref, CARD_ANCHOR, imageSlotAnchor } from '@/app/(admin)/admin/om-os/routes'

/**
 * The Om os screen's form vocabularies and addresses — phase 14B1; technical plan §8.
 *
 * What the browser may say, and what it may not. Nothing here reaches a database.
 */

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

describe('the vocabularies', () => {
  it('have no field for an id, an entity, an image detail, an award, a name or a role', () => {
    const names = new Set<string>([
      ...Object.values(ABOUT_STORY_FORM),
      ...Object.values(ABOUT_TEAM_FORM),
      ...Object.values(ABOUT_METHOD_FORM),
      ...Object.values(ABOUT_IMAGE_FORM),
    ])
    for (const forbidden of ['id', 'entity', 'storage_path', 'alt_text', 'udmaerkelse', 'award', 'navn', 'rolle', 'published', 'is_visible']) {
      expect(names.has(forbidden), forbidden).toBe(false)
    }
  })

  it('are disjoint apart from the shared version token', () => {
    const story = new Set<string>(Object.values(ABOUT_STORY_FORM))
    const team = new Set<string>(Object.values(ABOUT_TEAM_FORM))
    const method = new Set<string>(Object.values(ABOUT_METHOD_FORM))
    for (const name of team) if (name !== 'version') expect(story.has(name) || method.has(name), name).toBe(false)
    for (const name of method) if (name !== 'version') expect(story.has(name), name).toBe(false)
  })

  it('read exactly what was typed', () => {
    expect(readAboutStoryForm(form({ overskrift: ' Ny ', historie: 'Et.\n\nTo.' }))).toEqual({
      heading: ' Ny ',
      story: 'Et.\n\nTo.',
    })
    expect(readAboutTeamForm(form({ holdet_tekst: 'Holdet' }))).toEqual({ text: 'Holdet' })
    expect(readAboutMethodForm(form({ metode_overskrift: 'S', metode_tekst: 'T' }))).toEqual({ heading: 'S', text: 'T' })
    expect(readAboutStoryForm(form({}))).toEqual({ heading: '', story: '' })
  })
})

describe('errors and echoes', () => {
  it('decodes only the codes this module defined', () => {
    expect(decodeAboutErrors(['overskrift:too_long', 'historie:too_many', 'pris:too_long', '<script>'])).toEqual([
      'overskrift:too_long',
      'historie:too_many',
    ])
  })

  it('round-trips a refused story through the address while it fits the budget', () => {
    const echo = encodeAboutStoryEcho({ heading: 'x'.repeat(121), story: 'Et.\n\nTo.' }, ['overskrift:too_long'])
    const search = new URLSearchParams(echo.toString())
    expect(decodeAboutErrors(search.getAll('fejl'))).toEqual(['overskrift:too_long'])
    expect(hasAboutEcho(search, [ABOUT_STORY_FORM.heading, ABOUT_STORY_FORM.story])).toBe(true)
    expect(readAboutStoryForm(search)).toEqual({ heading: 'x'.repeat(121), story: 'Et.\n\nTo.' })
  })

  it('carries only the codes when the typed text would not fit the address', () => {
    const echo = encodeAboutStoryEcho({ heading: '', story: 'x'.repeat(ABOUT_ECHO_BUDGET + 1) }, ['historie:too_long'])
    const search = new URLSearchParams(echo.toString())
    expect(search.getAll('fejl')).toEqual(['historie:too_long'])
    expect(hasAboutEcho(search, [ABOUT_STORY_FORM.heading, ABOUT_STORY_FORM.story])).toBe(false)
    expect(echo.toString().length).toBeLessThan(200)
  })

  it('the team and method echoes carry their own fields and codes', () => {
    const team = new URLSearchParams(encodeAboutTeamEcho({ text: 'Lang' }, ['holdet_tekst:too_long']).toString())
    expect(readAboutTeamForm(team)).toEqual({ text: 'Lang' })
    expect(team.getAll('fejl')).toEqual(['holdet_tekst:too_long'])

    const method = new URLSearchParams(
      encodeAboutMethodEcho({ heading: 'H', text: 'T' }, ['metode_overskrift:too_long', 'metode_tekst:too_long']).toString(),
    )
    expect(readAboutMethodForm(method)).toEqual({ heading: 'H', text: 'T' })
    expect(method.getAll('fejl')).toHaveLength(2)
  })

  it('binds a message to its field, and the story field prefers the count over the length', () => {
    expect(aboutErrorFor(['overskrift:too_long'], 'overskrift:too_long')).toBe(ABOUT_ERROR_MESSAGES['overskrift:too_long'])
    expect(aboutErrorFor([], 'overskrift:too_long')).toBeUndefined()
    expect(storyFieldError(['historie:too_long', 'historie:too_many'])).toContain('10 afsnit')
    expect(storyFieldError(['historie:too_long'])).toContain('2000 tegn')
    expect(storyFieldError([])).toBeUndefined()
  })

  it('every message names its limit in Danish', () => {
    for (const message of Object.values(ABOUT_ERROR_MESSAGES)) expect(message).toMatch(/højst/)
  })
})

describe('the addresses', () => {
  it('build the screen\'s own path, the status, the focus and the picker', () => {
    expect(aboutHref()).toBe('/admin/om-os')
    expect(aboutHref({ status: 'gemt', focus: CARD_ANCHOR.story })).toBe('/admin/om-os?status=gemt&fokus=historien#historien')
    expect(aboutHref({ chooseImage: 'holdet' })).toBe('/admin/om-os?vaelg_billede=holdet#vaelg-billede-dialog')
    expect(aboutHref({ focus: imageSlotAnchor('koekken') })).toBe('/admin/om-os?fokus=vaelg-billede-koekken#vaelg-billede-koekken')
  })

  it('merges a refusal\'s echo without letting a caller hand-build the query', () => {
    const extra = new URLSearchParams()
    extra.append('fejl', 'overskrift:too_long')
    extra.set('overskrift', 'a&b=c')
    const href = aboutHref({ status: 'ugyldig', focus: CARD_ANCHOR.story }, extra)
    const search = new URLSearchParams(href.slice(href.indexOf('?') + 1, href.indexOf('#')))
    expect(search.get('status')).toBe('ugyldig')
    expect(search.get('overskrift')).toBe('a&b=c')
    expect(search.getAll('fejl')).toEqual(['overskrift:too_long'])
  })
})
