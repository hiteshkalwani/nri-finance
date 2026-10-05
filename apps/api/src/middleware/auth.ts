import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Claims } from '@nri/db'
import type { Config } from '../config'
import { ApiError } from '../errors'

export type AuthVars = { userId: string; email: string | null; claims: Claims }

// jose's exact wording for a non-200 JWKS response / an unparseable body (see jose/dist/webapi/jwks/remote.js).
// Matched on the literal message, not a "JSON Web Key Set" substring: JWKSNoMatchingKey and
// JWKSMultipleMatchingKeys also mention "JSON Web Key Set" in their message but mean "bad/rotated token", not an outage.
const JWKS_FETCH_FAILURE_MESSAGES = new Set([
  'Expected 200 OK from the JSON Web Key Set HTTP response',
  'Failed to parse the JSON Web Key Set HTTP response as JSON',
])

/** True when the key set could not be fetched (network, timeout, non-200, garbage) — an outage, not a bad token. */
function isJwksOutage(e: unknown): boolean {
  // A token with an unknown/rotated kid throws one of these even when the JWKS fetch succeeded — never an outage.
  if (e instanceof errors.JWKSNoMatchingKey || e instanceof errors.JWKSMultipleMatchingKeys) return false
  if (e instanceof errors.JWKSTimeout || e instanceof errors.JWKSInvalid) return true
  // Node's fetch() throws a TypeError with this exact message for any network-level failure (refused, DNS, etc.);
  // other TypeErrors (e.g. a bug in our own code) must not be mistaken for an outage.
  if (e instanceof TypeError && e.message === 'fetch failed') return true
  return e instanceof errors.JOSEError && JWKS_FETCH_FAILURE_MESSAGES.has(e.message)
}

export function authMiddleware(config: Config) {
  const issuer = `${config.supabaseUrl}/auth/v1`
  // Supabase Auth (local stack and hosted) signs ES256 tokens and publishes the keys at the JWKS URL. Inside docker
  // compose the keys are fetched via the internal address; the issuer check always uses the public URL.
  // A shared HS256 secret is only used by unit tests that mint their own tokens.
  const key: Uint8Array | JWTVerifyGetKey = config.jwtSecret
    ? new TextEncoder().encode(config.jwtSecret)
    : createRemoteJWKSet(new URL(`${config.authInternalUrl ?? config.supabaseUrl}/auth/v1/.well-known/jwks.json`))

  return createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const match = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')
    if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required')
    let claims: Claims
    try {
      const { payload } = await jwtVerify(match[1]!, key as Uint8Array, { issuer, audience: 'authenticated' })
      if (!payload.sub) throw new Error('token has no subject')
      claims = payload as Claims
    } catch (e) {
      if (!config.jwtSecret && isJwksOutage(e)) {
        throw new ApiError(503, 'AUTH_UNAVAILABLE', 'The sign-in service is unreachable right now. Please try again shortly.')
      }
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired or is invalid. Please sign in again.')
    }
    c.set('claims', claims)
    c.set('userId', claims.sub)
    c.set('email', typeof claims.email === 'string' ? claims.email : null)
    await next()
  })
}
