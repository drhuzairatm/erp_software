import { describe, expect, it } from 'vitest'
import { checkPasswordStrength } from '@/lib/auth/password'
import { capitalise } from '@/lib/db'
import { resolveScope } from '@/services/scope'
import { toCsv } from '@/services/reports'
import { safeFilename, sniffMime } from '@/lib/storage'

describe('file type detection (does not trust the browser)', () => {
  it('recognises allowed types by content', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf')
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  })
  it('rejects everything else', () => {
    expect(sniffMime(Buffer.from('MZ\x90\0'))).toBeNull()
    expect(sniffMime(Buffer.from('<html><script>'))).toBeNull()
    expect(sniffMime(Buffer.alloc(0))).toBeNull()
  })
})

describe('safe filenames', () => {
  it('strips paths and unsafe characters', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('scan "copy";<x>.pdf')).toBe('scan _copy_x_.pdf')
    expect(safeFilename('')).toBe('document')
  })
})

describe('password policy', () => {
  it('requires length and variety', () => {
    expect(checkPasswordStrength('short1A!')).toMatch(/12 characters/)
    expect(checkPasswordStrength('alllowercaseletters')).toMatch(/three of/)
    expect(checkPasswordStrength('Rahul-Secret-2026', 'rahul@x.test')).toMatch(/email/)
    expect(checkPasswordStrength('Correct-Horse-42')).toBeNull()
  })
})

describe('company scope cannot be widened by the browser', () => {
  const ctx = { memberships: [{ orgId: 'a', orgName: 'A' }, { orgId: 'b', orgName: 'B' }] } as never
  const single = { memberships: [{ orgId: 'a', orgName: 'A' }] } as never
  it('falls back to a real membership for unknown values', () => {
    expect(resolveScope(single, 'some-other-company').orgIds).toEqual(['a'])
    expect(resolveScope(single, 'all').orgIds).toEqual(['a'])
    expect(resolveScope(ctx, 'all')).toMatchObject({ orgIds: ['a', 'b'], isAll: true })
    expect(resolveScope(ctx, 'b').orgIds).toEqual(['b'])
  })
})

describe('CSV export escaping', () => {
  it('quotes and neutralises formulas', () => {
    const csv = toCsv([{ key: 'v', label: 'V' }], [{ v: 'a,b' }, { v: '+cmd' }, { v: '@SUM(1)' }, { v: 'he said "hi"' }, { v: null }])
    expect(csv).toBe('﻿V\r\n"a,b"\r\n\'+cmd\r\n\'@SUM(1)\r\n"he said ""hi"""\r\n\r\n')
  })
})

describe('error messages', () => {
  it('capitalise keeps spacing and adds a full stop', () => {
    expect(capitalise('a reference number is required for this stage')).toBe('A reference number is required for this stage.')
    expect(capitalise('  only drafts can be deleted. ')).toBe('Only drafts can be deleted.')
  })
})
