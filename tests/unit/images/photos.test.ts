import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePhoto } from '@/lib/content/load/photo'
import { photoFilePath, photosDirectory } from '@/lib/images/manifest'
import { photoSlotFrom, photoSourceFrom } from '@/lib/images/photos'

/**
 * What a content file is allowed to name as a photograph.
 *
 * A stored `file` is untrusted input — it is whatever was written into a JSON file, by
 * hand or by a future CMS — so the grammar is the security boundary and a "safe
 * rename" upstream is not. These are the shapes that must never resolve to a file, and
 * the one shape that must.
 */

const WHERE = 'content/site/menu.json: dish "odin"'

describe('a valid photograph path', () => {
  it('is one plainly-named file in /photos/, and its name is its slot', () => {
    expect(photoSourceFrom('/photos/dish-odin.png', WHERE)).toEqual({
      slot: 'dish-odin',
      fileName: 'dish-odin.png',
      extension: 'png',
    })
    expect(photoSlotFrom('/photos/home-hero.jpg', WHERE)).toBe('home-hero')
    expect(photoSlotFrom('/photos/a1.jpeg', WHERE)).toBe('a1')
    expect(photoSlotFrom('/photos/en-lang-titel-2.webp', WHERE)).toBe('en-lang-titel-2')
  })
})

describe('what is refused, and why', () => {
  const refusals: readonly [string, unknown][] = [
    ['a traversal', '../secret.png'],
    ['a traversal dressed as a photo', '/photos/../../secret.png'],
    ['a traversal in the file name', '/photos/..%2Fsecret.png'],
    ['a nested path', '/photos/private/secret.png'],
    ['a Windows path', 'C:\\secret.png'],
    ['a backslash', '/photos/..\\secret.png'],
    ['a remote URL', 'https://example.test/image.jpg'],
    ['a protocol-relative URL', '//example.test/image.jpg'],
    ['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['an unsupported extension', '/photos/foo.svg'],
    ['an unprocessed original format', '/photos/foo.tiff'],
    ['no extension at all', '/photos/dish-odin'],
    ['a space in the name', '/photos/My Burger.png'],
    ['an upper-case name', '/photos/Dish-Odin.png'],
    ['an upper-case extension', '/photos/dish-odin.PNG'],
    ['an underscore', '/photos/dish_odin.png'],
    ['a second dot', '/photos/dish.odin.png'],
    ['a doubled hyphen', '/photos/dish--odin.png'],
    ['a leading hyphen', '/photos/-odin.png'],
    ['a query string', '/photos/dish-odin.png?v=2'],
    ['another directory', '/media/dish-odin/960.webp'],
    ['surrounding whitespace', ' /photos/dish-odin.png'],
    ['an empty name', '/photos/'],
    ['a number', 42],
    ['an object', { file: '/photos/dish-odin.png' }],
  ]

  for (const [why, value] of refusals) {
    it(`refuses ${why}, naming the content field`, () => {
      expect(() => photoSourceFrom(value, WHERE)).toThrow(TypeError)
      expect(() => photoSourceFrom(value, WHERE)).toThrow(WHERE)
    })
  }
})

describe('the filesystem is asked the same question again', () => {
  it('resolves a name inside public/photos/ and refuses one that would leave it', () => {
    const root = mkdtempSync(join(tmpdir(), 'photo-path-'))
    try {
      expect(photoFilePath(root, 'dish-odin.png')).toBe(
        join(photosDirectory(root), 'dish-odin.png'),
      )

      for (const escape of ['../secret.png', '..\\secret.png', 'sub/dish.png', '/etc/passwd']) {
        expect(() => photoFilePath(root, escape)).toThrow()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('resolvePhoto — the field as an editor fills it', () => {
  it('is null for every way of saying "this frame has no photograph"', () => {
    expect(resolvePhoto(null, WHERE)).toBeNull()
    expect(resolvePhoto(undefined, WHERE)).toBeNull()
    // A CMS that clears the file but leaves the object behind means the same thing.
    expect(resolvePhoto({ file: null, alt: '', focus: 'center' }, WHERE)).toBeNull()
    expect(resolvePhoto({ file: '', alt: '' }, WHERE)).toBeNull()
  })

  it('keeps the crop a closed vocabulary — no free-form object-position', () => {
    const centred = resolvePhoto({ file: '/photos/dish-odin.png', focus: 'center' }, WHERE)
    const upper = resolvePhoto({ file: '/photos/dish-frigg.png', focus: 'upper' }, WHERE)

    expect(centred?.focus).toBe('center')
    expect(upper?.focus).toBe('upper')
    // Absent is the default rather than an error: a field nobody has touched is centred.
    expect(resolvePhoto({ file: '/photos/dish-odin.png' }, WHERE)?.focus).toBe('center')

    for (const bad of ['50% 20%', 'top', 'UPPER', 'left bottom', 0]) {
      expect(() => resolvePhoto({ file: '/photos/dish-odin.png', focus: bad }, WHERE)).toThrow(WHERE)
    }
  })

  it('renders an empty or absent description as alt="" and invents nothing', () => {
    expect(resolvePhoto({ file: '/photos/dish-odin.png', alt: '' }, WHERE)?.alt).toBe('')
    expect(resolvePhoto({ file: '/photos/dish-odin.png' }, WHERE)?.alt).toBe('')
    expect(resolvePhoto({ file: '/photos/dish-odin.png', alt: '  ' }, WHERE)?.alt).toBe('')
    expect(resolvePhoto({ file: '/photos/dish-odin.png', alt: 'En burger.' }, WHERE)?.alt).toBe(
      'En burger.',
    )
  })

  it('refuses a photograph that is not in public/photos/, naming the field and the file', () => {
    expect(() => resolvePhoto({ file: '/photos/aldrig-uploadet.png' }, WHERE)).toThrow(WHERE)
    expect(() => resolvePhoto({ file: '/photos/aldrig-uploadet.png' }, WHERE)).toThrow(
      '/photos/aldrig-uploadet.png',
    )
  })

  it('refuses a photograph whose extension has changed under it', () => {
    // public/photos/ holds dish-odin.png; the content still names the .jpg it replaced.
    expect(() => resolvePhoto({ file: '/photos/dish-odin.jpg' }, WHERE)).toThrow('dish-odin.png')
  })

  it('measures the source rather than trusting a written-down size', () => {
    const odin = resolvePhoto({ file: '/photos/dish-odin.png' }, WHERE)

    // 1448×1086 on disk: the ladder stops at 1440 and the intrinsic size is that rung's.
    expect(odin?.width).toBe(1440)
    expect(odin?.height).toBe(1080)
    expect(odin?.candidates.map((candidate) => candidate.width)).toEqual([480, 960, 1440])
    expect(odin?.avifSrcSet).toContain('/media/dish-odin/1440.avif 1440w')
  })

  it('names nothing an editor has to maintain — no source path reaches the page', () => {
    const everything = JSON.stringify(resolvePhoto({ file: '/photos/home-hero.png' }, WHERE))

    expect(everything).not.toContain('/photos/')
    expect(everything).not.toContain('.png')
    expect(everything).not.toContain('public')
  })
})

describe('the manifest', () => {
  it('says what is missing when the prebuild step has not run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'photo-manifest-'))
    try {
      mkdirSync(photosDirectory(root), { recursive: true })
      writeFileSync(join(photosDirectory(root), 'dish-odin.png'), 'not read')

      const { readImageManifest } = await import('@/lib/images/manifest')
      expect(() => readImageManifest(root)).toThrow('generated/images.json')
      expect(() => readImageManifest(root)).toThrow('images:static')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
