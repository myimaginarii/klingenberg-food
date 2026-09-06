import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CONFIRMED_CONTENT_FILE } from '../../scripts/launch/lib/content.mjs'
import { NAMES, launch, localStack, resetStack, sql } from './support.mjs'

/**
 * The confirmed-content loader against the real local database — technical plan
 * §10a, §10b; phase 14A.
 *
 * The seeded local stack is an OPERATIONAL database to the loader (content, no
 * marker) and is refused. The confirmed tables are then emptied to their
 * migration state by hand — the loader never does that — and the load is
 * proven: fresh, one transaction, the marker, and the rows byte-for-byte what
 * `npm run db:reset` had written for those tables (the confirmed layer alone
 * reproduces them; the development layer contributes nothing to them). A rerun
 * is harmless; a forced failure rolls the whole load back. The suite ends with a
 * full reset, so nothing it did survives.
 */

const CONFIRMED_SNAPSHOT_SQL = `select json_build_object(
  'categories', (select json_agg(json_build_object('slug', slug, 'name', name, 'sort_order', sort_order, 'kind', kind, 'intro', intro, 'note', note) order by sort_order)
                   from public.menu_categories),
  'dishes', (select json_agg(json_build_object('category', c.slug, 'name', d.name, 'description', d.description, 'secondary_note', d.secondary_note,
                                              'price_ore', d.price_ore, 'labels', d.labels, 'details', d.details, 'sort_order', d.sort_order,
                                              'sold_out_on', d.sold_out_on, 'deleted_at', d.deleted_at, 'draft', d.draft, 'image_id', d.image_id)
                             order by c.sort_order, d.sort_order, d.name)
               from public.dishes d join public.menu_categories c on c.id = d.category_id),
  'contact', (select json_build_object('venue_name', venue_name, 'address_line1', address_line1, 'postal_code', postal_code, 'city', city,
                                       'primary_phone', primary_phone, 'secondary_phone', secondary_phone, 'facebook_url', facebook_url,
                                       'email', email, 'map_attribution', map_attribution, 'draft', draft)
                from public.site_contact),
  'hours', (select schedule from public.opening_hours)
)::text;`

const STATE_SQL = `select json_build_object(
  'categories', (select count(*) from public.menu_categories),
  'dishes', (select count(*) from public.dishes),
  'markers', (select count(*) from public.audit_log where entity = 'launch' and action = 'content_load'),
  'marker', (select "after" from public.audit_log where entity = 'launch' and action = 'content_load' order by created_at desc limit 1),
  'news', (select count(*) from public.news),
  'profiles', (select count(*) from public.profiles),
  'contactEmpty', (select address_line1 is null and primary_phone is null and venue_name is null from public.site_contact)
)::text;`

/** The migration's own state of the four tables — what a fresh project holds. */
const EMPTY_SQL = `
set session_replication_role = replica;
truncate table public.dishes, public.menu_categories cascade;
update public.site_contact set venue_name = null, address_line1 = null, postal_code = null, city = null, primary_phone = null,
  secondary_phone = null, facebook_url = null, email = null, map_attribution = null, draft = null;
update public.opening_hours set schedule = jsonb_build_object(
  'mon', jsonb_build_object('closed', true), 'tue', jsonb_build_object('closed', true), 'wed', jsonb_build_object('closed', true),
  'thu', jsonb_build_object('closed', true), 'fri', jsonb_build_object('closed', true), 'sat', jsonb_build_object('closed', true),
  'sun', jsonb_build_object('closed', true)), draft = null;
delete from public.audit_log where entity = 'launch' and action = 'content_load';
`

let stack
let snapshot
let confirmedSql
let confirmedSha
const staged = []

const state = () => sql(stack.dbContainer, STATE_SQL).then(JSON.parse)

function harness(args = [], env = {}) {
  return launch('load-content.mjs', ['--local-harness', ...args], { [NAMES.dbUrl]: stack.dbUrl, [NAMES.contentLoadConfirmHost]: stack.dbHost, ...env })
}

beforeAll(async () => {
  stack = await localStack()
  await resetStack()
  confirmedSql = await readFile(CONFIRMED_CONTENT_FILE, 'utf8')
  confirmedSha = createHash('sha256').update(confirmedSql, 'utf8').digest('hex')
})

afterAll(async () => {
  for (const dir of staged) await rm(dir, { recursive: true, force: true })
  await resetStack()
})

