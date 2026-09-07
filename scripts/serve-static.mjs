#!/usr/bin/env node
/**
 * Serve the static export — `npm start`, and the Playwright suite's own server.
 *
 * `next build` writes the whole site to `out/`; this hands those files to a browser and
 * does nothing else. There is no framework here on purpose: the deployed site will be
 * served by a plain static host (GitHub Pages), and a preview that ran a Next.js server
 * would be testing something the deployment does not have.
 *
 * It imitates the three behaviours a static host gives a `trailingSlash: true` export:
 *
 *   * a directory serves its `index.html` (`/menu/` -> `out/menu/index.html`);
 *   * a path with no trailing slash redirects to one, as GitHub Pages does;
 *   * anything that matches no file gets `out/404.html` with status 404.
 *
 * Usage: `node scripts/serve-static.mjs [--port 3000] [--dir out]`
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const args = process.argv.slice(2)

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const PORT = Number(flag('port', process.env.PORT ?? 3000))
const ROOT = resolve(process.cwd(), flag('dir', 'out'))

const CONTENT_TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }),
)

if (!existsSync(ROOT)) {
  console.error(`No static output at ${ROOT}. Run \`npm run build\` first.`)
  process.exit(1)
}

/** The file inside `out/` a request path names, or `null` when it escapes the root. */
function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname)
  const candidate = resolve(ROOT, `.${normalize(decoded)}`)
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
  return candidate
}

function send(response, status, file) {
  const type = CONTENT_TYPES.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
  response.writeHead(status, { 'content-type': type, 'content-length': statSync(file).size })
  createReadStream(file).pipe(response)
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`)
  const target = resolveRequest(pathname)

  if (target === null) {
    response.writeHead(400).end('Bad request')
    return
  }

  if (existsSync(target) && statSync(target).isFile()) {
    send(response, 200, target)
    return
  }

  const index = join(target, 'index.html')
  if (existsSync(index)) {
    // A static host redirects `/menu` to `/menu/` before serving the directory.
    if (!pathname.endsWith('/')) {
      response.writeHead(308, { location: `${pathname}/` }).end()
      return
    }
    send(response, 200, index)
    return
  }

  const notFound = join(ROOT, '404.html')
  if (existsSync(notFound)) {
    send(response, 404, notFound)
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
})

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}`)
})
