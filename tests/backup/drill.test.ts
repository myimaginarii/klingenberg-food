import { createHash } from 'node:crypto'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Profile } from '@/lib/auth/session'
import { derivativePathsFor, derivativePublicUrlPath } from '@/lib/images/derivatives'
import { finalizeImageUpload } from '@/lib/images/finalize'
import { requestImageUpload } from '@/lib/images/signed-upload'
import { createImageStorage, type ImageStorage } from '@/lib/images/storage'

/**
 * The restore drill — technical plan §10f; phase 13A (brief §15, §16, §27).
 *
 * "A backup is complete only when a restore has been proven." This suite is that
 * proof, run against the real local stack with the real commands:
 *
 *   1. reset to the seed (a known state) and create the seeded identities;
 *   2. create representative content: a dish with a photograph uploaded through
 *      the real pipeline, a published article, a one-off opening-hours change, the
 *      weekly special, the announcement, a site_contact draft, a page draft, a
 *      third identity with a password, and the audit rows those writes produce;
 *   3. take a recovery point with `scripts/backup/backup.mjs`;
 *   4. destroy: truncate every application table, delete every identity through
 *      the Auth Admin API, remove every Storage object;
 *   5. restore with `scripts/backup/restore.mjs`;
 *   6. prove: rows byte-identical, image bytes identical and served from the right
 *      bucket with the right privacy, sign-in with the old passwords, RLS and the
 *      trusted functions working on the restored rows, the schema at the same
 *      migration;
 *   7. reset again, so nothing the drill made survives into the certification chain.
 *
 * It refuses every host but loopback. It is the third — and last — test-only door
 * that names the database secret (see scripts/check-source-policy.mjs), because
 * the commands it runs take their target from the environment.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const ROOT = process.cwd()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Fixed ids, so nothing has to be handed back from SQL. */
const DRILL = {
  dish: '00000000-0000-4000-8000-00000000d13a',
  news: '00000000-0000-4000-8000-00000000d13b',
  override: '00000000-0000-4000-8000-00000000d13c',
  user: { email: 'drill-13a@example.test', password: 'DrillRestore12345', name: 'Drill Medarbejder' },
}

let dbUrl: string
let dbContainer: string
let workDir: string
let recoveryPoint: string
let service: SupabaseClient
let storage: ImageStorage
let staffProfile: Profile

/** Everything measured before the destruction, compared after the restore. */
const before: Record<string, string> = {}
let imagePath = ''
let imageId = ''
let derivativePaths: string[] = []
const binaries = new Map<string, string>()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function requireLoopback(url: string, what: string): void {
  const host = new URL(url).hostname
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`The drill only ever runs against a loopback stack; ${what} is "${host}".`)
  }
}

type Run = { code: number | null; output: string }

/**
 * Run a process to completion. `shell: true` is used only for the two npm/npx
 * invocations, whose whole command line is a fixed literal — nothing user-supplied
 * is ever concatenated into a shell string.
 */
function runProcess(file: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.shell ? [file, ...args].join(' ') : file, options.shell ? [] : args, {
      cwd: ROOT,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString('utf8') }))
    child.stdin.end(options.input ?? '')
  })
}

/** SQL as the database superuser, through the local container — loopback by construction. */
async function sql(text: string): Promise<string> {
  const result = await runProcess('docker', [
    'exec',
    '--interactive',
    dbContainer,
    'psql',
    '--username',
    'postgres',
    '--dbname',
    'postgres',
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--file',
    '-',
  ], { input: text })
  if (result.code !== 0) throw new Error(`psql failed: ${result.output}`)
  return result.output.trim()
}

/** The backup and restore commands, exactly as an operator runs them. */
async function command(script: string, args: string[]): Promise<Run> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPABASE_DB_URL: dbUrl,
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  }
  return runProcess(process.execPath, [join(ROOT, 'scripts', 'backup', script), ...args], { env })
}

