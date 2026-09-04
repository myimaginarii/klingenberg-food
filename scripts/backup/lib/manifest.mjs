/**
 * The recovery-point manifest — technical plan §10f; phase 13A (brief §11, §12).
 *
 * One JSON document per recovery point answers: when was it created, from which
 * project and which schema version, did every required component succeed, and
 * which files and objects belong together. The manifest is written LAST, so a
 * directory without one is an interrupted run, never a recovery point.
 *
 * `complete` is the one bit the restore reads first. It is true only when every
 * required component reports `ok`; a database dump beside a failed Storage export
 * is a partial recovery point that the restore refuses without `--allow-partial`.
 *
 * Retention is not the manifest's job and not a script's job: the destination's
 * lifecycle rule expires prefixes (§10f — "not by a script deleting things"). The
 * constants below are the contract that rule implements, so the runbook and the
 * tests state the same numbers.
 */

export const MANIFEST_FORMAT = 'klingenberg-food-backup/1'
export const MANIFEST_FILE = 'manifest.json'
export const LATEST_FILE = 'latest.json'

/** A recovery point is usable only when both of these succeeded (brief §12). */
export const REQUIRED_COMPONENTS = Object.freeze(['database', 'storage'])

/** The two tiers §10f names: weekly snapshots, and a monthly copy kept longer. */
export const TIERS = Object.freeze(['weekly', 'monthly'])

/**
 * §10f: "eight weekly snapshots plus one monthly kept for six months". Expressed as
 * the age at which the destination's lifecycle rule may expire a prefix, with a
 * margin so the eighth weekly point is never expired the morning the ninth fails.
 */
export const RETENTION = Object.freeze({
  weekly: Object.freeze({ keepDays: 63, intent: 'eight weekly recovery points, with one week of margin' }),
  monthly: Object.freeze({ keepDays: 190, intent: 'six monthly recovery points, with a margin' }),
})

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

/**
 * A recovery-point id: the UTC creation instant, second precision, with the
 * characters an object key and a Windows path both accept. Ids sort
 * chronologically as plain strings.
 *
 * @param {Date} date
 */
export function recoveryPointId(date) {
  if (Number.isNaN(date.getTime())) throw new Error('Cannot name a recovery point after an invalid date.')
  return date.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z'
}

/** @param {unknown} value @returns {value is string} */
export function isRecoveryPointId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

/** The instant a recovery-point id names. @param {string} id */
export function recoveryPointDate(id) {
  if (!isRecoveryPointId(id)) throw new Error(`Not a recovery-point id: ${JSON.stringify(id)}`)
  const iso = id.slice(0, 10) + 'T' + id.slice(11, 19).replace(/-/g, ':') + 'Z'
  return new Date(iso)
}

/** @param {string} tier */
export function assertTier(tier) {
  if (!TIERS.includes(tier)) throw new Error(`Unknown tier "${tier}". Expected one of: ${TIERS.join(', ')}.`)
  return /** @type {'weekly' | 'monthly'} */ (tier)
}

/**
 * @typedef {{ status: 'ok' | 'failed', error?: string }} ComponentStatus
 * @typedef {{ bytes: number, sha256: string }} FileFact
 */

/**
 * Assemble a manifest. `components` carry their own status; `complete` is derived,
 * never passed in, so no caller can declare a partial run complete.
 *
 * @param {{
 *   id: string,
 *   createdAt: string,
 *   tier: string,
 *   source: { apiHost: string, dbHost: string, projectRef: string | null },
 *   repository: { commit: string | null, migrations: string[] },
 *   schema: { appliedMigrations: string[] | null },
 *   components: Record<string, ComponentStatus & Record<string, unknown>>,
 *   files: Record<string, FileFact>,
 * }} input
 */
export function buildManifest(input) {
  if (!isRecoveryPointId(input.id)) throw new Error(`Invalid recovery-point id ${JSON.stringify(input.id)}`)
  assertTier(input.tier)
  const complete = REQUIRED_COMPONENTS.every((name) => input.components[name]?.status === 'ok')
  return {
    format: MANIFEST_FORMAT,
    id: input.id,
    createdAt: input.createdAt,
    tier: input.tier,
    complete,
    source: input.source,
    repository: input.repository,
    schema: input.schema,
    components: input.components,
    files: input.files,
  }
}

/** @param {unknown} manifest */
export function isComplete(manifest) {
  return validateManifest(manifest).length === 0 && /** @type {any} */ (manifest).complete === true
}

