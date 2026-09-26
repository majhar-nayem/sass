import { describe, expect, it } from 'vitest'
import { appPrisma, rawPrisma } from '../client.js'

/**
 * F-06 -- the meta-test: is this suite testing anything?
 *
 * Postgres exempts a table owner from RLS, and the request-path client falls back to
 * the owner when APP_DATABASE_URL is unset. CI was in that state — it set DATABASE_URL
 * and DIRECT_URL only — so had CI ever reached the test step, the isolation suite would
 * have failed in nine confusing places at once, all of them describing symptoms rather
 * than the cause.
 *
 * This asserts the precondition those suites depend on, so a misconfigured environment
 * says what is actually wrong instead.
 */
describe('the suite is actually exercising RLS', () => {
  it('the request-path client is not the table owner', async () => {
    const rows = await appPrisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`
    expect(rows[0]?.current_user).toBe('awning_app')
  })

  it('and the owner client really is the owner', async () => {
    const rows = await rawPrisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`
    expect(rows[0]?.current_user).not.toBe('awning_app')
  })

  it('RLS is enabled on the tables it is meant to protect', async () => {
    const rows = await rawPrisma.$queryRaw<Array<{ relname: string }>>`
      SELECT relname FROM pg_class
      WHERE relname IN ('sites', 'organizations', 'form_submissions', 'site_versions')
        AND relrowsecurity = false`
    expect(rows.map((r) => r.relname)).toEqual([])
  })
})
