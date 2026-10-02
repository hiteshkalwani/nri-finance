/** Security headers for every response. `supabaseUrl` must be the URL baked into the web bundle. */
export function securityHeaders(supabaseUrl) {
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is empty: the CSP would block every Supabase sign-in request. Set it before building.')
  }
  const { protocol, hostname, origin } = new URL(supabaseUrl)
  const local = hostname === 'localhost' || hostname === '127.0.0.1'
  if (protocol !== 'https:' && !local) throw new Error(`VITE_SUPABASE_URL must use https in production (got ${supabaseUrl})`)
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${origin}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  }
}