async function resetStack(): Promise<void> {
  const result = await runProcess('npm', ['run', 'db:reset:full'], { shell: true })
  if (result.code !== 0) throw new Error(`npm run db:reset:full failed:\n${result.output.slice(-2000)}`)
}

async function rowJson(table: string, where: string): Promise<string> {
  return sql(`select row_to_json(t)::text from public.${table} t where ${where};`)
}

async function anonClient(): Promise<SupabaseClient> {
  return createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signIn(email: string, password: string): Promise<SupabaseClient | null> {
  const client = await anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  return error ? null : client
}

async function removeEveryObject(): Promise<void> {
  for (const bucket of ['media-originals', 'media']) {
    const keys: string[] = []
    const { data: folders } = await service.storage.from(bucket).list('', { limit: 1000 })
    for (const folder of folders ?? []) {
      const { data: files } = await service.storage.from(bucket).list(folder.name, { limit: 1000 })
      for (const file of files ?? []) keys.push(`${folder.name}/${file.name}`)
    }
    if (keys.length > 0) {
      const { error } = await service.storage.from(bucket).remove(keys)
      if (error) throw new Error(`Removing ${keys.length} object(s) from ${bucket} failed: ${error.message}`)
    }
  }
}

beforeAll(async () => {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('The drill needs the local Supabase URL, anon key and service-role key (.env.local).')
  }
  requireLoopback(SUPABASE_URL, 'the API URL')

  const config = await readFile(join(ROOT, 'supabase', 'config.toml'), 'utf8')
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  if (!projectId) throw new Error('supabase/config.toml names no project_id.')
  dbContainer = `supabase_db_${projectId}`

  // The database URL comes from the CLI, never from a literal — and must be loopback.
  const status = await runProcess('npx', ['supabase', 'status', '-o', 'env'], { shell: true })
  const fromEnv = process.env.SUPABASE_DB_URL
  const fromStatus = /^DB_URL="?([^"\r\n]+)"?/m.exec(status.output)?.[1]
  dbUrl = fromEnv ?? fromStatus ?? ''
  if (!dbUrl) throw new Error('Could not determine the local database URL (supabase status).')
  requireLoopback(dbUrl, 'the database host')

  workDir = await mkdtemp(join(tmpdir(), 'klingenberg-drill-'))

  // 1. A known state: the seed and the seeded identities.
  await resetStack()

  service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  storage = createImageStorage()
  const staff = await signIn('staff@example.test', 'LocalStaff12345')
  if (!staff) throw new Error('Could not sign in as the seeded staff identity after the reset.')
  const { data } = await staff.auth.getUser()
  staffProfile = { userId: data.user!.id, email: 'staff@example.test', name: 'Lokal Medarbejder', role: 'staff', disabledAt: null }
  await staff.auth.signOut({ scope: 'local' })
})

afterAll(async () => {
  // 7. Leave nothing behind: the drill's objects, then the seed again.
  try {
    if (service) await removeEveryObject()
  } finally {
    if (dbUrl) await resetStack()
    if (workDir) await rm(workDir, { recursive: true, force: true })
  }
})

