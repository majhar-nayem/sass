import { headers } from 'next/headers'
import { auth } from '@awning/auth'
import { withoutOrgContext } from '@awning/db'

/**
 * The single place a request's identity is established. Everything downstream --
 * tRPC context, page guards -- takes the user id from here and never from the client.
 */
export async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return null
  return withoutOrgContext('session', (db) =>
    db.users.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, is_platform_admin: true },
    }),
  )
}
