import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { MAP_ASSET, MAP_LICENCE_FILE } from './map-asset'

/**
 * The launch map guard — technical plan §7g ("a launch-blocking checklist item
 * that the placeholder must not reach production — enforced by a build-time
 * check on the provenance field in LICENSE.md"), §11, §13 item C; phase 14A.
 *
 * WHAT IT REFUSES, AND ONLY WHERE. A **real Vercel production build** —
 * `VERCEL_ENV=production`, the platform's own signal for the deployment that
 * serves the production domain — is refused while the map is still the
 * placeholder: the provenance field reads `placeholder`, the asset path is the
 * placeholder file, a required provenance row is missing, the licence names a
 * different file than the descriptor, or the file is not there.
 *
 * Everything else stays green, on purpose: local development, a local
 * `NODE_ENV=production` certification build (no `VERCEL_ENV`), CI's build, and
 * every Vercel **preview** build (`VERCEL_ENV=preview`) — a placeholder on a
 * protected preview is exactly what phase 14B reviews. No new environment
 * variable exists for this; the deployment signal the repository already
 * recognises (§0ak, `lib/config/site.ts`) is enough.
 *
 * WHAT IT VALIDATES. Provenance, never pixels: the fields the repository can
 * prove from the licence record. It does not know what a correct map looks
 * like, and it invents no licence — the image and its licence arrive in 14B.
 *
 * Run from `next.config.ts` in the production-build phase only, so the check
 * happens once per build and never at request time.
 */

export const PLACEHOLDER_PROVENANCE = 'placeholder'

/** The rows `public/map/LICENSE.md` must carry for the record to count (§7g, §11). */
export const REQUIRED_PROVENANCE_ROWS = ['Provenance', 'File', 'Source', 'Licence', 'Recorded'] as const

/** `| **Field** | value |` or `| Field | value |` — the licence's own table shape. */
const ROW_RE = /^\|\s*(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?:\*\*)?\s*\|\s*(.*?)\s*\|\s*$/gm

/** The licence table as a field → value map, backticks stripped from the values. */
export function parseMapProvenance(licence: string): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const match of licence.matchAll(ROW_RE)) {
    const field = match[1]!.trim()
    const value = match[2]!.trim().replace(/^`|`$/g, '').trim()
    if (field !== 'Field') rows[field] = value
  }
  return rows
}

export type MapProvenanceAssessment = {
  /** Whether this build is the one the guard exists for. */
  readonly launch: boolean
  readonly ok: boolean
  readonly provenance: string | null
  readonly reasons: string[]
}

/**
 * Decide, from facts alone. `vercelEnv` is `process.env.VERCEL_ENV`;
 * `assetExists` is whether the descriptor's file is on disk under `public/`.
 */
export function assessMapProvenance({
  licence,
  assetSrc,
  vercelEnv,
  assetExists,
}: {
  licence: string | null
  assetSrc: string
  vercelEnv: string | undefined
  assetExists: boolean
}): MapProvenanceAssessment {
  const launch = vercelEnv === 'production'
  const rows = licence === null ? {} : parseMapProvenance(licence)
  const provenance = rows['Provenance'] ?? null

  if (!launch) return { launch, ok: true, provenance, reasons: [] }

  const reasons: string[] = []
  if (licence === null) {
    reasons.push(`${MAP_LICENCE_FILE} is missing; the map has no provenance record.`)
  } else {
    for (const row of REQUIRED_PROVENANCE_ROWS) {
      if (!rows[row]) reasons.push(`${MAP_LICENCE_FILE} has no **${row}** row.`)
    }
    if (provenance?.toLowerCase() === PLACEHOLDER_PROVENANCE) {
      reasons.push(`${MAP_LICENCE_FILE} records the provenance "${PLACEHOLDER_PROVENANCE}": the licensed map has not arrived.`)
    }
    const named = rows['File']
    if (named && named !== basename(assetSrc)) {
      reasons.push(`${MAP_LICENCE_FILE} names the file "${named}" but the map descriptor renders "${basename(assetSrc)}".`)
    }
  }
  if (/placeholder/i.test(basename(assetSrc))) {
    reasons.push(`the map descriptor still renders the placeholder asset "${assetSrc}".`)
  }
  if (!assetExists) {
    reasons.push(`the map asset "${assetSrc}" does not exist under public/.`)
  }

  return { launch, ok: reasons.length === 0, provenance, reasons }
}

/**
 * Read the repository's own record and refuse a production deployment that
 * would ship the placeholder. Throws with every reason at once; returns the
 * assessment otherwise.
 */
export function assertLaunchMapProvenance({
  rootDir = process.cwd(),
  env = process.env,
}: {
  rootDir?: string
  env?: Record<string, string | undefined>
} = {}): MapProvenanceAssessment {
  const licencePath = join(rootDir, MAP_LICENCE_FILE)
  const licence = existsSync(licencePath) ? readFileSync(licencePath, 'utf8') : null
  const assessment = assessMapProvenance({
    licence,
    assetSrc: MAP_ASSET.src,
    vercelEnv: env.VERCEL_ENV,
    assetExists: existsSync(join(rootDir, 'public', ...MAP_ASSET.src.split('/').filter(Boolean))),
  })

  if (!assessment.ok) {
    throw new Error(
      'Launch map guard: this is a Vercel PRODUCTION build and the map is not launch-ready (technical plan §7g, §13 item C).\n' +
        assessment.reasons.map((reason) => `  - ${reason}`).join('\n') +
        '\nSupply the licensed map, its provenance and licence in public/map/ (phase 14B), or deploy to Preview.',
    )
  }
  return assessment
}
