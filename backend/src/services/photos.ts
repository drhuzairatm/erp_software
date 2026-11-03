import sharp from 'sharp'
import { invalid } from '../lib/errors'
import { refuseIfInfected } from '../lib/security/file-scan'
import { getStorage, newStorageKey, safeFilename, sniffMime, SIGNED_URL_TTL_SECONDS } from '../lib/storage'
import * as photosRepo from '../repositories/photos.repository'
import { type Ctx, run } from './base'

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PORTRAIT_RATIO = 35 / 45 // passport photo (width / height)
const UUID = /^[0-9a-f-]{36}$/i

export interface Crop { x: number; y: number; width: number; height: number }

/** Parses the crop rectangle (pixels of the upright image) sent by the cropper. */
export function parseCrop(raw: unknown): Crop | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const c = JSON.parse(raw) as Record<string, unknown>
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN)
    const crop = { x: n(c.x), y: n(c.y), width: n(c.width), height: n(c.height) }
    return Object.values(crop).every((v) => !Number.isNaN(v)) ? crop : null
  } catch { return null }
}

/**
 * Validates and processes an uploaded photo. Checks the real file signature (not the name), decodes the image,
 * applies the EXIF orientation and then drops ALL metadata (EXIF, GPS, ICC comments) from every stored version.
 */
export async function processPhoto(file: File, crop: Crop | null, ratio = PORTRAIT_RATIO) {
  if (!file || file.size === 0) throw invalid('Choose a photo.', { photo: ['Required.'] })
  if (file.size > PHOTO_MAX_BYTES) throw invalid('The photo is larger than 5 MB.', { photo: ['Maximum 5 MB.'] })
  const buf = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buf)
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw invalid('Please upload a JPG or PNG photo.', { photo: ['JPG or PNG only.'] })
  let upright: Buffer; let meta: { width: number; height: number }
  try {
    // limitInputPixels guards against decompression bombs; failOn rejects malformed files
    const r = await sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().toBuffer({ resolveWithObject: true })
    upright = r.data; meta = r.info
  } catch {
    throw invalid('The photo could not be read. It may be damaged; please choose another file.', { photo: ['Unreadable image.'] })
  }
  if (meta.width < 200 || meta.height < 200) throw invalid('The photo is too small (at least 200 × 200 pixels).', { photo: ['Too small.'] })
  // crop: default = largest centred passport-format area
  let c = crop
  if (!c) {
    const h = Math.min(meta.height, Math.round(meta.width / ratio))
    const w = Math.round(h * ratio)
    c = { x: Math.round((meta.width - w) / 2), y: Math.round((meta.height - h) / 2), width: w, height: h }
  }
  c = { x: Math.max(0, c.x), y: Math.max(0, c.y), width: Math.max(1, c.width), height: Math.max(1, c.height) }
  c.width = Math.min(c.width, meta.width - c.x); c.height = Math.min(c.height, meta.height - c.y)
  if (c.width < 150 || c.height < 150) throw invalid('The selected area is too small. Zoom out a little.', { photo: ['Crop too small.'] })
  if (Math.abs(c.width / c.height - ratio) > 0.05) throw invalid(ratio === 1 ? 'The crop must be square.' : 'The crop must be in passport (portrait) format.', { photo: ['Wrong format.'] })
  const original = mime === 'image/png'
    ? await sharp(upright).png({ compressionLevel: 9 }).toBuffer()
    : await sharp(upright).jpeg({ quality: 95, mozjpeg: true }).toBuffer()
  const portrait = await sharp(upright).extract({ left: c.x, top: c.y, width: c.width, height: c.height }).resize({ height: Math.min(c.height, 1800), withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 93, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  // square avatar from the upper part of the portrait (where the face is in a passport photo)
  const side = c.width // portrait is taller than wide, so a full-width square fits
  const top = Math.min(c.y + Math.round(c.height * 0.08), c.y + c.height - side)
  const thumb = await sharp(upright).extract({ left: c.x, top, width: side, height: side })
    .resize(256, 256, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
  return { original, mime, portrait: portrait.data, width: portrait.info.width, height: portrait.info.height, thumb }
}

export async function saveStudentPhoto(ctx: Ctx, studentId: string, file: File, crop: Crop | null) {
  if (!UUID.test(studentId)) throw invalid('Unknown student.')
  const [s] = await run(ctx, (tx) => tx<{ org: string; can: boolean }[]>`
    select originating_org_id as org, app.can_on_student(${studentId}, 'students.update') as can from v_students where id = ${studentId}`)
  if (!s?.can) throw invalid('You cannot change this student\'s photo.')
  await refuseIfInfected(ctx, Buffer.from(await file.arrayBuffer()), `student photo ${studentId}`)
  const p = await processPhoto(file, crop)
  const storage = await getStorage()
  const base = newStorageKey(s.org, studentId)
  const keys = { original: `${base}-photo-original`, portrait: `${base}-photo-portrait`, thumb: `${base}-photo-thumb` }
  await storage.put(keys.original, p.original, p.mime)
  await storage.put(keys.portrait, p.portrait, 'image/jpeg')
  await storage.put(keys.thumb, p.thumb, 'image/jpeg')
  try {
    const [r] = await run(ctx, (tx) => tx<{ old: string[] }[]>`
      select app.set_student_photo(${studentId}, ${keys.original}, ${p.mime}, ${keys.portrait}, ${keys.thumb}, ${p.width}, ${p.height}, ${p.portrait.length}) as old`)
    await purge(r.old)
  } catch (e) {
    await purge(Object.values(keys)) // nothing half-saved
    throw e
  }
}

export async function removeStudentPhoto(ctx: Ctx, studentId: string) {
  const [r] = await run(ctx, (tx) => tx<{ old: string[] }[]>`select app.remove_student_photo(${studentId}) as old`)
  await purge(r.old)
}

async function purge(keys: string[]) {
  const storage = await getStorage()
  for (const k of keys ?? []) await storage.remove(k).catch(() => {})
}

/** Bytes of the avatar / portrait for display (authorised in the database). */
export async function studentPhotoBytes(ctx: Ctx, studentId: string, variant: 'thumb' | 'portrait') {
  if (!UUID.test(studentId)) return null
  const [f] = await run(ctx, (tx) => photosRepo.studentPhotoFile(tx, studentId, variant))
  if (!f) return null
  return { data: await (await getStorage()).get(f.storage_key), mime: f.mime_type, version: f.version }
}

/** Short-lived signed URL for downloading the passport photo, named Name_StudentID_PassportPhoto.jpg (audited). */
export async function studentPhotoDownloadUrl(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  return run(ctx, async (tx) => {
    const [f] = await photosRepo.studentPhotoDownloadFile(tx, studentId)
    if (!f) return null
    const [s] = await photosRepo.studentNameAndCode(tx, studentId)
    const name = safeFilename(`${s.full_name.replace(/\s+/g, '')}_${s.student_code}_PassportPhoto.jpg`)
    return (await getStorage()).signedUrl(f.storage_key, { filename: name, contentType: 'image/jpeg', expiresInSeconds: SIGNED_URL_TTL_SECONDS })
  })
}

export async function currentPhoto(ctx: Ctx, studentId: string) {
  if (!UUID.test(studentId)) return null
  const [p] = await run(ctx, (tx) => photosRepo.currentStudentPhoto(tx, studentId))
  return p ?? null
}
