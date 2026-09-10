import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'

import { IMAGE_MANIFEST_PATH, photosDirectory } from '@/lib/images/manifest'

/**
 * `scripts/images/build-static-derivatives.mjs`, run over small trees.
 *
 * The script is the only thing that reads `public/photos/`, and it is what makes the
 * directory usable as a registry: it measures every source, refuses the ones that
 * cannot be one, renders the ladder, and reconciles the output so a page can never be
 * served a derivative of a photograph that no longer exists.
 *
 * Each case is a temporary tree with nothing but the photographs it is about, so a
 * refusal is provably about that tree and not about the repository's own content.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'images', 'build-static-derivatives.mjs')

const trees: string[] = []

afterAll(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true })
})

/** A tree with `public/photos/` and the given files in it. */
async function tree(files: Record<string, Buffer | string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'static-images-'))
  trees.push(root)
  mkdirSync(photosDirectory(root), { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(photosDirectory(root), name), contents)
  }
  return root
}

/** A real PNG of the given size — the pixels are irrelevant, the dimensions are not. */
function picture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 90, b: 40 } },
  })
    .png()
    .toBuffer()
}

function run(root: string): { code: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, output: stdout }
  } catch (error) {
    const failure = error as { status: number | null; stdout: string; stderr: string }
    return { code: failure.status ?? 1, output: `${failure.stdout}${failure.stderr}` }
  }
}

function manifestOf(root: string): Record<string, { file: string; width: number; height: number }> {
  const parsed = JSON.parse(readFileSync(join(root, ...IMAGE_MANIFEST_PATH.split('/')), 'utf8'))
  return parsed.photos
}

describe('measuring the sources', () => {
  it('records what sharp measures — nobody writes a width down', async () => {
    const root = await tree({
      'dish-odin.png': await picture(1448, 1086),
      'home-hero.png': await picture(1024, 1536),
    })

    const result = run(root)
    expect(result.code, result.output).toBe(0)

    expect(manifestOf(root)).toEqual({
      'dish-odin': { file: 'dish-odin.png', width: 1448, height: 1086 },
      'home-hero': { file: 'home-hero.png', width: 1024, height: 1536 },
    })

    // The ladder is the planned one, in both formats, and nothing was upscaled.
    for (const width of [480, 960, 1440]) {
      for (const format of ['avif', 'webp']) {
        expect(existsSync(join(root, 'public', 'media', 'dish-odin', `${width}.${format}`))).toBe(true)
      }
    }
    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '2160.avif'))).toBe(false)
    expect(existsSync(join(root, 'public', 'media', 'home-hero', '1440.webp'))).toBe(false)
  })

  it('refuses a file it cannot read as an image, naming it', async () => {
    const root = await tree({ 'dish-odin.png': 'this is not a PNG' })

    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.output).toContain('dish-odin.png')
    expect(result.output).toContain('could not be read as an image')
    expect(existsSync(join(root, ...IMAGE_MANIFEST_PATH.split('/')))).toBe(false)
  })
})

describe('what may be in public/photos/', () => {
  const unusable = [
    ['a space in the name', 'My Burger.png'],
    ['an upper-case name', 'Dish-Odin.png'],
    ['an underscore', 'dish_odin.png'],
    ['an unsupported extension', 'dish-odin.svg'],
    ['no extension', 'dish-odin'],
  ] as const

  for (const [why, name] of unusable) {
    it(`refuses ${why} rather than skipping it`, async () => {
      const root = await tree({ [name]: await picture(600, 400) })

      const result = run(root)
      expect(result.code, result.output).toBe(1)
      expect(result.output).toContain(name)
    })
  }

  it('refuses two sources that would claim one slot', async () => {
    const root = await tree({
      'dish-odin.png': await picture(600, 400),
      'dish-odin.jpg': await sharp(await picture(600, 400)).jpeg().toBuffer(),
    })

    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.output).toContain('dish-odin.jpg')
    expect(result.output).toContain('dish-odin.png')
    expect(result.output).toContain('dish-odin')
  })
})

describe('reconciling public/media/', () => {
  it('removes the folder of a photograph that no longer exists', async () => {
    const root = await tree({ 'dish-odin.png': await picture(600, 400) })

    // An earlier build's output, for a photograph nothing selects any more.
    const stale = join(root, 'public', 'media', 'dish-thor')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, '480.webp'), 'stale')
    writeFileSync(join(root, 'public', 'media', 'stray.txt'), 'stale')

    const result = run(root)
    expect(result.code, result.output).toBe(0)

    expect(existsSync(stale)).toBe(false)
    expect(existsSync(join(root, 'public', 'media', 'stray.txt'))).toBe(false)
    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '480.webp'))).toBe(true)
    expect(manifestOf(root)['dish-thor']).toBeUndefined()
  })

  it('removes a rung a replaced photograph no longer plans', async () => {
    const root = await tree({ 'dish-odin.png': await picture(1448, 1086) })
    expect(run(root).code).toBe(0)
    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '1440.webp'))).toBe(true)

    // The editor replaces it with a smaller photograph under the same name.
    writeFileSync(join(photosDirectory(root), 'dish-odin.png'), await picture(700, 525))
    const result = run(root)
    expect(result.code, result.output).toBe(0)

    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '1440.webp'))).toBe(false)
    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '960.avif'))).toBe(false)
    expect(existsSync(join(root, 'public', 'media', 'dish-odin', '480.webp'))).toBe(true)
    expect(manifestOf(root)['dish-odin']).toEqual({ file: 'dish-odin.png', width: 700, height: 525 })
  })

  it('is idempotent — a second run writes nothing and removes nothing', async () => {
    const root = await tree({ 'dish-odin.png': await picture(600, 400) })
    expect(run(root).code).toBe(0)

    const again = run(root)
    expect(again.code, again.output).toBe(0)
    expect(again.output).toContain('0 derivative(s) written')
    expect(again.output).toContain('0 stale entr(ies) removed')
  })
})
