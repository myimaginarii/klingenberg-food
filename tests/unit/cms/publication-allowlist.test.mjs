import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  composePublication,
  publicationPathProblem,
  PUBLICATION_ROOTS,
} from '../../../scripts/cms/compose-publication.mjs'
import {
  EXTERNAL_CONTENT_BRANCH,
  EXTERNAL_CONTENT_REF,
} from '../../../scripts/cms/publication-source.mjs'

/**
 * `scripts/cms/compose-publication.mjs` — the boundary between trusted code and
 * owner-authored content, exercised over real git repositories.
 *
 * Each test builds a throwaway repository with two branches: `main`, standing in for
 * the production code, and `content`, standing in for what Pages CMS wrote. A
 * publication is then composed into a *clone* of that repository checked out at `main`
 * — the same two things a future workflow will have, a checkout of main and a content
 * ref to read — so the real repository is never involved and nothing here depends on
 * the machine's own checkout.
 *
 * WHY THIS SUITE IS `.mjs` while the other script suites are `.ts`. They only run
 * their script as a subprocess; this one does that *and* calls two of its exported
 * functions directly. The path-safety check has to be called directly, because git
 * itself refuses to store a path containing `..` or an absolute path (asserted below),
 * so no fixture branch can carry one — the check is a second lock on a door git already
 * holds shut, and a lock is tested by turning it. The `.test.mjs` pattern is one
 * `vitest.config.mts` already includes.
 *
 * THE FIXTURES SET `core.autocrlf=true` ON PURPOSE. It is the setting this project is
 * developed under, and it is what makes byte preservation a claim rather than a
 * coincidence: with it, git writes CRLF into the working tree for every text file it
 * checks out, so a composer that copied files out of a checkout would rewrite every
 * line of every CMS file it published. The suite asserts both halves — main's files
 * arrive with CRLF, the published content keeps its LF bytes.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'cms', 'compose-publication.mjs')

/** Stands in for production code and configuration: the trusted side of the boundary. */
const MAIN = {
  'content/site/hours.json': '{ "weekly": [] }\n',
  'content/site/menu.json': '{ "sections": [] }\n',
  'content/site/news/.gitkeep': '',
  'content/site/news/aabent-i-paasken.json': '{ "title": "Åbent i påsken" }\n',
  'public/photos/home-hero.png': 'png-bytes-home-hero',
  'public/photos/dish-odin.png': 'png-bytes-dish-odin',
  '.pages.yml': 'media:\n  - name: photos\n',
  '.github/workflows/ci.yml': 'name: CI\n',
  'content/launch/copy.md': '# Launch copy\n',
  'public/brand/seal.svg': '<svg role="img"></svg>\n',
  'public/media/dish-odin/640.webp': 'a build product, never an input',
  'app/page.tsx': 'export default function Page() {\n  return null\n}\n',
  'package.json': '{ "name": "fixture" }\n',
  'scripts/build.mjs': 'process.exit(0)\n',
  'tests/unit/example.test.ts': 'export {}\n',
}

const temporary = []

function git(repo, args, env = undefined) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function scratch(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

function write(root, path, contents) {
  mkdirSync(join(root, dirname(path)), { recursive: true })
  writeFileSync(join(root, path), contents)
}

/**
 * A repository whose `main` holds {@link MAIN} and whose `content` holds `MAIN` plus
 * `edits` — a value of `null` deleting that path.
 */
function fixture(edits = {}) {
  const root = scratch('publication-')

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'fixture@example.test'])
  git(root, ['config', 'user.name', 'Fixture'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['config', 'core.autocrlf', 'true'])

  for (const [path, contents] of Object.entries(MAIN)) write(root, path, contents)
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'main'])

  git(root, ['checkout', '-qb', 'content'])
  for (const [path, contents] of Object.entries(edits)) {
    if (contents === null) git(root, ['rm', '-q', '--', path])
    else write(root, path, contents)
  }
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'content', '--allow-empty'])

  // Leave HEAD on main: the content branch must not be the checked-out one, or git
  // will not let `addSymlinkEntry` move it.
  git(root, ['checkout', '-q', 'main'])
  return root
}

