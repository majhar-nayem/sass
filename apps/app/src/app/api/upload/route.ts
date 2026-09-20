import { withoutOrgContext } from '@awning/db'
import { membershipFor } from '@awning/auth'
import { processUpload, UnsupportedImage } from '@awning/integrations/images'
import { randomUUID } from 'node:crypto'
import { assetIdFor, assetKey, storage } from '@awning/integrations/storage'
import { rateLimit } from '@awning/integrations/rate-limit'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'
// sharp needs the Node runtime, and re-encoding a 10 MB photo is not a 5-second job.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * P-07 -- image upload.
 *
 * Deliberately NOT a presigned direct-to-R2 upload, which would be faster and cheaper.
 * A presigned PUT stores exactly the bytes the browser sent, and we need to decode and
 * re-encode every file: to strip EXIF (a phone photo of a home-based business carries
 * the owner's home address), to neutralise polyglots, and to cap dimensions. None of
 * that is possible if the file never passes through us.
 */
export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return Response.json({ ok: false, message: 'Please sign in.' }, { status: 401 })

  const limit = await rateLimit(`upload:${user.id}`, 40, 3600)
  if (!limit.allowed)
    return Response.json({ ok: false, message: 'Too many uploads just now.' }, { status: 429 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const siteId = String(form?.get('siteId') ?? '')
  const kind = String(form?.get('kind') ?? 'image')

  if (!(file instanceof File))
    return Response.json({ ok: false, message: 'No file received.' }, { status: 400 })
  if (!siteId) return Response.json({ ok: false, message: 'No site given.' }, { status: 400 })

  // Membership is resolved from the session, never from the request body.
  const membership = await membershipFor(user.id)
  if (!membership) return Response.json({ ok: false, message: 'Not permitted.' }, { status: 403 })

  const site = await withoutOrgContext('session', (db) =>
    db.sites.findFirst({ where: { id: siteId, org_id: membership.orgId }, select: { id: true } }),
  )
  if (!site) return Response.json({ ok: false, message: 'Not permitted.' }, { status: 403 })

  let processed
  try {
    processed = await processUpload(Buffer.from(await file.arrayBuffer()), {
      // A logo is shown small and often on a coloured bar; a full-width photo is not.
      maxDimension: kind === 'logo' ? 600 : kind === 'favicon' ? 256 : 2400,
      square: kind === 'favicon',
    })
  } catch (e) {
    if (e instanceof UnsupportedImage)
      return Response.json({ ok: false, message: e.message }, { status: 400 })
    return Response.json(
      { ok: false, message: 'We could not read that image. Try a JPEG or PNG.' },
      { status: 400 },
    )
  }

  const key = assetKey(siteId, processed.body, processed.ext)
  const stored = await storage().put(key, processed.body, processed.contentType)
  const id = randomUUID()

  await withoutOrgContext('session', (db) =>
    db.site_assets.create({
      data: {
        id,
        site_id: siteId,
        org_id: membership.orgId,
        kind,
        r2_key: stored.key,
        public_url: stored.url,
        filename: file.name.slice(0, 200),
        mime_type: processed.contentType,
        bytes: stored.bytes,
        width: processed.width,
        height: processed.height,
        blurhash: processed.blurDataUrl.slice(0, 2000),
        source: 'upload',
        uploaded_by: user.id,
      },
    }),
  )

  return Response.json({
    ok: true,
    // The id the spec references. The URL is for showing it back in the editor.
    assetId: assetIdFor(id),
    url: stored.url,
    width: processed.width,
    height: processed.height,
  })
}