describe('the restore drill', () => {
  it('2. creates representative content through the real paths', async () => {
    // The photograph goes through the real pipeline as staff: signed upload, PUT,
    // finalize — so the images row, the original and the derivatives are exactly
    // what production writes.
    const bytes = await sharp({ create: { width: 1100, height: 700, channels: 3, background: { r: 60, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer()
    const granted = await requestImageUpload(storage, staffProfile, {
      declaredMime: 'image/jpeg',
      declaredBytes: bytes.byteLength,
      filename: 'drill-13a.jpg',
    })
    expect(granted.status).toBe('ready')
    if (granted.status !== 'ready') return
    const put = await fetch(granted.target.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      body: new Uint8Array(bytes),
    })
    expect(put.ok).toBe(true)

    const staff = (await signIn('staff@example.test', 'LocalStaff12345'))!
    const finalized = await finalizeImageUpload({ storage, database: staff }, staffProfile, {
      storagePath: granted.target.path,
      originalFilename: 'drill-13a.jpg',
    })
    expect(finalized.status).toBe('created')
    if (finalized.status !== 'created') return
    imagePath = granted.target.path
    imageId = finalized.imageId
    const { data: image } = await staff.from('images').select('derivatives').eq('id', imageId).single()
    derivativePaths = [...derivativePathsFor(imagePath, image!.derivatives)]
    await staff.auth.signOut({ scope: 'local' })

    // Content rows, as the database superuser — the door the seed itself uses.
    await sql(`
      insert into public.dishes (id, category_id, name, description, price_ore, sort_order, image_id)
      select '${DRILL.dish}', id, 'Drill-ret 13A', 'Oprettet af genskabelsesøvelsen', 12345, 990, '${imageId}'
        from public.menu_categories order by sort_order limit 1;
      insert into public.news (id, title, slug, category, display_date, status, published_at)
      values ('${DRILL.news}', 'Drill-nyhed 13A', 'drill-nyhed-13a', 'Nyt', current_date, 'published', now());
      insert into public.opening_hours_overrides (id, date, kind, opens_at, closes_at, status)
      values ('${DRILL.override}', date '2031-12-24', 'custom', time '10:00', time '14:00', 'published');
      update public.weekly_special
         set name = 'Drill-ugens ret 13A', iso_year = 2031, iso_week = 52, days = '{mon,tue}', price_small_ore = 8500
       where is_singleton;
      update public.announcement
         set message = 'Drill-besked 13A', expires_at = now() + interval '30 days', is_visible = true
       where is_singleton;
      update public.site_contact set draft = jsonb_build_object('primary_phone', '+45 00 00 00 00', 'drill', '13A') where is_singleton;
      update public.pages set draft = jsonb_build_object('drill', '13A') where key = 'takeaway';
    `)

    // A third identity with a password, through the Auth Admin API.
    const { data: created, error } = await service.auth.admin.createUser({
      email: DRILL.user.email,
      password: DRILL.user.password,
      email_confirm: true,
    })
    expect(error).toBeNull()
    const { error: profileError } = await service
      .from('profiles')
      .insert({ user_id: created.user!.id, name: DRILL.user.name, role: 'staff' })
    expect(profileError).toBeNull()

    // What must come back, byte for byte.
    before.dish = await rowJson('dishes', `id = '${DRILL.dish}'`)
    before.news = await rowJson('news', `id = '${DRILL.news}'`)
    before.override = await rowJson('opening_hours_overrides', `id = '${DRILL.override}'`)
    before.weekly = await rowJson('weekly_special', 'is_singleton')
    before.announcement = await rowJson('announcement', 'is_singleton')
    before.contact = await rowJson('site_contact', 'is_singleton')
    before.page = await rowJson('pages', `key = 'takeaway'`)
    before.image = await rowJson('images', `id = '${imageId}'`)
    before.profile = await rowJson('profiles', `user_id = '${created.user!.id}'`)
    before.auditCount = await sql('select count(*) from public.audit_log;')
    before.auditImage = await sql(`select count(*) from public.audit_log where entity = 'image' and entity_id = '${imageId}';`)
    before.migrations = await sql('select string_agg(version, \',\' order by version) from supabase_migrations.schema_migrations;')
    expect(before.dish).toContain('Drill-ret 13A')
    expect(Number(before.auditImage)).toBeGreaterThan(0)

    const original = await storage.downloadOriginal(imagePath)
    expect(original).not.toBeNull()
    binaries.set(`media-originals/${imagePath}`, sha256(original!))
    for (const path of derivativePaths) {
      const response = await fetch(`${SUPABASE_URL}${derivativePublicUrlPath(path)}`)
      expect(response.ok, path).toBe(true)
      binaries.set(`media/${path}`, sha256(new Uint8Array(await response.arrayBuffer())))
    }
    expect(binaries.size).toBe(1 + derivativePaths.length)
  })

  it('3. takes a complete recovery point with the backup command', async () => {
    const result = await command('backup.mjs', ['--out', workDir])
    expect(result.output, result.output).toContain('complete')
    expect(result.code).toBe(0)
    // No secret in the log: not the service-role key, not the database password.
    expect(result.output).not.toContain(SERVICE_ROLE_KEY!)
    expect(result.output).not.toMatch(/postgres:postgres@/)

    const [id] = await readdir(workDir)
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/)
    recoveryPoint = join(workDir, id!)
    const manifest = JSON.parse(await readFile(join(recoveryPoint, 'manifest.json'), 'utf8'))
    expect(manifest.complete).toBe(true)
    expect(manifest.components.database.rows['public.dishes']).toBeGreaterThan(1)
    expect(manifest.components.database.rows['public.audit_log']).toBe(Number(before.auditCount))
    expect(manifest.components.database.rows['auth.users']).toBe(3)
    expect(manifest.components.storage.buckets['media-originals'].objects.map((o: { key: string }) => o.key)).toEqual([imagePath])
    expect(manifest.components.storage.buckets['media'].objects.map((o: { key: string }) => o.key).sort()).toEqual([...derivativePaths].sort())
    expect(manifest.schema.appliedMigrations.join(',')).toBe(before.migrations)
    for (const [key, digest] of binaries) {
      expect(manifest.files[`storage/${key}`]?.sha256, key).toBe(digest)
    }
  })

  it('4. destroys the application data, the identities and the objects', async () => {
    await sql(`
      do $$
      declare v_tables text;
      begin
        select string_agg(format('%I.%I', schemaname, tablename), ', ') into v_tables from pg_tables where schemaname = 'public';
        execute 'truncate table ' || v_tables || ' cascade';
      end $$;
    `)
    const { data: users } = await service.auth.admin.listUsers({ perPage: 200 })
    for (const user of users.users) {
      const { error } = await service.auth.admin.deleteUser(user.id)
      expect(error).toBeNull()
    }
    await removeEveryObject()

    expect(await sql(`select count(*) from public.dishes;`)).toBe('0')
    expect(await sql('select count(*) from auth.users;')).toBe('0')
    expect(await signIn('owner@example.test', 'LocalOwner12345')).toBeNull()
    const gone = await fetch(`${SUPABASE_URL}${derivativePublicUrlPath(derivativePaths[0]!)}`)
    expect(gone.ok).toBe(false)
  })

  it('5. restores with the restore command', async () => {
    const dry = await command('restore.mjs', ['--from', recoveryPoint, '--dry-run'])
    expect(dry.output, dry.output).toContain('dry run')
    expect(dry.code).toBe(0)
    expect(await sql(`select count(*) from public.dishes;`)).toBe('0')

    const result = await command('restore.mjs', ['--from', recoveryPoint])
    expect(result.output, result.output).toContain('verified')
    expect(result.code).toBe(0)
    expect(result.output).not.toContain(SERVICE_ROLE_KEY!)
    expect(result.output).not.toMatch(/postgres:postgres@/)
  })

  it('6a. the representative rows are byte-identical', async () => {
    expect(await rowJson('dishes', `id = '${DRILL.dish}'`)).toBe(before.dish)
    expect(await rowJson('news', `id = '${DRILL.news}'`)).toBe(before.news)
    expect(await rowJson('opening_hours_overrides', `id = '${DRILL.override}'`)).toBe(before.override)
    expect(await rowJson('weekly_special', 'is_singleton')).toBe(before.weekly)
    expect(await rowJson('announcement', 'is_singleton')).toBe(before.announcement)
    expect(await rowJson('site_contact', 'is_singleton')).toBe(before.contact)
    expect(await rowJson('pages', `key = 'takeaway'`)).toBe(before.page)
    expect(await rowJson('images', `id = '${imageId}'`)).toBe(before.image)
    expect(await sql('select count(*) from public.audit_log;')).toBe(before.auditCount)
    expect(await sql(`select count(*) from public.audit_log where entity = 'image' and entity_id = '${imageId}';`)).toBe(before.auditImage)
    expect(await sql('select string_agg(version, \',\' order by version) from supabase_migrations.schema_migrations;')).toBe(before.migrations)
    // The dish still points at its photograph.
    expect(await sql(`select image_id from public.dishes where id = '${DRILL.dish}';`)).toBe(imageId)
  })

  it('6b. the image bytes are back, in the right bucket, with the right privacy', async () => {
    const original = await storage.downloadOriginal(imagePath)
    expect(original).not.toBeNull()
    expect(sha256(original!)).toBe(binaries.get(`media-originals/${imagePath}`))
    for (const path of derivativePaths) {
      const response = await fetch(`${SUPABASE_URL}${derivativePublicUrlPath(path)}`)
      expect(response.ok, path).toBe(true)
      expect(response.headers.get('content-type')).toMatch(/^image\/(avif|webp)/)
      expect(response.headers.get('cache-control')).toContain('max-age=31536000')
      expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(binaries.get(`media/${path}`))
    }
    // The private bucket stayed private.
    const leak = await fetch(`${SUPABASE_URL}/storage/v1/object/public/media-originals/${imagePath}`)
    expect(leak.ok).toBe(false)
  })

  it('6c. identities sign in with their old passwords', async () => {
    const profile = JSON.parse(before.profile!) as { user_id: string }
    const owner = await signIn('owner@example.test', 'LocalOwner12345')
    expect(owner).not.toBeNull()
    await owner!.auth.signOut({ scope: 'local' })
    const drill = await signIn(DRILL.user.email, DRILL.user.password)
    expect(drill).not.toBeNull()
    const { data } = await drill!.auth.getUser()
    expect(data.user!.id).toBe(profile.user_id)
    await drill!.auth.signOut({ scope: 'local' })
    expect(await rowJson('profiles', `user_id = '${profile.user_id}'`)).toBe(before.profile)
  })

  it('6d. RLS, the trusted functions and the guards work on the restored rows', async () => {
    // Anonymous: the published dish is readable, the audit log is not.
    const anon = await anonClient()
    const { data: dish } = await anon.from('dishes').select('name').eq('id', DRILL.dish).maybeSingle()
    expect(dish?.name).toBe('Drill-ret 13A')
    const { data: audit } = await anon.from('audit_log').select('id').limit(1)
    expect(audit ?? []).toEqual([])
    const { data: draftLeak } = await anon.from('site_contact').select('draft').maybeSingle()
    expect(draftLeak?.draft ?? null).toBeNull()

    // Staff: an immediate transition on a restored row, through its trusted function.
    const staff = (await signIn('staff@example.test', 'LocalStaff12345'))!
    const { data: row } = await staff.from('dishes').select('updated_at').eq('id', DRILL.dish).single()
    // The immediate path accepts only the Copenhagen-local date of the call (§7b).
    const today = await sql("select (now() at time zone 'Europe/Copenhagen')::date;")
    const soldOut = await staff.rpc('set_dish_sold_out', {
      p_id: DRILL.dish,
      p_sold_out_on: today,
      p_expected_updated_at: row!.updated_at,
    })
    expect(soldOut.error).toBeNull()
    expect(soldOut.data?.status).toBe('updated')
    expect(await sql(`select sold_out_on from public.dishes where id = '${DRILL.dish}';`)).toBe(today)
    const auditAfter = await sql('select count(*) from public.audit_log;')
    expect(Number(auditAfter)).toBe(Number(before.auditCount) + 1)

    // The BEFORE INSERT guard still refuses a direct write from a staff session.
    const forged = await staff.from('images').insert({ storage_path: 'forged/original.jpg' })
    expect(forged.error?.code).toBe('42501')
    await staff.auth.signOut({ scope: 'local' })
  })
})
