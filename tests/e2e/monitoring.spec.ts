import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { contentSecurityPolicy } from '@/lib/security/headers'

import { DRAFT_COOKIE, signIn, STAFF } from './support/admin'
import { openDish } from './support/menu-admin'
import { openNewEditor } from './support/news-admin'

/**
 * The browser is not monitored — phase 13C (brief §4, §26, §28, §33).
 *
 * Server-side Sentry runs in `instrumentation.ts` and nowhere near a visitor's
 * browser (§1, §12). This read-only suite walks the same pages the header suite
 * walks — the public site as a guest, the administration as a staff member, a
 * Draft Mode preview — and asserts what the built site must never do:
 *
 *   * no request leaves the page for a monitoring host, and no request at all
 *     leaves for an origin other than this site and the Supabase Storage origin;
 *   * no framework chunk the page loads contains the SDK — the browser bundle is
 *     inspected by content, not by name;
 *   * a guest still receives no cookie and the page writes nothing to storage;
 *   * the console stays empty of errors;
 *   * the Content-Security-Policy is exactly the one phase 13B pinned — no
 *     monitoring origin was added to it, because none is needed.
 */

const PUBLIC_ROUTES = ['/', '/menu', '/nyheder', '/mad-ud-af-huset', '/find-os', '/om-os'] as const

/** What the SDK's browser half would leave in a request's host. */
const HOST_MARKERS = [/sentry/i, /ingest\./i]

/**
 * What the SDK's browser half would leave in a chunk: its own name, its global,
 * its integrations. Precise on purpose — the framework's own chunks legitimately
 * contain words like "replay" (React's replaying of events), so a bare word would
 * fail on the framework rather than on the SDK.
 */
const CHUNK_MARKERS = [/sentry/i, /replayIntegration|browserTracingIntegration|__SENTRY__|sentry_key|_sentryDebugIds/]

type Watch = {
  readonly requests: string[]
  readonly errors: string[]
  readonly scripts: string[]
}

function watch(page: Page): Watch {
  const requests: string[] = []
  const errors: string[] = []
  const scripts: string[] = []
  page.on('request', (request) => {
    requests.push(request.url())
  })
  page.on('response', (response) => {
    const type = response.headers()['content-type'] ?? ''
    if (/javascript/.test(type) && response.status() === 200) scripts.push(response.url())
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return { requests, errors, scripts }
}

function foreignRequests(watched: Watch, origin: string, supabaseOrigin: string | null): string[] {
  return watched.requests.filter(
    (url) => !url.startsWith(origin) && !(supabaseOrigin !== null && url.startsWith(supabaseOrigin)) && !url.startsWith('data:'),
  )
}

async function storageIsEmpty(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      return window.localStorage.length === 0 && window.sessionStorage.length === 0
    } catch {
      return true
    }
  })
}

async function chunksAreClean(page: Page, scripts: string[]): Promise<void> {
  const seen = new Set<string>()
  for (const url of scripts) {
    if (seen.has(url)) continue
    seen.add(url)
    const body = await (await page.request.get(url)).text()
    for (const marker of CHUNK_MARKERS) {
      expect(body, `${url} carries no monitoring code (${marker})`).not.toMatch(marker)
    }
  }
}

/** The Supabase origin the built site was configured with — from `.env.local`, as the app reads it. */
function supabaseOrigin(): string | null {
  const envFile = resolve(process.cwd(), '.env.local')
  let value = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!value && existsSync(envFile)) {
    const match = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.*?)\s*$/m.exec(readFileSync(envFile, 'utf8'))
    value = match?.[1]
  }
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

test('a guest walks the public site: no monitoring request, chunk, cookie or storage; no console error', async ({ page, baseURL }) => {
  const watched = watch(page)
  const supabase = supabaseOrigin()

  for (const path of PUBLIC_ROUTES) {
    await page.goto(path)
    await settle(page)
    await expect(page.getByRole('contentinfo')).toBeVisible()
    expect(await storageIsEmpty(page), `${path} writes nothing to storage`).toBe(true)
  }

  const firstArticle = page.getByRole('main').getByRole('link', { name: /Læs/ }).first()
  await page.goto('/nyheder')
  await settle(page)
  if ((await firstArticle.count()) > 0) {
    await firstArticle.click()
    await settle(page)
  }

  expect(watched.requests.filter((url) => HOST_MARKERS.some((m) => m.test(new URL(url).host)))).toEqual([])
  expect(foreignRequests(watched, baseURL!, supabase)).toEqual([])
  expect(watched.errors).toEqual([])
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([])
  await chunksAreClean(page, watched.scripts)
})

test('a staff member walks the administration and a preview: the same silence, and only the session cookies', async ({ page, baseURL }) => {
  const watched = watch(page)
  const supabase = supabaseOrigin()

  await signIn(page, STAFF)
  await settle(page)

  // The menu editor and its picker.
  await openDish(page, 'Burgere', 'Thor')
  await page.waitForURL(/ret=/)
  await settle(page)
  const picker = new URL(page.url())
  picker.searchParams.set('vaelg_billede', '1')
  await page.goto(picker.pathname + picker.search)
  await settle(page)
  await expect(page.locator('dialog[open]')).toBeVisible()

  // The news editor, with the autosave controller mounted.
  await openNewEditor(page)
  await settle(page)

  // The image library (the uploader is a client component).
  await page.goto('/admin/billeder')
  await settle(page)

  // A Draft Mode preview of the Forside, and back out of it.
  await page.goto('/api/preview/start?maal=forside')
  await settle(page)
  expect(page.url()).toMatch(/\/$/)
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toContain(DRAFT_COOKIE)
  await page.goto('/api/preview/stop?maal=forside')
  await settle(page)

  const cookies = (await page.context().cookies()).map((cookie) => cookie.name)
  for (const name of cookies) {
    expect(name, `${name} is a session or draft cookie`).toMatch(new RegExp(`^(sb-.*-auth-token(\\.\\d+)?|${DRAFT_COOKIE})$`))
  }
  expect(await storageIsEmpty(page)).toBe(true)
  expect(watched.requests.filter((url) => HOST_MARKERS.some((m) => m.test(new URL(url).host)))).toEqual([])
  expect(foreignRequests(watched, baseURL!, supabase)).toEqual([])
  expect(watched.errors).toEqual([])
  await chunksAreClean(page, watched.scripts)
})

test('the policy names no monitoring origin: the CSP is exactly what phase 13B pinned', async ({ request }) => {
  const expected = contentSecurityPolicy({ production: true, supabaseOrigin: supabaseOrigin() })
  expect(expected).not.toMatch(/sentry|ingest/i)
  expect(expected).not.toContain('report-uri')
  expect(expected).not.toContain('report-to')

  for (const path of ['/', '/admin/login']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.headers()['content-security-policy'], path).toBe(expected)
    expect(response.headers()['reporting-endpoints'], `${path} has no reporting endpoint`).toBeUndefined()
    expect(response.headers()['report-to'], `${path} has no report-to`).toBeUndefined()
  }
})
