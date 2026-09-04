/**
 * Process execution and logging for the backup tooling — technical plan §8 (log
 * hygiene); phase 13A (brief §13).
 *
 * Two rules, both mechanical:
 *
 *   * A child process receives secrets through its environment, never through its
 *     arguments. Every caller passes an explicit `env`; nothing here appends to a
 *     command line.
 *   * Nothing reaches a log line or an error message without passing the logger's
 *     redaction, which knows every secret value the run holds. GitHub's own masking
 *     is the second line of defence, never the first (§10f).
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

import { redactSecrets } from './targets.mjs'

const STDERR_TAIL = 4000

/**
 * How to start `file`. On Windows a `.cmd`/`.bat` entry point (the pip-installed
 * AWS CLI, for one) cannot be spawned directly, so it is run through the command
 * interpreter with every argument double-quoted and verbatim. Arguments that could
 * break out of a quote are refused rather than escaped — nothing this tooling
 * passes contains them.
 *
 * @param {string} file
 * @param {readonly string[]} args
 */
/** A double quote, a percent sign (cmd.exe expands them), a carriage return or a newline. */
const UNQUOTABLE = new RegExp('["%' + String.fromCharCode(13) + String.fromCharCode(10) + ']')

export function spawnSpec(file, args) {
  if (process.platform === 'win32' && /[.](cmd|bat)$/i.test(file)) {
    for (const argument of [file, ...args]) {
      if (UNQUOTABLE.test(argument)) throw new Error(`Refusing to pass ${JSON.stringify(argument)} to ${file} through cmd.exe.`)
    }
    const line = [file, ...args].map((argument) => `"${argument}"`).join(' ')
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      options: { windowsVerbatimArguments: true },
    }
  }
  return { file, args: [...args], options: {} }
}

/**
 * @typedef {{
 *   info(message: string): void,
 *   warn(message: string): void,
 *   error(message: string): void,
 *   redact(text: string): string,
 *   addSecret(value: string): void,
 * }} Logger
 */

/**
 * @param {{ secrets?: readonly string[], sink?: { log(m: string): void, error(m: string): void } }} [options]
 * @returns {Logger}
 */
export function createLogger({ secrets = [], sink = console } = {}) {
  /** @type {string[]} */
  const known = [...secrets]
  const redact = (/** @type {string} */ text) => redactSecrets(text, known)
  const stamp = () => new Date().toISOString().slice(11, 19)
  return {
    info: (message) => sink.log(`[${stamp()}] ${redact(message)}`),
    warn: (message) => sink.error(`[${stamp()}] warning: ${redact(message)}`),
    error: (message) => sink.error(`[${stamp()}] error: ${redact(message)}`),
    redact,
    addSecret: (value) => {
      if (value) known.push(value)
    },
  }
}

/**
 * Run a command to completion, capturing its output. Rejects with a redacted
 * message when it exits non-zero or cannot be started. `input` is written to stdin.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {{ env: Record<string, string | undefined>, cwd?: string, input?: string, logger?: Logger, maxBuffer?: number }} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function run(file, args, { env, cwd, input, logger, maxBuffer = 256 * 1024 * 1024 }) {
  const redact = logger?.redact ?? ((/** @type {string} */ s) => s)
  return new Promise((resolve, reject) => {
    const spec = spawnSpec(file, args)
    const child = spawn(spec.file, spec.args, { ...spec.options, env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    /** @type {Buffer[]} */
    const out = []
    /** @type {Buffer[]} */
    const err = []
    let size = 0
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBuffer) {
        child.kill()
        reject(new Error(`${file} produced more than ${maxBuffer} bytes of output.`))
        return
      }
      out.push(chunk)
    })
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => reject(new Error(`Could not start ${file}: ${redact(error.message)}`)))
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${file} ${args[0] ?? ''} exited with code ${code}: ${redact(stderr.slice(-STDERR_TAIL).trim())}`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/**
 * Run a command and stream its stdout into a file — for pg_dump, whose output may
 * be larger than anything worth holding in memory.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {string} outFile
 * @param {{ env: Record<string, string | undefined>, logger?: Logger }} options
 * @returns {Promise<{ bytes: number }>}
 */
export function runToFile(file, args, outFile, { env, logger }) {
  const redact = logger?.redact ?? ((/** @type {string} */ s) => s)
  return new Promise((resolve, reject) => {
    const spec = spawnSpec(file, args)
    const child = spawn(spec.file, spec.args, { ...spec.options, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const sink = createWriteStream(outFile)
    /** @type {Buffer[]} */
    const err = []
    let bytes = 0
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
    })
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => reject(new Error(`Could not start ${file}: ${redact(error.message)}`)))
    const finished = pipeline(child.stdout, sink)
    child.on('close', (code) => {
      finished.then(
        () => {
          if (code === 0) resolve({ bytes })
          else {
            const stderr = Buffer.concat(err).toString('utf8')
            reject(new Error(`${file} ${args[0] ?? ''} exited with code ${code}: ${redact(stderr.slice(-STDERR_TAIL).trim())}`))
          }
        },
        (error) => reject(new Error(`Writing ${outFile} failed: ${redact(error.message)}`)),
      )
    })
  })
}

/** Whether `file --version` runs at all. @param {string} file @param {Record<string, string | undefined>} env */
export async function commandVersion(file, env) {
  try {
    const { stdout } = await run(file, ['--version'], { env })
    return stdout.trim()
  } catch {
    return null
  }
}

/** @param {Buffer | Uint8Array} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** @param {string} path @returns {Promise<{ bytes: number, sha256: string }>} */
export async function sha256File(path) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}
