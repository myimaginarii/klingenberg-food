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
 * One extra commit on `content` carrying a tree entry a Windows working tree cannot
 * hold: a symbolic link (mode 120000), written through a scratch index so the
 * fixture's own index and checkout stay untouched. This is how an untrusted branch
 * would offer one, and on a Linux runner it is what a checkout would materialise.
 */
function addSymlinkEntry(root, path, target) {
  const oid = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], {
    input: target,
    encoding: 'utf8',
  }).trim()

  const env = { ...process.env, GIT_INDEX_FILE: join(scratch('publication-index-'), 'index') }

  git(root, ['read-tree', 'content'], env)
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${oid},${path}`], env)
  const tree = git(root, ['write-tree'], env).trim()
  const commit = git(root, ['commit-tree', tree, '-p', 'content', '-m', 'hostile'], env).trim()
  git(root, ['branch', '-f', 'content', commit])
}

/**
 * The composer's CLI over a fixture, returning the working tree it published into.
 * `--into` is always given: a test that proves nothing was written needs the write to
 * have been attempted.
 */
function publish(root) {
  const tree = checkoutOfMain(root)
  const args = [SCRIPT, '--repo', root, '--main', 'main', '--content', 'content', '--into', tree]

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
    addSymlinkEntry(root, 'content/site/news/link.json', '../../../.github/workflows/ci.yml')

    const { code, output, tree } = publish(root)

    expect(code).toBe(1)
    expect(output).toContain('content/site/news/link.json')
    expect(output).toContain('symbolic link')
    // Fail closed: the valid edit in the same commit is not published either.
    expect(text(tree, 'content/site/hours.json')).toBe(MAIN['content/site/hours.json'])
    expect(exists(tree, 'content/site/news/link.json')).toBe(false)
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

  it('refuses anything that is not a regular file', () => {
    expect(publicationPathProblem('content/site/menu.json', '120000')).toContain('symbolic link')
    expect(publicationPathProblem('public/photos/dish-odin.png', '160000')).toContain('submodule')
    expect(publicationPathProblem('content/site/menu.json', '100644')).toBeNull()
    expect(publicationPathProblem('content/site/menu.json', '100755')).toBeNull()
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
