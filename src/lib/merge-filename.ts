/** "Student Name - Passport Number - University Name.pdf", with fallbacks; safe for every OS. Never changes stored data. */
export function mergeFilename(name: string | null, passport: string | null, university: string | null, studentCode: string) {
  const clean = (v: string | null) => (v ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+-\s+/g, ' – ')
    .replace(/\s+/g, ' ').replace(/^[\s.–-]+|[\s.–-]+$/g, '').trim()
  const parts = [clean(name) || clean(studentCode), clean(passport).replace(/\s+/g, ''), clean(university)].filter(Boolean)
  let base = parts.join(' - ')
  if (base.length > 180) base = base.slice(0, 180).trim()
  return `${base || 'Student documents'}.pdf`
}

