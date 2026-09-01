import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  planClientDownscale,
  CLIENT_ENCODE_QUALITY,
} from '@/lib/images/client-upload'

/**
 * The browser-side upload preparation — technical plan §1 (adjustments 2 and 3);
 * phase 10A.
 *
 * The pure planning is tested directly. The DOM half (createImageBitmap, canvas,
 * fetch) cannot run in this repository's node test environment — there is
 * deliberately no jsdom (docs/dependencies.md, phase 7A) — so, exactly as
 * `expiry-guard-source.test.ts` established, its load-bearing properties are
 * asserted over the module's own source: orientation is preserved, the PUT goes
 * only to the URL the server minted, and no Supabase client, key or storage-URL
 * construction exists in the browser half.
 */

describe('planClientDownscale', () => {
  it('passes a phone-sized image through untouched', () => {
    expect(planClientDownscale(2560, 1920)).toBeNull()
    expect(planClientDownscale(800, 600)).toBeNull()
    expect(planClientDownscale(1, 1)).toBeNull()
  })

  it('scales the longest side to 2560 and preserves the aspect', () => {
    expect(planClientDownscale(5120, 3840)).toEqual({ width: 2560, height: 1920 })
    expect(planClientDownscale(3840, 5120)).toEqual({ width: 1920, height: 2560 })
    expect(planClientDownscale(4000, 3000)).toEqual({ width: 2560, height: 1920 })
  })

  it('rounds rather than truncates, and never reaches zero', () => {
    expect(planClientDownscale(4032, 3024)).toEqual({ width: 2560, height: 1920 })
    expect(planClientDownscale(100000, 3)).toEqual({ width: 2560, height: 1 })
  })

  it('honours an explicit bound (the parameter exists for tests, not callers)', () => {
    expect(planClientDownscale(200, 100, 100)).toEqual({ width: 100, height: 50 })
  })

  it('re-encodes at a quality that keeps food photos looking like food', () => {
    expect(CLIENT_ENCODE_QUALITY).toBe(0.85)
  })
})

describe('the DOM half, held to its properties by source assertion', () => {
  const source = readFileSync(
    join(process.cwd(), 'lib', 'images', 'client-upload.ts'),
    'utf8',
  )
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('preserves orientation by decoding with imageOrientation from-image', () => {
    expect(code).toContain("imageOrientation: 'from-image'")
  })

  it('PUTs to the handed URL and composes no storage URL of its own', () => {
    expect(code).toContain("method: 'PUT'")
    expect(code).not.toContain('/storage/v1/')
    expect(code).not.toContain('NEXT_PUBLIC_')
  })

  it('never overwrites: the signed target is single-use', () => {
    expect(code).toContain("'x-upsert': 'false'")
  })

  it('holds no Supabase client, no secret and no storage of its own', () => {
    expect(code).not.toMatch(/@supabase\//)
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
    expect(code).not.toMatch(/service|SERVICE_ROLE/i)
  })

  it('is a library module, not a component — 10B decides what mounts it', () => {
    expect(source).not.toMatch(/^\s*['"]use client['"]/m)
  })
})
