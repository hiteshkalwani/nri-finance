import { V1Document } from '@nri/contracts'

export type ParsedV1 = { ok: true; doc: V1Document } | { ok: false; message: string }

export function parseV1File(text: string): ParsedV1 {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'That file is not JSON. Choose the finance-data.json saved by the old app.' }
  }
  const r = V1Document.safeParse(raw)
  if (r.success) return { ok: true, doc: r.data }
  const first = r.error.issues[0]
  const where = first ? `${first.path.join('.') || 'file'}: ${first.message}` : 'unknown problem'
  return { ok: false, message: `That file is not a v1 finance-data.json export (${where}).` }
}
