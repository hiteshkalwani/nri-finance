import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseV1File } from '../src/lib/importFile'

describe('parseV1File', () => {
  it('accepts a real v1 export', () => {
    // vitest runs with apps/web as the working directory
    const r = parseV1File(readFileSync(resolve(process.cwd(), '../../legacy/seed-data.json'), 'utf8'))
    expect(r.ok).toBe(true)
  })
  it('explains a file that is not JSON at all, instead of throwing', () => {
    expect(parseV1File('%PDF-1.7 binary junk')).toEqual({ ok: false, message: 'That file is not JSON. Choose the finance-data.json saved by the old app.' })
  })
  it('explains JSON that is not a v1 export, naming the first problem', () => {
    const r = parseV1File(JSON.stringify({ hello: 'world' }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/^That file is not a v1 finance-data\.json export \(settings: /)
  })
})
