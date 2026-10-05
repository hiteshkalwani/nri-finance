/** Where to go after sign-in: only an in-app path (starts with "/", not "//" or "/\"), otherwise home. */
export function safeNext(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/'
}
