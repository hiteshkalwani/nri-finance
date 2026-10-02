/** `jwtSecret` is only ever set by unit tests constructing a Config directly; real deployments verify via JWKS. */
export type Config = { supabaseUrl: string; jwtSecret?: string; databaseUrl: string }

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL
  const databaseUrl = env.DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('SUPABASE_URL and DATABASE_URL must be set')
  // SUPABASE_JWT_SECRET is deliberately not read: if it were set by mistake, HS256-only verification
  // would reject every real (ES256) Supabase token and nobody could sign in.
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), databaseUrl }
}
