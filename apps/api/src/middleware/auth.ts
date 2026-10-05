import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Claims } from '@nri/db'
import type { Config } from '../config'
import { ApiError } from '../errors'

export type AuthVars = { userId: string; email: string | null; claims: Claims }

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
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired or is invalid. Please sign in again.')
    }
    c.set('claims', claims)
    c.set('userId', claims.sub)
    c.set('email', typeof claims.email === 'string' ? claims.email : null)
    await next()
  })
}
