import { expect, it } from 'vitest'
import { safeNext } from '../src/lib/next'

it('keeps in-app paths and drops anything that could leave the app', () => {
  expect(safeNext('/spend?cycle=2026-10')).toBe('/spend?cycle=2026-10')
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'spend', '', undefined, ['/a']]) {
    expect(safeNext(bad)).toBe('/')
  }
})
