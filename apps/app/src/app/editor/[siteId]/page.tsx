import { notFound, redirect } from 'next/navigation'
import { appRouter, createCallerFactory } from '@awning/api'
import { createPreviewToken } from '@awning/tenancy'
import { currentUser } from '@/lib/session'
import { Editor } from './editor'

export const dynamic = 'force-dynamic'
const createCaller = createCallerFactory(appRouter)

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ note?: string }>
}) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { siteId } = await params
  const { note } = await searchParams

  const caller = createCaller({ userId: user.id, isPlatformAdmin: user.is_platform_admin })
  // Goes through the same orgProcedure as the HTTP API: no privileged path for our own UI.
  const site = await caller.site.get({ siteId }).catch(() => null)
  if (!site) notFound()

  const [versions, quota] = await Promise.all([
    caller.site.listVersions({ siteId }),
    caller.ai.quota(),
  ])

  const previewBase = process.env.PREVIEW_BASE_URL ?? 'http://localhost:3001'
  const token = createPreviewToken(siteId)

  return (
    <Editor
      siteId={siteId}
      siteName={site.name}
      status={site.status}
      subdomain={site.slug}
      previewUrl={`${previewBase}/preview/${siteId}?t=${token}`}
      versions={versions.map((v) => ({ id: v.id, version: v.version, summary: v.summary, createdBy: v.created_by }))}
      quota={{ used: quota.used, limit: quota.limit }}
      startedFromTemplate={note === 'template'}
    />
  )
}
