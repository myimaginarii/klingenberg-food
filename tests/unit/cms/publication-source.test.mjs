import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  describeSource,
  EXTERNAL_CONTENT_BRANCH,
  EXTERNAL_CONTENT_REF,
  EXTERNAL_CONTENT_REPOSITORY,
  externalContentUrl,
  PUBLICATION_SOURCE,
  publicationSource,
  unauthenticatedHeaderOption,
} from '../../../scripts/cms/publication-source.mjs'

/**
 * Where a publication reads from — `scripts/cms/publication-source.mjs`.
 *
 * There is one source, `myimaginarii/klingenberg-content@main`, and the whole point of
 * this module is that a dispatch cannot supply a second. So what is asserted here is
 * mostly what the function *refuses*: a repository name, a fork, a ref, a SHA, a word
 * it does not know — and `internal`, the retired name for this repository's `content`
 * branch, which must never quietly start meaning something again. The positive
 * assertion that matters as much is compatibility: the content repository's trigger
 * dispatches with `source=external`, and an absent input has to land on the same place.
 */

// A reserved-TLD host (RFC 2606): a fixture server, and never a real address in source.
const SERVER = 'https://github.test'
const OPTIONS = { serverUrl: SERVER }

describe('the one source', () => {
  it('is named by one word', () => {
    expect(PUBLICATION_SOURCE).toBe('external')
  })

  it('accepts the word the content repository dispatches with', () => {
    expect(publicationSource('external', OPTIONS).repository).toBe(EXTERNAL_CONTENT_REPOSITORY)
  })

  it('is the same source when a dispatch names nothing', () => {
    // A dispatch by hand, or any caller that sends no inputs, gets the content
    // repository — never an error that would stop publishing, and never another source.
    const named = publicationSource('external', OPTIONS)
    for (const absent of [undefined, null, '']) {
      expect(publicationSource(absent, OPTIONS), String(absent)).toEqual(named)
    }
  })

  it('refuses the retired internal source', () => {
    expect(() => publicationSource('internal', OPTIONS)).toThrow(/not a publication source/)
  })

  it('refuses any other word, and anything shaped like a repository or a ref', () => {
    for (const name of [
      'Internal',
      'EXTERNAL',
      'External',
      ' external',
      'external ',
      'content',
      'main',
      'myimaginarii/klingenberg-content',
      'myimaginarii/klingenberg-content@main',
      'myimaginarii/klingenberg-food',
      'attacker/klingenberg-content',
      'refs/heads/main',
      'a'.repeat(40),
      '../..',
      'internal external',
      0,
      true,
    ]) {
      expect(() => publicationSource(name, OPTIONS), String(name)).toThrow(
        /not a publication source/,
      )
    }
  })
})

describe('the content repository', () => {
  const source = publicationSource('external', OPTIONS)

  it('is one repository and one branch, fixed in the module', () => {
    expect(EXTERNAL_CONTENT_REPOSITORY).toBe('myimaginarii/klingenberg-content')
    expect(EXTERNAL_CONTENT_BRANCH).toBe('main')
    expect(source).toEqual({
      repository: 'myimaginarii/klingenberg-content',
      branch: 'main',
      remote: `${SERVER}/myimaginarii/klingenberg-content.git`,
      ref: EXTERNAL_CONTENT_REF,
      headerReset: `http.${SERVER}/.extraheader=`,
      label: 'myimaginarii/klingenberg-content:main',
    })
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('never names this repository or its retired content branch', () => {
    for (const value of Object.values(source)) {
      expect(String(value)).not.toMatch(/klingenberg-food/)
      expect(String(value)).not.toMatch(/refs\/remotes\/origin|^origin$|:content$/)
    }
  })

  it('parks the fetched objects outside refs/heads', () => {
    // Outside `refs/heads/` so that a `git push origin HEAD:refs/heads/…` cannot carry
    // untrusted history and no branch checkout can land on it.
    expect(source.ref).toBe(EXTERNAL_CONTENT_REF)
    expect(source.ref).toMatch(/^refs\/cms\//)
    expect(source.ref.startsWith('refs/heads/')).toBe(false)
    expect(source.ref.startsWith('refs/remotes/')).toBe(false)
  })
})

describe('reading the content repository without a credential', () => {
  it('builds the clone URL from the server the runner names', () => {
    // No host is written down, for the same reason `publication-github.mjs` takes its
    // API addresses from the environment.
    expect(externalContentUrl(SERVER)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
    expect(externalContentUrl(`${SERVER}/`)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
  })

  it('refuses a server address that is not an https origin', () => {
    for (const value of ['', 'github.test', 'http://github.test', `${SERVER}/a/path`, 'javascript:1']) {
      expect(() => externalContentUrl(value), value).toThrow(/GITHUB_SERVER_URL/)
    }
  })

  it('empties the header actions/checkout left behind, for that server', () => {
    // `actions/checkout` writes the App installation token into git config as
    // `http.<server>/.extraheader`. Git documents an empty value as resetting the
    // list, which is what makes the fetch genuinely anonymous.
    expect(unauthenticatedHeaderOption(SERVER)).toBe(`http.${SERVER}/.extraheader=`)
    expect(publicationSource('external', OPTIONS).headerReset).toBe(
      `http.${SERVER}/.extraheader=`,
    )
  })

  it('carries no token, anywhere, in what it hands the workflow', () => {
    const source = publicationSource('external', OPTIONS)
    for (const value of Object.values(source)) {
      expect(String(value)).not.toMatch(/ghs_|ghp_|github_pat_|:\/\/[^/]*@/)
    }
  })
})

describe('naming a published snapshot', () => {
  it('is the repository, the branch and the commit, in one spelling', () => {
    const sha = 'a'.repeat(40)
    expect(describeSource({ label: publicationSource('external', OPTIONS).label, sha })).toBe(
      `myimaginarii/klingenberg-content:main@${sha}`,
    )
  })

  it('refuses a snapshot it cannot name', () => {
    expect(() => describeSource({ label: '', sha: 'a'.repeat(40) })).toThrow()
    expect(() => describeSource({ sha: 'a'.repeat(40) })).toThrow()
    for (const sha of ['', 'main', 'abc', 'z'.repeat(40), undefined]) {
      expect(() => describeSource({ label: 'a/b:c', sha }), String(sha)).toThrow()
    }
  })
})

describe('the environment it reads when nothing is passed', () => {
  let saved

  beforeAll(() => {
    saved = { repo: process.env.GITHUB_REPOSITORY, server: process.env.GITHUB_SERVER_URL }
  })

  afterAll(() => {
    for (const [name, value] of [
      ['GITHUB_REPOSITORY', saved.repo],
      ['GITHUB_SERVER_URL', saved.server],
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('says which variable is missing rather than inventing one', () => {
    delete process.env.GITHUB_SERVER_URL
    expect(() => publicationSource('external')).toThrow(/GITHUB_SERVER_URL/)
    expect(() => publicationSource(undefined)).toThrow(/GITHUB_SERVER_URL/)
  })

  it('does not need to know which repository it runs in', () => {
    // The retired internal source was the only thing that read GITHUB_REPOSITORY.
    delete process.env.GITHUB_REPOSITORY
    process.env.GITHUB_SERVER_URL = SERVER
    expect(publicationSource('external').remote).toBe(
      `${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`,
    )
  })
})
