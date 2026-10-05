/**
 * `jwtSecret` is only ever set by unit tests constructing a Config directly; real deployments verify via JWKS.
 * `authInternalUrl` is only set inside docker compose, where the public Supabase URL points at the container itself.
 */
export type Config = { supabaseUrl: string; authInternalUrl?: string; jwtSecret?: string; databaseUrl: string }

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL
  const databaseUrl = env.DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('SUPABASE_URL and DATABASE_URL must be set')
  // SUPABASE_JWT_SECRET is deliberately not read: if it were set by mistake, HS256-only verification
  // would reject every real (ES256) Supabase token and nobody could sign in.
  const authInternalUrl = env.SUPABASE_AUTH_INTERNAL_URL?.replace(/\/$/, '')
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), databaseUrl, ...(authInternalUrl ? { authInternalUrl } : {}) }
}
