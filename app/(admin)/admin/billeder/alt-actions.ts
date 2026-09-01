'use server'

import { redirect } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { expirePublicCacheTags } from '@/lib/cache/invalidate'
import { saveImageAltText } from '@/lib/images/admin'
import { rowId } from '@/lib/schemas/primitives'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import { encodeAltTextEcho, readAltTextForm, IMAGES_FORM } from './image-form'
import { imagesHref } from './routes'

/**
 * Editing an image's description — phase 10B (brief §10, §11).
 *
 * The one direct column write the 10A permission surface allows (`alt_text` alone,
 * §5's column-grant mechanism), through `lib/images/admin.ts`: authorized first,
 * validated, version-checked inside the UPDATE's own WHERE, and refused with a
 * Danish sentence — a refusal echoes what was typed, so nothing is lost while the
 * person corrects it. The action cannot move any other column: the grant refuses
 * every one of them regardless of what this file does.
 */
/*
 * A saved description is rendered into every live usage's public HTML (phase
 * 10C-2), so the tags the wrapper reports — the live references' own, draft-only
 * usages excluded — are expired here, after the write and only for `saved`
 * (§20, brief §19).
 */
export async function saveAltText(formData: FormData): Promise<void> {
  const profile = await requireStaff()

  const id = rowId('Billedet').safeParse(formData.get(IMAGES_FORM.imageId))
  const version = formData.get(IMAGES_FORM.version)

  if (!id.success || typeof version !== 'string' || version.length === 0) {
    redirect(imagesHref({ status: 'findes_ikke' }))
  }

  const form = readAltTextForm(formData)

  const supabase = await createSupabaseServerClient()
  const saved = await saveImageAltText(supabase, profile, {
    imageId: id.data,
    expectedUpdatedAt: version,
    altText: form.altText,
  })

  switch (saved.status) {
    case 'saved':
      // Only now, and only for what a guest can already see.
      expirePublicCacheTags(saved.cacheTags)
      redirect(imagesHref({ image: id.data, status: 'tekst_gemt' }))
      break
    case 'invalid':
      redirect(
        imagesHref(
          { image: id.data, status: 'ugyldig' },
          encodeAltTextEcho(form.altText, [`beskrivelse:${saved.error ?? 'ugyldig'}`]),
        ),
      )
      break
    case 'conflict':
      // The echo keeps what was typed on screen beside the fresh version (§6).
      redirect(
        imagesHref({ image: id.data, status: 'konflikt' }, encodeAltTextEcho(form.altText, [])),
      )
      break
    case 'not_found':
      redirect(imagesHref({ status: 'findes_ikke' }))
      break
    case 'forbidden':
      redirect(imagesHref({ image: id.data, status: 'afvist' }))
      break
    case 'failed':
      redirect(imagesHref({ image: id.data, status: 'fejl' }))
  }
}
