import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CONFIRMED_CONTENT_FILE,
  CONTENT_MARKER,
  CONTENT_STATE_SQL,
  classifyContentState,
  contentBundle,
  parseContentState,
} from '../../../scripts/launch/lib/content.mjs'

/**
 * The confirmed-content load's rules — technical plan §10a, §10b; phase 14A.
 *
 * Four states from one row of facts, and a bundle that re-asserts "fresh" inside
 * the transaction it runs in. The harness suite (`tests/launch/content-load.test.ts`)
 * runs the bundle against the real database.
 */

const fresh = { categories: 0, dishes: 0, populated: false, markers: 0, markedAt: null }

describe('the four states', () => {
  it('fresh — untouched since the migrations', () => {
    expect(classifyContentState(fresh)).toBe('fresh')
  })

  it('loaded — a marker and content', () => {
    expect(classifyContentState({ ...fresh, categories: 9, dishes: 47, populated: true, markers: 1, markedAt: '2026-09-05' })).toBe('loaded')
  })

  it('operational — content and no marker: the administration owns it', () => {
    expect(classifyContentState({ ...fresh, categories: 9, dishes: 47, populated: true })).toBe('operational')
    // The contact row or the week alone is enough to be a live project.
    expect(classifyContentState({ ...fresh, populated: true })).toBe('operational')
  })

  it('inconsistent — a marker over empty tables', () => {
    expect(classifyContentState({ ...fresh, markers: 1 })).toBe('inconsistent')
  })

  it('parses the database’s one-row answer', () => {
    expect(parseContentState('{"categories":9,"dishes":47,"populated":true,"markers":1,"markedAt":"2026-09-05T10:00:00+00:00"}')).toEqual({
      categories: 9,
      dishes: 47,
      populated: true,
      markers: 1,
      markedAt: '2026-09-05T10:00:00+00:00',
    })
    expect(parseContentState('{"categories":0,"dishes":0,"populated":false,"markers":0,"markedAt":null}')).toEqual(fresh)
  })
})

describe('the bundle', () => {
  const sha = 'a'.repeat(64)

  it('is the guard, the confirmed file, then the marker — one transaction’s worth', () => {
    const bundle = contentBundle('update public.site_contact set city = null;\n', { sha256: sha, source: CONFIRMED_CONTENT_FILE })
    const guard = bundle.indexOf('KF_CONTENT_ALREADY_LOADED')
    const notFresh = bundle.indexOf('KF_CONTENT_NOT_FRESH')
    const content = bundle.indexOf('update public.site_contact set city = null;')
    const marker = bundle.indexOf(`'${CONTENT_MARKER.action}', '${CONTENT_MARKER.entity}'`)
    expect(guard).toBeGreaterThan(-1)
    expect(notFresh).toBeGreaterThan(guard)
    expect(content).toBeGreaterThan(notFresh)
    expect(marker).toBeGreaterThan(content)
    expect(bundle).toContain(`'sha256', '${sha}'`)
    expect(bundle).toContain(`'source', '${CONFIRMED_CONTENT_FILE}'`)
  })

  it('the guard inspects the tables the file populates', () => {
    const bundle = contentBundle('', { sha256: sha, source: CONFIRMED_CONTENT_FILE })
    for (const table of ['public.menu_categories', 'public.dishes', 'public.site_contact', 'public.opening_hours', 'public.audit_log']) {
      expect(bundle).toContain(table)
      expect(CONTENT_STATE_SQL).toContain(table)
    }
  })

  it('refuses a provenance it could not embed safely', () => {
    expect(() => contentBundle('', { sha256: 'not-a-digest', source: CONFIRMED_CONTENT_FILE })).toThrow(/sha256/)
    expect(() => contentBundle('', { sha256: sha, source: "x'; drop table y; --" })).toThrow(/plain path/)
  })

  it('the marker never names an actor', () => {
    const bundle = contentBundle('', { sha256: sha, source: CONFIRMED_CONTENT_FILE })
    expect(bundle).toMatch(/values \(null, 'content_load', 'launch', null, null/)
  })
})

describe('the confirmed file itself', () => {
  it('is the constant the loader reads, and it exists', () => {
    expect(CONFIRMED_CONTENT_FILE).toBe('supabase/seed/confirmed.sql')
    expect(readFileSync(CONFIRMED_CONTENT_FILE, 'utf8').length).toBeGreaterThan(1000)
  })
})
