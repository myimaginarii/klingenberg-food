import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { MAP_ASSET, MAP_LICENCE_FILE } from '@/lib/site/map-asset'
import {
  PLACEHOLDER_PROVENANCE,
  REQUIRED_PROVENANCE_ROWS,
  assertLaunchMapProvenance,
  assessMapProvenance,
  parseMapProvenance,
} from '@/lib/site/map-launch-guard'

/**
 * The launch map guard — technical plan §7g, §13 item C; phase 14A.
 *
 * The placeholder is refused in exactly one place: a Vercel production build.
 * Local development, the local production certification build, CI and every
 * preview stay green with it. The "licensed" fixture below is a temporary text
 * assembled here to prove the accepting path; it claims nothing about a real
 * map and commits no asset.
 */

const REAL_LICENCE = readFileSync(MAP_LICENCE_FILE, 'utf8')

/** A complete record for a hypothetical licensed asset — a test fixture, not a claim. */
const FIXTURE_LICENCE = `# Static map asset — provenance

| Field | Value |
|---|---|
| **Provenance** | \`fixture-map-provider\` |
| File | klingenberg-food.webp |
| Dimensions | 1200 × 900 (4:3) |
| Source | A fixture for the guard's own test. |
| Licence | Fixture licence, no claim. |
| Attribution required | No. |
| Recorded | 2026-09-05 (fixture) |
`

describe('parsing the provenance record', () => {
  it('reads the repository’s own licence table', () => {
    const rows = parseMapProvenance(REAL_LICENCE)
    expect(rows['Provenance']).toBe(PLACEHOLDER_PROVENANCE)
    expect(rows['File']).toBe('klingenberg-food-placeholder.svg')
    for (const row of REQUIRED_PROVENANCE_ROWS) expect(rows[row], row).toBeTruthy()
  })

  it('reads bold and plain field names alike, without backticks', () => {
    const rows = parseMapProvenance(FIXTURE_LICENCE)
    expect(rows['Provenance']).toBe('fixture-map-provider')
    expect(rows['File']).toBe('klingenberg-food.webp')
    expect(rows['Field']).toBeUndefined()
  })
})

describe('where the placeholder is allowed', () => {
  const placeholder = { licence: REAL_LICENCE, assetSrc: MAP_ASSET.src, assetExists: true }

  it('local development', () => {
    expect(assessMapProvenance({ ...placeholder, vercelEnv: undefined })).toMatchObject({ launch: false, ok: true })
  })

  it('a local NODE_ENV=production certification build — no Vercel signal', () => {
    expect(assessMapProvenance({ ...placeholder, vercelEnv: undefined }).ok).toBe(true)
  })

  it('a Vercel preview build, and a Vercel development build', () => {
    expect(assessMapProvenance({ ...placeholder, vercelEnv: 'preview' }).ok).toBe(true)
    expect(assessMapProvenance({ ...placeholder, vercelEnv: 'development' }).ok).toBe(true)
  })

  it('the repository’s real record and descriptor pass everywhere but production, today', () => {
    expect(assertLaunchMapProvenance({ env: {} }).ok).toBe(true)
    expect(assertLaunchMapProvenance({ env: { VERCEL: '1', VERCEL_ENV: 'preview' } }).ok).toBe(true)
  })
})

describe('a Vercel production build', () => {
  it('refuses the repository’s current placeholder, naming every reason', () => {
    const result = assessMapProvenance({ licence: REAL_LICENCE, assetSrc: MAP_ASSET.src, vercelEnv: 'production', assetExists: true })
    expect(result.launch).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toMatch(/records the provenance "placeholder"/)
    expect(result.reasons.join('\n')).toMatch(/still renders the placeholder asset/)
  })

  it('refuses through the build-time entry point with a message that says what to do', () => {
    expect(() => assertLaunchMapProvenance({ env: { VERCEL: '1', VERCEL_ENV: 'production' } })).toThrow(/Vercel PRODUCTION build[\s\S]*phase 14B/)
  })

  it('accepts a complete provenance record for a non-placeholder asset that exists', () => {
    const result = assessMapProvenance({ licence: FIXTURE_LICENCE, assetSrc: '/map/klingenberg-food.webp', vercelEnv: 'production', assetExists: true })
    expect(result).toMatchObject({ launch: true, ok: true, provenance: 'fixture-map-provider', reasons: [] })
  })

  it('refuses a record with a missing row, a mismatched file name, or a missing asset', () => {
    const missingRow = FIXTURE_LICENCE.replace(/\| Licence \|.*\n/, '')
    expect(assessMapProvenance({ licence: missingRow, assetSrc: '/map/klingenberg-food.webp', vercelEnv: 'production', assetExists: true }).reasons.join(' ')).toMatch(/no \*\*Licence\*\* row/)

    const mismatch = assessMapProvenance({ licence: FIXTURE_LICENCE, assetSrc: '/map/other.webp', vercelEnv: 'production', assetExists: true })
    expect(mismatch.reasons.join(' ')).toMatch(/names the file "klingenberg-food.webp" but the map descriptor renders "other.webp"/)

    const absent = assessMapProvenance({ licence: FIXTURE_LICENCE, assetSrc: '/map/klingenberg-food.webp', vercelEnv: 'production', assetExists: false })
    expect(absent.reasons.join(' ')).toMatch(/does not exist/)

    expect(assessMapProvenance({ licence: null, assetSrc: '/map/klingenberg-food.webp', vercelEnv: 'production', assetExists: true }).reasons.join(' ')).toMatch(/missing/)
  })

  it('a placeholder asset path is refused even under a non-placeholder provenance', () => {
    const result = assessMapProvenance({ licence: FIXTURE_LICENCE.replace('klingenberg-food.webp', 'klingenberg-food-placeholder.svg'), assetSrc: MAP_ASSET.src, vercelEnv: 'production', assetExists: true })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/placeholder asset/)
  })
})
