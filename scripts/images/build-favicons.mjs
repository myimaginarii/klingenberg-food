/**
 * Raster favicons from the approved K logo.
 *
 * `app/icon.svg` (the same file as `public/brand/logo.svg`) is the one source. This
 * writes the two raster companions the framework picks up by file convention:
 *
 * - `app/favicon.ico` — 16, 32 and 48 px in one file, served at `/favicon.ico`, the
 *   path browsers and Google's favicon crawler request when a page declares nothing
 *   they can use.
 * - `app/icon.png` — 192 px, a multiple of the 48 px Google Search asks for.
 *
 * The outputs are committed; this is not part of the build. Re-run it only when the
 * logo changes: `npm run images:favicons`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = `${root}app/icon.svg`

const ICO_SIZES = [16, 32, 48]
const PNG_SIZE = 192

/**
 * Rasterise once, large, then downsample: small sizes resized from a 1024 px render
 * keep the thin circle and the K's strokes smoother than rendering the vector at 16 px.
 */
async function master() {
  const svg = await readFile(source)
  return sharp(svg, { density: 300 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

function png(masterBuffer, size) {
  return sharp(masterBuffer)
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** An ICO container whose entries are PNG payloads (supported everywhere since Vista). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette colours
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)])
}

const big = await master()
const icoImages = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, data: await png(big, size) })),
)

await writeFile(`${root}app/favicon.ico`, ico(icoImages))
await writeFile(`${root}app/icon.png`, await png(big, PNG_SIZE))

console.log(`favicons: app/favicon.ico (${ICO_SIZES.join(', ')} px), app/icon.png (${PNG_SIZE} px)`)
