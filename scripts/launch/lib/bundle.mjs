/**
 * A temporary SQL bundle on disk — phase 14A.
 *
 * The pg door runs `-f` files after `-c` commands (the restore's ordering), and
 * both launch loads need "this SQL, then a row recording it" inside ONE
 * transaction. So the bundle is written as one file to a temporary directory the
 * door can mount, run, and removed again whatever happened.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @template T
 * @param {string} name a plain file name for the bundle
 * @param {string} sql
 * @param {(location: { dir: string, file: string }) => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withSqlBundle(name, sql, run) {
  const dir = await mkdtemp(join(tmpdir(), 'klingenberg-launch-'))
  try {
    await writeFile(join(dir, name), sql, 'utf8')
    return await run({ dir, file: name })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
