import { describe, expect, it } from 'vitest'

import { mapEmbedUrl } from '@/lib/site/map-embed'

const ADDRESS = {
  addressLine1: 'Lumbyvej 62',
  postalCode: '5792',
  city: 'Nørre Lyndelse',
}

describe('mapEmbedUrl', () => {
  it('falls back to the keyless embed when no API key is configured', () => {
    expect(mapEmbedUrl(ADDRESS, undefined)).toBe(
      'https://www.google.com/maps?q=Lumbyvej%2062%2C%205792%20N%C3%B8rre%20Lyndelse&output=embed',
    )
  })

  it('uses the Maps Embed API once a key is set', () => {
    expect(mapEmbedUrl(ADDRESS, 'fixture-key')).toBe(
      'https://www.google.com/maps/embed/v1/place?key=fixture-key&q=Lumbyvej%2062%2C%205792%20N%C3%B8rre%20Lyndelse',
    )
  })

  it('encodes the address and the key, so neither can break out of the query', () => {
    const url = mapEmbedUrl({ ...ADDRESS, city: 'Nørre & Lyndelse' }, 'fixture&key')
    expect(url).toContain('N%C3%B8rre%20%26%20Lyndelse')
    expect(url).toContain('key=fixture%26key')
  })

  it('reads GOOGLE_MAPS_EMBED_API_KEY when no key is passed explicitly', () => {
    const original = process.env.GOOGLE_MAPS_EMBED_API_KEY
    try {
      process.env.GOOGLE_MAPS_EMBED_API_KEY = 'env-key'
      expect(mapEmbedUrl(ADDRESS)).toContain('key=env-key')
    } finally {
      if (original === undefined) delete process.env.GOOGLE_MAPS_EMBED_API_KEY
      else process.env.GOOGLE_MAPS_EMBED_API_KEY = original
    }
  })
})
