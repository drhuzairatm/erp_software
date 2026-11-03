import { describe, expect, it } from 'vitest'
import { importTemplateCsv, mapHeaders, parseCsv, parseDate } from '@/server/services/student-import'

describe('CSV parsing', () => {
  it('handles quotes, embedded commas/newlines, BOM, CRLF and blank lines', () => {
    const t = '﻿Name,Notes\r\n"Doe, Jane","line1\nline2"\r\n\r\nPlain,"He said ""hi"""\r\n'
    expect(parseCsv(t)).toEqual([['Name', 'Notes'], ['Doe, Jane', 'line1\nline2'], ['Plain', 'He said "hi"']])
  })
  it('accepts semicolon-separated files', () => {
    expect(parseCsv('Name;Phone\nA;123')).toEqual([['Name', 'Phone'], ['A', '123']])
  })
  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('Name\n"broken')).toThrow(/unclosed/)
  })
})

describe('column recognition', () => {
  it('maps common header variants and reports ignored columns', () => {
    const m = mapHeaders(['Student Name', 'Mobile Number', 'E-mail', 'Destination', 'Lead_Source', 'Favourite colour'])
    expect(m.columns).toEqual(['fullName', 'phone', 'email', 'country', 'leadSource', null])
    expect(m.ignored).toEqual(['Favourite colour'])
    expect(m.missingRequired).toEqual([])
  })
  it('recognises the Leadist CRM export layout', () => {
    const m = mapHeaders(['Name', 'Phone', 'Email', 'Assigned To', 'Purpose', 'Address'])
    expect(m.columns).toEqual(['fullName', 'phone', 'email', 'counsellorEmail', 'purpose', null])
    expect(m.ignored).toEqual(['Address'])
  })
  it('requires a name and a phone or email column', () => {
    expect(mapHeaders(['Phone']).missingRequired).toEqual(['Full name'])
    expect(mapHeaders(['Name', 'Country']).missingRequired).toEqual(['Phone or Email'])
  })
})

describe('dates (day first)', () => {
  it('parses supported formats', () => {
    expect(parseDate('05/11/2026').value).toBe('2026-11-05')
    expect(parseDate('5-1-2026').value).toBe('2026-01-05')
    expect(parseDate('2026-11-05').value).toBe('2026-11-05')
    expect(parseDate('').value).toBeUndefined()
  })
  it('rejects impossible or ambiguous text', () => {
    expect(parseDate('31/02/2026').error).toMatch(/not a valid date/)
    expect(parseDate('Nov 5 2026').error).toMatch(/not a date/)
  })
})

describe('import template', () => {
  it('starts with the Leadist columns followed by Country and Course, and every column is recognised', () => {
    const [headers] = parseCsv(importTemplateCsv())
    expect(headers.slice(0, 7)).toEqual(['Name', 'Phone', 'Email', 'Assigned To', 'Purpose', 'Country', 'Course'])
    const m = mapHeaders(headers)
    expect(m.ignored).toEqual([])
    expect(m.columns.slice(5, 7)).toEqual(['country', 'course'])
  })
})