/**
 * Structural validation of a manifest read back from disk or from the destination.
 * Returns the problems found; an empty list means the document is a manifest this
 * tooling understands. Being complete is a separate question (`isComplete`).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateManifest(value) {
  /** @type {string[]} */
  const problems = []
  if (typeof value !== 'object' || value === null) return ['the manifest is not an object']
  const m = /** @type {Record<string, any>} */ (value)

  if (m.format !== MANIFEST_FORMAT) problems.push(`unknown format ${JSON.stringify(m.format)}`)
  if (!isRecoveryPointId(m.id)) problems.push(`invalid id ${JSON.stringify(m.id)}`)
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) {
    problems.push('createdAt is not a timestamp')
  }
  if (!TIERS.includes(m.tier)) problems.push(`unknown tier ${JSON.stringify(m.tier)}`)
  if (typeof m.complete !== 'boolean') problems.push('complete is not a boolean')

  if (typeof m.components !== 'object' || m.components === null) {
    problems.push('components is missing')
  } else {
    for (const name of REQUIRED_COMPONENTS) {
      const component = m.components[name]
      if (!component) problems.push(`component ${name} is missing`)
      else if (component.status !== 'ok' && component.status !== 'failed') {
        problems.push(`component ${name} has no status`)
      }
    }
    const claimed = REQUIRED_COMPONENTS.every((name) => m.components?.[name]?.status === 'ok')
    if (m.complete === true && !claimed) problems.push('complete is true but a required component did not succeed')
  }

  if (typeof m.files !== 'object' || m.files === null) {
    problems.push('files is missing')
  } else {
    for (const [name, fact] of Object.entries(m.files)) {
      const f = /** @type {any} */ (fact)
      if (typeof f?.bytes !== 'number' || typeof f?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
        problems.push(`file ${name} has no byte count or sha256`)
      }
    }
  }

  if (typeof m.schema !== 'object' || m.schema === null) problems.push('schema is missing')
  return problems
}

/**
 * Of several manifests, the newest complete one — what "the latest good recovery
 * point" means when an operator has to decide without a `latest.json`.
 *
 * @param {readonly unknown[]} manifests
 */
export function chooseLatest(manifests) {
  const usable = manifests.filter((m) => isComplete(m))
  usable.sort((a, b) => (/** @type {any} */ (a).id < /** @type {any} */ (b).id ? 1 : -1))
  return usable[0] ?? null
}

/**
 * The instant before which a recovery point of this tier is past its retention —
 * the same rule the destination's lifecycle configuration must implement.
 *
 * @param {string} tier
 * @param {Date} now
 */
export function retentionCutoff(tier, now) {
  const rule = RETENTION[assertTier(tier)]
  return new Date(now.getTime() - rule.keepDays * 24 * 60 * 60 * 1000)
}

/** Whether a recovery point is older than its tier's retention. @param {string} id @param {string} tier @param {Date} now */
export function isPastRetention(id, tier, now) {
  return recoveryPointDate(id).getTime() < retentionCutoff(tier, now).getTime()
}

/**
 * The destination key prefix of a recovery point: `<prefix>/<tier>/<id>`. The tier
 * is a path segment so that one lifecycle rule per tier is enough.
 *
 * @param {string} prefix
 * @param {string} tier
 * @param {string} id
 */
export function objectKeyPrefix(prefix, tier, id) {
  assertTier(tier)
  if (!isRecoveryPointId(id)) throw new Error(`Invalid recovery-point id ${JSON.stringify(id)}`)
  const trimmed = prefix.replace(/^\/+|\/+$/g, '')
  const segments = trimmed.split('/')
  if (!segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '..')) {
    throw new Error(`The destination prefix ${JSON.stringify(prefix)} must be plain path segments.`)
  }
  return `${trimmed}/${tier}/${id}`
}

/**
 * The small pointer document written beside the recovery points once — and only
 * once — a complete one has been shipped and verified.
 *
 * @param {ReturnType<typeof buildManifest>} manifest
 * @param {string} location
 */
export function latestPointer(manifest, location) {
  if (!isComplete(manifest)) throw new Error('Only a complete recovery point may become the latest pointer.')
  return {
    format: MANIFEST_FORMAT,
    id: manifest.id,
    createdAt: manifest.createdAt,
    tier: manifest.tier,
    location,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * How a target's applied migrations relate to the ones a backup was taken at —
 * the check behind the migration-compatibility rule (brief §17).
 *
 * @param {readonly string[]} target
 * @param {readonly string[]} backup
 * @returns {'equal' | 'target-newer' | 'target-older' | 'divergent'}
 */
export function compareMigrationHistories(target, backup) {
  const shorter = Math.min(target.length, backup.length)
  for (let i = 0; i < shorter; i += 1) {
    if (target[i] !== backup[i]) return 'divergent'
  }
  if (target.length === backup.length) return 'equal'
  return target.length > backup.length ? 'target-newer' : 'target-older'
}
