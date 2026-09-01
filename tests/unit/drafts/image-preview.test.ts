import { describe, expect, it } from 'vitest'

import { overlayDraft } from '@/lib/drafts/overlay'
import { dishDraft } from '@/lib/schemas/menu'
import { monthlyBurgerDraft, weeklySpecialDraft } from '@/lib/schemas/specials'

/**
 * Draft Mode resolves pending images — phase 10C-1's read-model proof (brief §18).
 *
 * There is exactly one overlay in this system: `overlayDraft`, called with the
 * entity's own spec by the preview loaders, the admin reads and nothing else. So
 * "the preview sees the pending image" is a property of this function against
 * these specs — proved here for every §8 combination — and rendering that
 * resolved value into public `<img srcset>` markup is deliberately not built:
 * that is phase 10C-2's scope, together with the public read-model projection
 * and the cache coupling. The boundary is recorded in the technical plan.
 */

const IMAGE_A = '11111111-1111-4111-8111-111111111111'
const IMAGE_B = '22222222-2222-4222-8222-222222222222'

const CASES = [
  ['a dish', dishDraft],
  ['Ugens ret', weeklySpecialDraft],
  ['Månedens burger', monthlyBurgerDraft],
] as const

describe.each(CASES)('the pending image resolves for %s', (_label, spec) => {
  it('live A with pending B previews as B, and the guest row stays A', () => {
    const live = { image_id: IMAGE_A, name: 'Odin' }
    const overlaid = overlayDraft(live, { image_id: IMAGE_B }, spec)

    expect(overlaid.row.image_id).toBe(IMAGE_B)
    expect(overlaid.changedFields).toContain('image_id')
    // The base object is untouched: the public read without Draft Mode never
    // applies the overlay, so what a guest sees is the live value by construction.
    expect(live.image_id).toBe(IMAGE_A)
  })

  it('live A with a pending removal previews as none (brief §8)', () => {
    const overlaid = overlayDraft({ image_id: IMAGE_A }, { image_id: null }, spec)

    expect(overlaid.row.image_id).toBeNull()
    expect(overlaid.changedFields).toContain('image_id')
  })

  it('live null with pending B previews as B', () => {
    const overlaid = overlayDraft({ image_id: null }, { image_id: IMAGE_B }, spec)

    expect(overlaid.row.image_id).toBe(IMAGE_B)
  })

  it('a draft that says nothing about the image leaves the live value alone', () => {
    const overlaid = overlayDraft({ image_id: IMAGE_A }, { name: 'Ny titel' }, spec)

    expect(overlaid.row.image_id).toBe(IMAGE_A)
    expect(overlaid.changedFields).not.toContain('image_id')
  })
})