describe('the production guard', () => {
  it('refuses the local stack in production mode', async () => {
    const run = await launch('load-content.mjs', [], { [NAMES.dbUrl]: stack.dbUrl, [NAMES.contentLoadConfirmHost]: stack.dbHost })
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — The target .* is the local stack/)
  })

  it('refuses a harness run without its confirmation, and the --source option outside the harness', async () => {
    const missing = await harness([], { [NAMES.contentLoadConfirmHost]: undefined })
    expect(missing.code).toBe(1)
    const outside = await launch('load-content.mjs', ['--source', 'x.sql'], { [NAMES.dbUrl]: stack.dbUrl })
    expect(outside.code).toBe(1)
    expect(outside.output).toMatch(/harness option/)
  })
})

describe('the loader', () => {
  it('a seeded database is operational — refused, unchanged', async () => {
    const before = await state()
    expect(before.categories).toBe(9)
    expect(before.markers).toBe(0)

    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toContain('state: operational')
    expect(run.output).toMatch(/administration owns the content now/)
    expect(await state()).toEqual(before)
  })

  it('loads a fresh database in one transaction and reproduces the seeded confirmed tables exactly', async () => {
    snapshot = await sql(stack.dbContainer, CONFIRMED_SNAPSHOT_SQL)
    await sql(stack.dbContainer, EMPTY_SQL)
    const empty = await state()
    expect(empty).toMatchObject({ categories: 0, dishes: 0, markers: 0, contactEmpty: true })

    const dry = await harness(['--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.output).toContain('state: fresh')
    expect(dry.output).toContain('dry run')
    expect(await state()).toEqual(empty)

    const run = await harness()
    expect(run.output).toContain('loaded: 9 section(s), 46 dish(es)')
    expect(run.code).toBe(0)

    const after = await state()
    expect(after).toMatchObject({ categories: 9, dishes: 46, markers: 1, contactEmpty: false })
    expect(after.marker).toMatchObject({ source: CONFIRMED_CONTENT_FILE, sha256: confirmedSha, categories: 9, dishes: 46 })
    // The development layer did not run: the placeholder news and the accounts are untouched.
    expect(after.news).toBe(empty.news)
    expect(after.profiles).toBe(empty.profiles)

    expect(JSON.parse(await sql(stack.dbContainer, CONFIRMED_SNAPSHOT_SQL))).toEqual(JSON.parse(snapshot))
  })

  it('a rerun proves there is nothing left to do and changes nothing', async () => {
    const before = await state()
    const run = await harness()
    expect(run.code).toBe(0)
    expect(run.output).toContain('state: loaded')
    expect(run.output).toMatch(/nothing to do: the confirmed content was loaded on/)
    expect(await state()).toEqual(before)
  })

  it('a marker over empty tables is ambiguous — refused', async () => {
    await sql(stack.dbContainer, 'set session_replication_role = replica; truncate table public.dishes, public.menu_categories cascade;')
    await sql(stack.dbContainer, EMPTY_SQL.replace(/delete from public\.audit_log[^;]*;/, ''))
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toContain('state: inconsistent')
  })

  it('a forced failure rolls the whole load back: no section, no dish, no marker', async () => {
    await sql(stack.dbContainer, EMPTY_SQL)
    const dir = await mkdtemp(join(tmpdir(), 'kf-content-drill-'))
    staged.push(dir)
    const broken = join(dir, 'confirmed-broken.sql')
    await writeFile(broken, `${confirmedSql}\nselect 1/0;\n`)

    const run = await harness(['--source', broken])
    expect(run.code).toBe(1)
    expect(run.output).toMatch(/refused — the load failed and was rolled back; the database is unchanged/)
    expect(run.output).toContain('division by zero')
    expect(await state()).toMatchObject({ categories: 0, dishes: 0, markers: 0, contactEmpty: true })
  })

  it('the in-transaction guard refuses a load that raced a populated table', async () => {
    // Manufacture the race: a section appears between the loader's read and its write is
    // indistinguishable from a section that was there all along at guard time — so a
    // populated table with no marker is refused by the classifier before psql runs.
    await sql(stack.dbContainer, "insert into public.menu_categories (slug, name, sort_order, kind) values ('race', 'Race', 99, 'dishes');")
    const run = await harness()
    expect(run.code).toBe(1)
    expect(run.output).toContain('state: operational')
    await sql(stack.dbContainer, EMPTY_SQL)
  })
})
