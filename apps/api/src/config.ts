export type Config = { supabaseUrl: string; jwtSecret?: string; databaseUrl: string }

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL
  const databaseUrl = env.DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('SUPABASE_URL and DATABASE_URL must be set')
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), databaseUrl, jwtSecret: env.SUPABASE_JWT_SECRET || undefined }
}
