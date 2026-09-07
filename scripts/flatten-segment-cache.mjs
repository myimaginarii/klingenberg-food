#!/usr/bin/env node
/**
 * Give the router's prefetches the filenames it actually asks for — a `postbuild` step.
 *
 * Next 16's client router prefetches each route's React payload from a **flat, dotted**
 * address under the page's own directory:
 *
 *     /menu/__next.!KHNpdGUp.menu.__PAGE__.txt
 *
 * `output: 'export'` writes that same payload as a **nested** path instead, splitting
 * on the dots the runtime does not split on:
 *
 *     out/menu/__next.!KHNpdGUp/menu/__PAGE__.txt
 *
 * Every other segment-cache file the router asks for (`__next._tree.txt`,
 * `__next.!KHNpdGUp.txt`) is written flat and resolves; only the `__PAGE__` payloads
 * are nested, which is what makes this look like a path-joining slip in the exporter
 * rather than a decision. The measured effect, on any static host: every prefetch
 * answers 404 (six of them on a first page view), the console fills with errors, and
 * each navigation falls back to a full document load instead of a client transition.
 * Nothing breaks — the site works, the links work, and the Playwright suite passed
 * before this script existed — but a production site should not 404 on every page.
 *
 * So this copies each nested payload to the flat name beside its `__next.…` directory,
 * joining the segments with dots. The nested files are left in place: they cost a few
 * kilobytes, and removing files the framework wrote to serve a purpose we have only
 * inferred would be the more confident of the two moves.
 *
 * This is a workaround for a framework bug and should be deleted when it is fixed. The
 * check is one command: build, serve `out/`, open a page and watch for a 404 on a
 * `__PAGE__.txt` request. No 404 means the exporter now writes the flat name itself.
 */

import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), process.argv[2] ?? 'out')

if (!existsSync(ROOT)) {
  console.error(`No static output at ${ROOT}. Run \`next build\` first.`)
  process.exit(1)
}

let flattened = 0

/** Every file under `directory`, as segment paths relative to it. */
function* filesUnder(directory, prefix = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      yield* filesUnder(full, [...prefix, entry])
    } else {
      yield { full, segments: [...prefix, entry] }
    }
  }
}

/** Walk the export, flattening every `__next.…` directory it holds. */
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (!statSync(full).isDirectory()) continue

    if (entry.startsWith('__next.')) {
      for (const { full: source, segments } of filesUnder(full)) {
        const flat = join(directory, [entry, ...segments].join('.'))
        if (!existsSync(flat)) {
          copyFileSync(source, flat)
          flattened += 1
        }
      }
      continue
    }

    if (entry === '_next') continue
    walk(full)
  }
}

walk(ROOT)

console.log(
  `segment cache: ${flattened} prefetch payload(s) given their flat name in ${basename(ROOT)}/`,
)