/** A clean working tree at `main`, written by git itself — the publication target. */
function checkoutOfMain(root) {
  const tree = scratch('publication-tree-')
  execFileSync('git', ['-c', 'core.autocrlf=true', 'clone', '-q', '--branch', 'main', root, tree], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // The clone was *written* with the conversion; the setting has to be recorded in the
  // clone as well, or a machine whose global config differs reads its own checkout as
  // modified. Without this the fixture, not the composer, is what fails.
  git(tree, ['config', 'core.autocrlf', 'true'])
  return tree
}

afterAll(() => {
  for (const directory of temporary) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
  }
})

/**
 * One extra commit on `content` carrying a tree entry at a mode this machine's working
 * tree may not be able to hold — a symbolic link (120000), or an executable (100755),
 * neither of which a Windows checkout records. It is written through a scratch index so
 * the fixture's own index and checkout stay untouched, which is both how an untrusted
 * branch would offer one and what a Linux runner's checkout would materialise.
 *
 * `contents` is hashed into a blob, except for a gitlink (160000), which points at a
 * commit: pass `null` and the fixture's own `main` commit is used.
 */
function addTreeEntry(root, mode, path, contents) {
  const oid =
    contents === null
      ? git(root, ['rev-parse', 'main']).trim()
      : execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], {
          input: contents,
          encoding: 'utf8',
        }).trim()

  const env = { ...process.env, GIT_INDEX_FILE: join(scratch('publication-index-'), 'index') }

  git(root, ['read-tree', 'content'], env)
  git(root, ['update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`], env)
  const tree = git(root, ['write-tree'], env).trim()
  const commit = git(root, ['commit-tree', tree, '-p', 'content', '-m', 'hostile'], env).trim()
  git(root, ['branch', '-f', 'content', commit])
}

/**
 * The composer's CLI over a fixture, returning the working tree it published into.
 * `--into` is always given: a test that proves nothing was written needs the write to
 * have been attempted.
 */
function publish(root, contentRef = 'content') {
  const tree = checkoutOfMain(root)
  const args = [SCRIPT, '--repo', root, '--main', 'main', '--content', contentRef, '--into', tree]

  try {
    return { code: 0, output: execFileSync(process.execPath, args, { encoding: 'utf8' }), tree }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout}${error.stderr}`, tree }
  }
}

/** The paths the report says the publication changes. */
function changedPaths(output) {
  return [...output.matchAll(/^[ADM] {2}(.+)$/gm)].map((match) => match[1])
}

/** What is on disk after a publication, as bytes — never decoded, never normalised. */
function bytes(tree, path) {
  return readFileSync(join(tree, path))
}

/** The same file as text, with the checkout's line endings folded back to LF. */
function text(tree, path) {
  return bytes(tree, path).toString().replace(/\r\n/g, '\n')
}

function exists(tree, path) {
  try {
    bytes(tree, path)
    return true
  } catch {
    return false
  }
}

describe('the publication snapshot', () => {
  it('copies an ordinary content edit', () => {
    const { code, output, tree } = publish(
      fixture({ 'content/site/hours.json': '{ "weekly": ["mandag"] }\n' }),
    )

    expect(code).toBe(0)
    expect(changedPaths(output)).toEqual(['content/site/hours.json'])
    expect(bytes(tree, 'content/site/hours.json').toString()).toBe('{ "weekly": ["mandag"] }\n')
  })

  it('copies a new news article', () => {
    const { code, output, tree } = publish(
      fixture({ 'content/site/news/nyt-koekken.json': '{ "title": "Nyt køkken" }\n' }),
    )

    expect(code).toBe(0)
    expect(output).toContain('A  content/site/news/nyt-koekken.json')
    expect(bytes(tree, 'content/site/news/nyt-koekken.json').toString()).toBe(
      '{ "title": "Nyt køkken" }\n',
    )
  })

  it('makes a deleted news article disappear', () => {
    const { code, output, tree } = publish(
      fixture({ 'content/site/news/aabent-i-paasken.json': null }),
    )

    expect(code).toBe(0)
    expect(output).toContain('D  content/site/news/aabent-i-paasken.json')
    expect(exists(tree, 'content/site/news/aabent-i-paasken.json')).toBe(false)
  })

  it('removes the old file name when an article is renamed', () => {
    const { code, output, tree } = publish(
      fixture({
        'content/site/news/aabent-i-paasken.json': null,
        'content/site/news/aabent-hele-paasken.json': '{ "title": "Åbent hele påsken" }\n',
      }),
    )

    expect(code).toBe(0)
    expect(changedPaths(output).sort()).toEqual([
      'content/site/news/aabent-hele-paasken.json',
      'content/site/news/aabent-i-paasken.json',
    ])
    expect(exists(tree, 'content/site/news/aabent-i-paasken.json')).toBe(false)
    expect(exists(tree, 'content/site/news/aabent-hele-paasken.json')).toBe(true)
  })

  it('copies a new photograph', () => {
    const { code, output, tree } = publish(
      fixture({ 'public/photos/dish-frigg.png': 'png-bytes-dish-frigg' }),
    )

    expect(code).toBe(0)
    expect(output).toContain('A  public/photos/dish-frigg.png')
    expect(bytes(tree, 'public/photos/dish-frigg.png').toString()).toBe('png-bytes-dish-frigg')
  })

  it('makes a deleted photograph disappear, and leaves its derivatives to the build', () => {
    const { code, output, tree } = publish(fixture({ 'public/photos/dish-odin.png': null }))

    expect(code).toBe(0)
    expect(changedPaths(output)).toEqual(['public/photos/dish-odin.png'])
    expect(exists(tree, 'public/photos/dish-odin.png')).toBe(false)
    // `public/media/` is a build product of the sources and never a publication input:
    // the image build reconciles it, and this script must not have touched it.
    expect(exists(tree, 'public/media/dish-odin/640.webp')).toBe(true)
  })

  it('preserves the CMS bytes exactly, including the absent trailing newline', () => {
    // What Pages CMS does to a file it has not changed semantically: its own indent,
    // its own key order, no final newline.
    const rewritten = '{\n  "sections": [],\n  "dishes": []\n}'
    const { code, tree } = publish(fixture({ 'content/site/menu.json': rewritten }))

    expect(code).toBe(0)

    const published = bytes(tree, 'content/site/menu.json')
    expect(published.toString()).toBe(rewritten)
    expect(published.includes(0x0d)).toBe(false)
    // The same checkout, for a file that came from main: git converted its line
    // endings, which is precisely what the published bytes escaped.
    expect(bytes(tree, 'app/page.tsx').includes(0x0d)).toBe(true)
  })

  it('reports nothing to publish, and touches nothing, when content matches main', () => {
    const { code, output, tree } = publish(
      fixture({ '.pages.yml': 'media:\n  - name: photos\n  - name: brand\n' }),
    )

    expect(code).toBe(0)
    expect(output).toContain('Nothing to publish')
    expect(output).toContain('left untouched')
    expect(changedPaths(output)).toEqual([])
    expect(git(tree, ['status', '--porcelain'])).toBe('')
  })
})

describe('what may not cross the boundary', () => {
  /** Every path outside the two roots is exactly as `main` has it after a publication. */
  function assertTrustedTreeUntouched(tree) {
    for (const [path, contents] of Object.entries(MAIN)) {
      if (PUBLICATION_ROOTS.some((prefix) => path.startsWith(`${prefix}/`))) continue
      expect(text(tree, path), path).toBe(contents)
    }
  }

  /** Every path the report claims to change lies inside an allow-listed root. */
  function assertOnlyRootsChanged(output) {
    for (const path of changedPaths(output)) {
      expect(
        PUBLICATION_ROOTS.some((root) => path.startsWith(`${root}/`)),
        path,
      ).toBe(true)
    }
  }

  it('never publishes .pages.yml', () => {
    const { code, output, tree } = publish(
      fixture({
        '.pages.yml': 'media:\n  - name: everything\n',
        'content/site/hours.json': '{ "weekly": ["tirsdag"] }\n',
      }),
    )

    expect(code).toBe(0)
    expect(output).not.toContain('.pages.yml')
    assertOnlyRootsChanged(output)
    assertTrustedTreeUntouched(tree)
  })

  it('cannot publish a workflow file', () => {
    const { code, output, tree } = publish(
      fixture({
        '.github/workflows/ci.yml': 'name: CI\non: push\njobs: {}\n',
        '.github/workflows/exfiltrate.yml': 'name: new\n',
        'content/site/hours.json': '{ "weekly": ["onsdag"] }\n',
      }),
    )

    expect(code).toBe(0)
    expect(output).not.toContain('.github')
    expect(exists(tree, '.github/workflows/exfiltrate.yml')).toBe(false)
    assertOnlyRootsChanged(output)
    assertTrustedTreeUntouched(tree)
  })

  it('cannot publish content/launch', () => {
    const { code, output, tree } = publish(
      fixture({
        'content/launch/copy.md': '# Rewritten\n',
        'content/launch/extra.md': '# New\n',
        'content/site/hours.json': '{ "weekly": ["torsdag"] }\n',
      }),
    )

    expect(code).toBe(0)
    expect(output).not.toContain('content/launch')
    expect(exists(tree, 'content/launch/extra.md')).toBe(false)
    assertOnlyRootsChanged(output)
    assertTrustedTreeUntouched(tree)
  })

  it('cannot publish public/brand', () => {
    const { code, output, tree } = publish(
      fixture({
        'public/brand/seal.svg': '<svg role="img" aria-hidden="true"></svg>\n',
        'public/brand/extra.svg': '<svg></svg>\n',
        'content/site/hours.json': '{ "weekly": ["fredag"] }\n',
      }),
    )

    expect(code).toBe(0)
    expect(output).not.toContain('public/brand')
    expect(exists(tree, 'public/brand/extra.svg')).toBe(false)
    assertOnlyRootsChanged(output)
    assertTrustedTreeUntouched(tree)
  })

  it('cannot publish application code, scripts, tests, package.json or public/media', () => {
    const { code, output, tree } = publish(
      fixture({
        'app/page.tsx': 'export default function Page() {\n  return null\n}\n\n',
        'scripts/build.mjs': 'process.exit(1)\n',
        'tests/unit/example.test.ts': 'export const hostile = 1\n',
        'package.json': '{ "name": "fixture", "scripts": { "prebuild": "hostile" } }\n',
        'public/media/dish-odin/640.webp': 'a replaced derivative',
        'content/site/hours.json': '{ "weekly": ["lørdag"] }\n',
      }),
    )

    expect(code).toBe(0)
    expect(changedPaths(output)).toEqual(['content/site/hours.json'])
    assertTrustedTreeUntouched(tree)
  })

  it('refuses the whole publication when a symbolic link is offered', () => {
    const root = fixture({ 'content/site/hours.json': '{ "weekly": ["søndag"] }\n' })
    addTreeEntry(root, '120000', 'content/site/news/link.json', '../../../.github/workflows/ci.yml')

    const { code, output, tree } = publish(root)

    expect(code).toBe(1)
    expect(output).toContain('content/site/news/link.json')
    expect(output).toContain('symbolic link')
    // Fail closed: the valid edit in the same commit is not published either.
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
    expect(exists(tree, 'content/site/news/link.json')).toBe(false)
  })

  it('refuses the whole publication when an executable file is offered', () => {
    // Nothing a CMS writes into these two directories is executable, and the composer
    // could not honour the bit if it were: `applyPublication` writes blobs with
    // `writeFileSync`, so an accepted 100755 would leave the composed tree and the
    // checkout disagreeing about the same file.
    const root = fixture({ 'content/site/hours.json': '{ "weekly": ["søndag"] }\n' })
    addTreeEntry(root, '100755', 'content/site/menu.json', '{ "sections": ["hostile"] }\n')

    const { code, output, tree } = publish(root)

    expect(code).toBe(1)
    expect(output).toContain('content/site/menu.json')
    expect(output).toContain('executable')
    // Fail closed, exactly as for a symbolic link: the valid edit beside it in the same
    // commit is not published, and the hostile file itself never reaches the tree.
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
    expect(text(tree, 'content/site/menu.json')).toBe(MAIN['content/site/menu.json'])
  })

  it('refuses the whole publication when a submodule is offered', () => {
    // A gitlink points at a commit, so the fixture hands one over rather than hashing a
    // blob: the entry has to be the shape git actually stores for a submodule.
    const root = fixture({ 'content/site/hours.json': '{ "weekly": ["søndag"] }\n' })
    addTreeEntry(root, '160000', 'public/photos/vendor', null)

    const { code, output, tree } = publish(root)

    expect(code).toBe(1)
    expect(output).toContain('public/photos/vendor')
    expect(output).toContain('submodule')
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
    expect(exists(tree, 'public/photos/vendor')).toBe(false)
  })

  it('refuses a photograph whose name is not a photograph, and publishes nothing', () => {
    const { code, output, tree } = publish(
      fixture({
        'public/photos/tracker.svg': '<svg onload="fetch(1)"></svg>\n',
        'content/site/hours.json': '{ "weekly": ["mandag"] }\n',
      }),
    )

    expect(code).toBe(1)
    expect(output).toContain('public/photos/tracker.svg')
    expect(exists(tree, 'public/photos/tracker.svg')).toBe(false)
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
  })

  it('refuses a photograph hidden in a subdirectory, and publishes nothing', () => {
    const { code, output, tree } = publish(
      fixture({
        'public/photos/archive/old-hero.png': 'png-bytes-archived',
        'content/site/hours.json': '{ "weekly": ["tirsdag"] }\n',
      }),
    )

    expect(code).toBe(1)
    expect(output).toContain('public/photos/archive/old-hero.png')
    expect(exists(tree, 'public/photos/archive/old-hero.png')).toBe(false)
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
  })

  it('refuses a news file whose name is not a slug, and publishes nothing', () => {
    const { code, output, tree } = publish(
      fixture({
        'content/site/news/Nyt Køkken.json': '{ "title": "Nyt køkken" }\n',
        'content/site/hours.json': '{ "weekly": ["mandag"] }\n',
      }),
    )

    expect(code).toBe(1)
    expect(output).toContain('content/site/news/Nyt Køkken.json')
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
  })

  it('keeps a tracked .gitkeep and refuses every other dotfile', () => {
    const kept = publish(
      fixture({
        'content/site/news/aabent-i-paasken.json': null,
        'content/site/news/nyt.json': '{ "title": "Nyt" }\n',
      }),
    )

    expect(kept.code).toBe(0)
    expect(exists(kept.tree, 'content/site/news/.gitkeep')).toBe(true)

    const refused = publish(fixture({ 'content/site/.gitattributes': '*.json text eol=crlf\n' }))

    expect(refused.code).toBe(1)
    expect(refused.output).toContain('.gitattributes')
    expect(exists(refused.tree, 'content/site/.gitattributes')).toBe(false)
  })
})

describe('the path-safety check, turned directly', () => {
  it('refuses every path outside the two roots', () => {
    for (const path of [
      '.pages.yml',
      '.github/workflows/ci.yml',
      'content/launch/copy.md',
      'public/brand/seal.svg',
      'public/media/dish-odin/640.webp',
      'generated/images.json',
      'netlify.toml',
      'package.json',
      'scripts/cms/compose-publication.mjs',
      'tests/unit/example.test.ts',
      'app/page.tsx',
      'content/site',
      'contentsite/menu.json',
    ]) {
      expect(publicationPathProblem(path, '100644'), path).toContain('is not under')
    }
  })

  it('refuses a traversal, an absolute path and a backslash path', () => {
    for (const path of [
      'content/site/../../.github/workflows/ci.yml',
      'content/site/news/../../../package.json',
      'content/site/./menu.json',
      'content/site//menu.json',
      '/etc/passwd',
      'content/site/news\\..\\..\\evil.yml',
    ]) {
      expect(publicationPathProblem(path, '100644'), path).not.toBeNull()
    }
  })

  it('records that git itself cannot store such a path', () => {
    const root = scratch('publication-path-')
    git(root, ['init', '-q', '-b', 'main'])

    const oid = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], {
      input: 'hostile\n',
      encoding: 'utf8',
    }).trim()

    for (const path of ['content/site/../../.github/ci.yml', '/etc/passwd']) {
      expect(() =>
        git(root, ['update-index', '--add', '--cacheinfo', `100644,${oid},${path}`]),
      ).toThrow()
    }
  })

  it('accepts one file mode and refuses every other', () => {
    // 100644 is the whole of it: a plain, non-executable regular file. Nothing a CMS
    // writes here is executable, and `applyPublication` could not reproduce the bit if
    // it were — so an accepted 100755 would mean a composed tree the checkout disagrees
    // with. Narrowing the mode, rather than teaching the writer to `chmod`, is the fix.
    expect(publicationPathProblem('content/site/menu.json', '100644')).toBeNull()
    expect(publicationPathProblem('public/photos/dish-odin.png', '100644')).toBeNull()

    expect(publicationPathProblem('content/site/menu.json', '100755')).toContain('executable')
    expect(publicationPathProblem('public/photos/dish-odin.png', '100755')).toContain('executable')
    expect(publicationPathProblem('content/site/menu.json', '120000')).toContain('symbolic link')
    expect(publicationPathProblem('public/photos/dish-odin.png', '120000')).toContain(
      'symbolic link',
    )
    expect(publicationPathProblem('content/site/menu.json', '160000')).toContain('submodule')
    expect(publicationPathProblem('public/photos/dish-odin.png', '160000')).toContain('submodule')
    expect(publicationPathProblem('content/site/menu.json', '040000')).not.toBeNull()
  })

  it('holds a photograph to the file name the site renders it by', () => {
    // The rule is `lib/images/photos.ts`, reused rather than restated: one file directly
    // in public/photos/, a lower-case slug, one of four raster extensions.
    for (const name of [
      'home-hero.png',
      'dish-glade-gris.png',
      'about-venue.png',
      'takeaway.jpg',
      'frokost.jpeg',
      'aften.webp',
      'sommer2026.png',
    ]) {
      expect(publicationPathProblem(`public/photos/${name}`, '100644'), name).toBeNull()
    }

    for (const name of [
      'foo.svg',
      'foo.html',
      'foo.js',
      'foo.json',
      'My Photo.png',
      'foo_bar.png',
      'Foo.png',
      'foo.PNG',
      'foo--bar.png',
      '-foo.png',
      'foo-.png',
      'foo.png.js',
      'foo.bar.png',
      'foo',
      'foo.avif',
      'foo.tiff',
      // Not tracked in this repository, and not invented here: public/photos/ is never
      // empty, so it has no reason to carry the one dotfile content/site/news/ does.
      '.gitkeep',
    ]) {
      expect(publicationPathProblem(`public/photos/${name}`, '100644'), name).not.toBeNull()
    }

    expect(publicationPathProblem('public/photos/archive/photo.png', '100644')).toContain(
      'no subdirectories',
    )
  })

  it('holds a news file to the slug the loader turns into an address', () => {
    for (const name of [
      'nyt-koekken.json',
      'aabent-i-paasken.json',
      'sommer2026.json',
      '.gitkeep',
    ]) {
      expect(publicationPathProblem(`content/site/news/${name}`, '100644'), name).toBeNull()
    }

    for (const name of [
      'Nyt-Koekken.json',
      'nyt_koekken.json',
      'nyt koekken.json',
      'nyt--koekken.json',
      '-nyt.json',
      'nyt-.json',
      'nyt.koekken.json',
      'nyt køkken.json',
      'nyt.md',
      'nyt',
      '.hidden.json',
      '.gitkeep.json',
    ]) {
      expect(publicationPathProblem(`content/site/news/${name}`, '100644'), name).not.toBeNull()
    }

    expect(publicationPathProblem('content/site/news/2026/nyt.json', '100644')).toContain(
      'no subdirectories',
    )
  })

  it('accepts the content and photograph paths the site actually has', () => {
    for (const path of [
      'content/site/menu.json',
      'content/site/announcement.json',
      'content/site/pages/home.json',
      'content/site/news/.gitkeep',
      'public/photos/home-hero.png',
      'public/photos/dish-glade-gris.png',
    ]) {
      expect(publicationPathProblem(path, '100644'), path).toBeNull()
    }
  })
})

describe('composePublication as a module', () => {
  function treeEntry(root, ref, path) {
    const [meta] = git(root, ['ls-tree', ref, '--', path]).trim().split('\t')
    const [mode, , oid] = meta.split(' ')
    return { mode, oid }
  }

  it('reports the resolved commits and the change set', () => {
    const root = fixture({ 'content/site/menu.json': '{ "sections": ["frokost"] }\n' })

    const composed = composePublication({ repo: root, mainRef: 'main', contentRef: 'content' })

    expect(composed.changed).toBe(true)
    expect(composed.changes).toEqual({
      added: [],
      removed: [],
      modified: ['content/site/menu.json'],
    })
    expect(composed.mainSha).toMatch(/^[0-9a-f]{40}$/)
    expect(composed.contentSha).not.toBe(composed.mainSha)
    // The publication tree holds main's own entry for everything outside the two roots.
    expect(composed.publication.get('app/page.tsx')).toEqual(
      treeEntry(root, 'main', 'app/page.tsx'),
    )
    expect(composed.publication.get('.pages.yml')).toEqual(treeEntry(root, 'main', '.pages.yml'))
  })

  it('says nothing changed when only untrusted paths differ', () => {
    const root = fixture({ '.github/workflows/ci.yml': 'name: CI\non: push\n' })

    const composed = composePublication({ repo: root, mainRef: 'main', contentRef: 'content' })

    expect(composed.changed).toBe(false)
    expect(composed.changes).toEqual({ added: [], removed: [], modified: [] })
  })

  it('refuses a ref that names no commit', () => {
    const root = fixture()

    expect(() =>
      composePublication({ repo: root, mainRef: 'main', contentRef: 'no-such-branch' }),
    ).toThrow(/no-such-branch/)
  })
})

/**
 * Composing from the separate CMS repository — the security migration's Phase S2.
 *
 * Pages CMS is moving out of this repository and into `myimaginarii/klingenberg-content`,
 * which holds the restaurant's edits and nothing that could publish them. The publisher
 * reads it the only way it reads anything untrusted: one `git fetch` of one branch
 * brings its objects into the trusted checkout, parked at the ref
 * `publication-source.mjs` names, and the composer is handed the commit.
 *
 * These are the same boundary tests as above, asked of a genuinely separate repository
 * rather than of a branch — because that is what changes about the threat. A branch in
 * this repository shares main's history; an external repository shares nothing, has its
 * own root commit, its own `.pages.yml`, its own `README.md`, and could carry its own
 * `package.json`, workflows or hooks. None of that has any route across, and the reason
 * is not a rule naming any of them: the allow-list selects two prefixes, and everything
 * else in the publication tree is main's own entry.
 */
describe('composing from the separate content repository', () => {
  /**
   * The external repository, as it really is: the two publication roots, its own CMS
   * configuration and README — plus, for the sake of the test, the things a compromised
   * one would add. It has no commit in common with the production fixture.
   */
  const EXTERNAL = {
    'content/site/hours.json': '{ "weekly": ["external"] }\n',
    'content/site/menu.json': '{ "sections": [] }\n',
    'content/site/news/.gitkeep': '',
    'content/site/news/nyt-fra-klingenberg.json': '{ "title": "Nyt fra Klingenberg" }\n',
    'public/photos/home-hero.png': 'png-bytes-home-hero',
    'public/photos/dish-odin.png': 'png-bytes-dish-odin',
    'public/photos/dish-frigg.png': 'png-bytes-dish-frigg',
    '.pages.yml': 'media:\n  - name: photos\n    input: public/photos\nsettings:\n  hostile: true\n',
    'README.md': '# Klingenberg content\n\nThe restaurant edits here.\n',
    'package.json': '{ "name": "content", "scripts": { "prepare": "echo owned" } }\n',
    '.github/workflows/evil.yml': 'name: Evil\non: push\n',
    'scripts/evil.mjs': 'process.exit(1)\n',
    'content/launch/copy.md': '# not published\n',
  }

  /** A standalone repository with its own root commit — `main`, holding {@link EXTERNAL}. */
  function externalRepository(edits = {}) {
    const root = scratch('external-content-')

    git(root, ['init', '-q', '-b', 'main'])
    git(root, ['config', 'user.email', 'cms@example.test'])
    git(root, ['config', 'user.name', 'Pages CMS'])
    git(root, ['config', 'commit.gpgsign', 'false'])

    for (const [path, contents] of Object.entries({ ...EXTERNAL, ...edits })) {
      if (contents === null) continue
      write(root, path, contents)
    }
    git(root, ['add', '-A'])
    git(root, ['commit', '-qm', 'cms save'])
    return root
  }

  /**
   * What the workflow does: fetch one branch of the external repository into the
   * trusted checkout, at the ref outside `refs/heads/` that nothing can push or check
   * out, and return the immutable SHA it resolved to.
   */
  function fetchExternal(production, external) {
    git(production, [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      external,
      `+refs/heads/${EXTERNAL_CONTENT_BRANCH}:${EXTERNAL_CONTENT_REF}`,
    ])
    return git(production, ['rev-parse', EXTERNAL_CONTENT_REF]).trim()
  }

  it('publishes the external repository content, and only that', () => {
    const production = fixture()
    const external = externalRepository()
    const sha = fetchExternal(production, external)

    const { code, output, tree } = publish(production, sha)

    expect(code, output).toBe(0)
    expect(changedPaths(output).sort()).toEqual([
      'content/site/hours.json',
      'content/site/news/aabent-i-paasken.json',
      'content/site/news/nyt-fra-klingenberg.json',
      'public/photos/dish-frigg.png',
    ])

    // The snapshot replaces: the external article arrives, main's own goes, and the
    // photograph the external repository adds is published byte for byte.
    expect(text(tree, 'content/site/hours.json')).toBe('{ "weekly": ["external"] }\n')
    expect(exists(tree, 'content/site/news/nyt-fra-klingenberg.json')).toBe(true)
    expect(exists(tree, 'content/site/news/aabent-i-paasken.json')).toBe(false)
    expect(bytes(tree, 'public/photos/dish-frigg.png').toString()).toBe('png-bytes-dish-frigg')
  })

  it('never lets the external .pages.yml or README reach production', () => {
    const production = fixture()
    const external = externalRepository()
    const sha = fetchExternal(production, external)

    const { code, tree } = publish(production, sha)

    expect(code).toBe(0)
    // `.pages.yml` exists on both sides and differs; main's is what survives.
    expect(text(tree, '.pages.yml')).toBe(MAIN['.pages.yml'])
    expect(text(tree, '.pages.yml')).not.toContain('hostile')
    // The README exists only on the external side, and does not arrive.
    expect(exists(tree, 'README.md')).toBe(false)
  })

  it('never lets the external repository supply code, a workflow or a hook', () => {
    const production = fixture()
    const external = externalRepository()
    const sha = fetchExternal(production, external)

    const { code, output, tree } = publish(production, sha)

    expect(code).toBe(0)
    expect(text(tree, '.github/workflows/ci.yml')).toBe(MAIN['.github/workflows/ci.yml'])
    expect(exists(tree, '.github/workflows/evil.yml')).toBe(false)
    expect(text(tree, 'package.json')).toBe(MAIN['package.json'])
    expect(text(tree, 'package.json')).not.toContain('prepare')
    expect(exists(tree, 'scripts/evil.mjs')).toBe(false)
    expect(text(tree, 'scripts/build.mjs')).toBe(MAIN['scripts/build.mjs'])
    expect(text(tree, 'content/launch/copy.md')).toBe(MAIN['content/launch/copy.md'])

    // And none of it is even reported as a change: a path outside the roots is not a
    // publication input the composer had to reject, it is one it never selected.
    for (const path of changedPaths(output)) {
      expect(path, path).toMatch(/^(content\/site|public\/photos)\//)
    }
  })

  it('refuses the whole publication when the external repository offers a symbolic link', () => {
    const production = fixture()
    const external = externalRepository()
    // Written through the external repository's own index, which is exactly how a
    // compromised CMS account would offer one.
    const blob = execFileSync('git', ['-C', external, 'hash-object', '-w', '--stdin'], {
      input: '../../../etc/passwd',
      encoding: 'utf8',
    }).trim()
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch('external-index-'), 'index') }
    // Off the branch first: git will not move a branch a worktree is sitting on.
    git(external, ['checkout', '-q', '--detach'])
    git(external, ['read-tree', 'main'], env)
    git(external, ['update-index', '--add', '--cacheinfo', `120000,${blob},content/site/link.json`], env)
    const tree = git(external, ['write-tree'], env).trim()
    const commit = git(external, ['commit-tree', tree, '-p', 'main', '-m', 'hostile'], env).trim()
    git(external, ['branch', '-f', 'main', commit])

    const sha = fetchExternal(production, external)
    const result = publish(production, sha)

    expect(result.code).toBe(1)
    expect(result.output).toContain('symbolic link')
    // Nothing at all was written: the refusal is before the first byte.
    expect(text(result.tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
    expect(exists(result.tree, 'content/site/link.json')).toBe(false)
  })

  it('composes from the immutable commit, not from whatever the branch became', () => {
    const production = fixture()
    const external = externalRepository()
    const sha = fetchExternal(production, external)

    // A newer save lands on the external repository after the SHA was taken. The
    // fetched objects are the ones composed from; the new save is not among them.
    write(external, 'content/site/hours.json', '{ "weekly": ["newer"] }\n')
    git(external, ['add', '-A'])
    git(external, ['commit', '-qm', 'newer save'])
    expect(git(external, ['rev-parse', 'main']).trim()).not.toBe(sha)

    const { code, tree } = publish(production, sha)

    expect(code).toBe(0)
    expect(text(tree, 'content/site/hours.json')).toBe('{ "weekly": ["external"] }\n')
  })

  it('parks the fetched objects where nothing can push or check them out', () => {
    const production = fixture()
    const external = externalRepository()
    fetchExternal(production, external)

    expect(EXTERNAL_CONTENT_REF.startsWith('refs/heads/')).toBe(false)
    // Not a branch, and not reachable from one: `git push origin HEAD:refs/heads/…`
    // pushes what is reachable from HEAD, and the external history is not.
    expect(git(production, ['branch', '--list', '--all']).trim()).not.toContain('external-content')
    expect(git(production, ['branch', '--contains', EXTERNAL_CONTENT_REF]).trim()).toBe('')
  })
})
