import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { PUBLIC_REVALIDATE_SECONDS } from '@/lib/cache/tags'

import { signIn, STAFF } from './support/admin'
import { openDish, publishMenu, saveDish } from './support/menu-admin'
import { PUBLIC_ROUTES } from './support/site'

/**
 * The public cache keeps §6's promise on the **first** request — technical plan §6, §7a.
 *
 *     publish succeeds → the next new public request shows the published version
 *
 * "Next request", not "second request". Everything in this file exists because a cached
 * page has two ages in Next.js — the point where it goes *stale* and the point where it
 * *expires* — and stale-while-revalidate is the gap between them. Inside that gap a
 * cache is allowed to answer with the copy it already holds and fetch a new one behind
 * it, which turns the promise above into "the request after next", and does so exactly
 * where nobody is watching: for the first visitor after a quiet spell.
 *
 * Next.js's default pairs this site's five-minute `revalidate` with a one-year
 * `expireTime`, so the gap was 364 days and 23 hours wide. `next.config.ts` closes it by
 * stating the same five minutes as `expireTime`; the reasoning is written out there.
 * These are the tests that hold it closed.
 *
 * **On the implementation this file was written against, the first test fails
 * immediately** — the six public pages answered with
 * `s-maxage=300, stale-while-revalidate=31535700` — and the second fails after its wait,
 * with `x-nextjs-cache: STALE` and the pre-publish price.
 *
 * This project is chained last, after every other write suite, because it publishes and
 * publishing expires the `menu` tag. It restores the seeded price before it finishes.
 */

test.describe.configure({ mode: 'serial' })

const BURGERS = 'Burgere'
const ODIN = 'Odin'
const FIELD = { price: 'Pris (kr.)' } as const

/** Odin's seeded price, and the price this suite publishes on top of it. */
const SEEDED_PRICE = '89'
const SEEDED_PRICE_PUBLIC = '89 kr.'
const NEW_PRICE = '92,50'
const NEW_PRICE_PUBLIC = '92,50 kr.'

/**
 * What a guest's request was answered from.
 *
 * `MISS` — rendered for this request. `HIT` — the cached page, still inside its window.
 * `REVALIDATED` — the window had passed, so it was re-rendered *before* answering.
 * `STALE` — the window had passed and the cached page was served anyway while a fresh
 * one was rendered behind it. The last of those is the state this file exists to make
 * unreachable.
 */
type CacheState = string | undefined

type GuestResponse = {
  readonly status: number
  readonly cacheState: CacheState
  readonly cacheControl: string | undefined
  readonly html: string
}

/** One request from nobody in particular: no session, no cookie, no browser cache. */
async function guestGet(request: APIRequestContext, path: string): Promise<GuestResponse> {
  const response = await request.get(path)

  return {
    status: response.status(),
    cacheState: response.headers()['x-nextjs-cache'],
    cacheControl: response.headers()['cache-control'],
    html: await response.text(),
  }
}

/** Odin's price as the served HTML states it, read out of the document itself. */
function odinPrice(html: string): string | null {
  const at = html.indexOf(ODIN)
  if (at === -1) return null

  const match = html.slice(at, at + 4_000).match(/(\d+(?:,\d+)?)(?:&nbsp;| )kr\./)

  return match?.[1] ?? null
}

let staffPage: Page
let guest: APIRequestContext

test.beforeAll(async ({ browser, playwright }) => {
  staffPage = await (await browser.newContext()).newPage()
  await signIn(staffPage, STAFF)

  guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })
})

test.afterAll(async () => {
  await guest.dispose()
  await staffPage.context().close()
})

// ---------------------------------------------------------------------------
// 1. What the site tells every cache in front of it
// ---------------------------------------------------------------------------

test('no public page authorises a cache to answer with a copy older than the window', async () => {
  for (const route of PUBLIC_ROUTES) {
    const response = await guestGet(guest, route.path)

    expect(response.status, `${route.path} is served`).toBe(200)

    // Exactly the window, and nothing after it. `stale-while-revalidate` here would be
    // this site telling a CDN it may answer the first request after a publish from a
    // copy taken before it — a promise broken by the header rather than by the
    // invalidation, and one no amount of `updateTag()` on the origin can take back.
    expect(response.cacheControl, `${route.path} Cache-Control`).toBe(
      `s-maxage=${PUBLIC_REVALIDATE_SECONDS}`,
    )
  }
})

// ---------------------------------------------------------------------------
// 2. The first request after a publish, on a page that had gone past its window
// ---------------------------------------------------------------------------

/**
 * The whole point of this file, in one scenario.
 *
 * 1. the old price is cached and being served from the cache;
 * 2. the cached page is taken past its five-minute window — the state in which the
 *    previous implementation switched to stale-while-revalidate and answered the next
 *    visitor with the copy it already had;
 * 3. a new price is published through the real Offentliggør path;
 * 4. **one** fresh guest request has to carry it.
 *
 * The wait in step 2 is the configured window itself, not a guess and not a settling
 * period: the state under test is "this entry is older than `revalidate`", and there is
 * no other way to reach it — the age lives in Next.js's own cache entry, which nothing
 * outside the server can move. It is one wait, in one test, in a project that runs last.
 * Nothing here polls, retries, or asserts on a second request; a first request that
 * carries the old price is the failure this test is for.
 */
test('a page past its window is re-rendered before it answers, and carries a publish at once', async () => {
  test.setTimeout((PUBLIC_REVALIDATE_SECONDS + 180) * 1_000)

  // 1. The seeded price, published and cached.
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, { [FIELD.price]: SEEDED_PRICE })
  await publishMenu(staffPage)

  const cached = await guestGet(guest, '/menu')
  expect(cached.html).toContain(SEEDED_PRICE_PUBLIC)

  // 2. Past the window. Everything from here is the state the defect needed.
  await new Promise((resolve) => setTimeout(resolve, (PUBLIC_REVALIDATE_SECONDS + 10) * 1_000))

  const aged = await guestGet(guest, '/menu')
  expect(aged.cacheState, 'an aged page is re-rendered before it is answered').not.toBe('STALE')
  expect(odinPrice(aged.html)).toBe(SEEDED_PRICE)

  // 3. A different price, through the path a staff member actually uses.
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, { [FIELD.price]: NEW_PRICE })
  await publishMenu(staffPage)

  // 4. One request. Not a poll, not a second attempt.
  const first = await guestGet(guest, '/menu')
  expect(first.cacheState, 'the first request after a publish is not answered from the cache').not.toBe('STALE')
  expect(first.html).toContain(NEW_PRICE_PUBLIC)

  // The Forside carries the same three burgers from the same tagged read, so the publish
  // has to have reached it on its own first request too.
  const home = await guestGet(guest, '/')
  expect(home.cacheState).not.toBe('STALE')
  expect(home.html).toContain(NEW_PRICE_PUBLIC)
})

// ---------------------------------------------------------------------------
// 3. Back to the seed
// ---------------------------------------------------------------------------

test('the seeded price is restored, and that publish also lands on the first request', async () => {
  await openDish(staffPage, BURGERS, ODIN)
  await saveDish(staffPage, { [FIELD.price]: SEEDED_PRICE })
  await publishMenu(staffPage)

  const first = await guestGet(guest, '/menu')
  expect(first.cacheState).not.toBe('STALE')
  expect(first.html).toContain(SEEDED_PRICE_PUBLIC)
})
