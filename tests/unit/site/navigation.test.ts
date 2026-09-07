import { describe, expect, it } from 'vitest'

import { FOOTER_NAV, MAIN_NAV, isCurrentRoute } from '@/lib/site/navigation'

describe('MAIN_NAV', () => {
  it('is the approved navigation, in the approved order', () => {
    expect(MAIN_NAV.map((item) => item.label)).toEqual([
      'Forside',
      'Menu',
      'Mad ud af huset',
      'Om os',
      'Nyheder',
      'Find os',
    ])
  })

  it('points at the six public routes from the technical plan', () => {
    expect(MAIN_NAV.map((item) => item.href)).toEqual([
      '/',
      '/menu',
      '/mad-ud-af-huset',
      '/om-os',
      '/nyheder',
      '/find-os',
    ])
  })

  it('leaves the Forside out of the footer column, as the design does', () => {
    expect(FOOTER_NAV.map((item) => item.href)).not.toContain('/')
    expect(FOOTER_NAV).toHaveLength(MAIN_NAV.length - 1)
  })
})

describe('isCurrentRoute', () => {
  it('marks the Forside only on the Forside', () => {
    expect(isCurrentRoute('/', '/')).toBe(true)
    expect(isCurrentRoute('/menu', '/')).toBe(false)
  })

  it('marks a section on its own page', () => {
    expect(isCurrentRoute('/menu', '/menu')).toBe(true)
    expect(isCurrentRoute('/find-os', '/menu')).toBe(false)
  })

  it('marks Nyheder while reading one of its articles', () => {
    expect(isCurrentRoute('/nyheder/overskrift-placeholder-ny-burger', '/nyheder')).toBe(true)
  })

  it('does not match a route that merely starts with the same characters', () => {
    expect(isCurrentRoute('/menukort', '/menu')).toBe(false)
  })
})
