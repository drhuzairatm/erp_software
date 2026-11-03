/** Student passport photos: validation, processing (EXIF removed, portrait kept, 256×256 thumbnail), permissions, history, filter. */
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { ServiceError } from '@/server/errors'
import { getStorage } from '@/server/storage'
import * as photos from '@/server/services/photos'
import * as students from '@/server/services/students'
import { adminSql, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
beforeAll(async () => { EDX = await orgId('EDX') })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return e as ServiceError }
  throw new Error('expected ServiceError')
}
/** A fictional test image (plain colour) with EXIF incl. GPS-like data when JPEG. */
async function image(kind: 'jpeg' | 'png', w = 700, h = 900) {
  const base = sharp({ create: { width: w, height: h, channels: 3, background: '#e8eef5' } })
  const buf = kind === 'jpeg'
    ? await base.jpeg().withExif({ IFD0: { Copyright: 'fictional-test', Artist: 'GPS 10.0,76.0' } }).toBuffer()
    : await base.png().toBuffer()
  return new File([new Uint8Array(buf)], kind === 'jpeg' ? 'photo.jpeg' : 'photo.png', { type: `image/${kind}` })
}
async function newStudent() {
  const mgr = await ctxFor('edx.manager@demo.test')
  const r = await students.createStudent(mgr, { originatingOrgId: EDX, fullName: 'Photo Student', phone: `+91 90091 ${rand()}` })
  if (!r.ok) throw new Error()
  return { mgr, id: r.id }
}

describe('student photos', () => {
  it('JPG and PNG are processed: metadata removed, portrait preserved, 256×256 thumbnail, crop respected', async () => {
    for (const kind of ['jpeg', 'png'] as const) {
      const { mgr, id } = await newStudent()
      await photos.saveStudentPhoto(mgr, id, await image(kind), { x: 0, y: 0, width: 700, height: 900 })
      const [p] = await adminSql()`select original_key, portrait_key, thumb_key, width, height, original_mime from student_photos where student_id = ${id} and is_current`
      expect(p.original_mime).toBe(`image/${kind}`)
      const storage = await getStorage()
      const original = await sharp(await storage.get(p.original_key)).metadata()
      const portrait = await sharp(await storage.get(p.portrait_key)).metadata()
      const thumb = await sharp(await storage.get(p.thumb_key)).metadata()
      expect(original.exif).toBeUndefined()
      expect(portrait.exif).toBeUndefined()
      expect([original.width, original.height]).toEqual([700, 900])
      expect(portrait.width! / portrait.height!).toBeCloseTo(35 / 45, 1)
      expect([thumb.width, thumb.height]).toEqual([256, 256])
      expect((await photos.currentPhoto(mgr, id))?.version).toBe(1)
    }
  })

  it('rejects files over 5 MB, renamed non-images, unreadable images and wrong crop formats', async () => {
    const { mgr, id } = await newStudent()
    await expectServiceError(photos.saveStudentPhoto(mgr, id, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }), null), 'invalid')
    await expectServiceError(photos.saveStudentPhoto(mgr, id, new File([Buffer.from('%PDF-1.4 not an image')], 'photo.jpg', { type: 'image/jpeg' }), null), 'invalid')
    await expectServiceError(photos.saveStudentPhoto(mgr, id, new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'broken.jpg', { type: 'image/jpeg' }), null), 'invalid')
    await expectServiceError(photos.saveStudentPhoto(mgr, id, await image('png'), { x: 0, y: 0, width: 700, height: 700 }), 'invalid')
    expect(await photos.currentPhoto(mgr, id)).toBeNull()
  })

  it('replace and remove keep history and delete the superseded files; only permitted staff can change or view', async () => {
    const { mgr, id } = await newStudent()
    await photos.saveStudentPhoto(mgr, id, await image('jpeg'), null)
    const [v1] = await adminSql()`select thumb_key from student_photos where student_id = ${id} and version = 1`
    await photos.saveStudentPhoto(mgr, id, await image('png'), null)
    expect((await photos.currentPhoto(mgr, id))?.version).toBe(2)
    await expect((await getStorage()).get(v1.thumb_key)).rejects.toThrow()
    // other company's staff cannot see or change it
    const grd = await ctxFor('grd.counsellor@demo.test')
    expect(await photos.studentPhotoBytes(grd, id, 'thumb')).toBeNull()
    expect(await photos.studentPhotoDownloadUrl(grd, id)).toBeNull()
    await expectServiceError(photos.saveStudentPhoto(grd, id, await image('jpeg'), null))
    // download is audited
    expect(await photos.studentPhotoDownloadUrl(mgr, id)).toBeTruthy()
    expect((await adminSql()`select 1 from audit_logs where action = 'photo_download' and student_id = ${id} and outcome = 'success'`).length).toBe(1)
    await photos.removeStudentPhoto(mgr, id)
    expect(await photos.currentPhoto(mgr, id)).toBeNull()
    const events = await adminSql()`select event_type from student_events where student_id = ${id} and event_type like 'photo_%' order by id`
    expect(events.map((e) => e.event_type)).toEqual(['photo_uploaded', 'photo_replaced', 'photo_downloaded', 'photo_removed'])
    await expectDbError(adminSql()`delete from student_photos where student_id = ${id}`, '42501')
  })

  it('Photo Status filter in the students list', async () => {
    const { mgr, id } = await newStudent()
    const without = await newStudent()
    await photos.saveStudentPhoto(mgr, id, await image('jpeg'), null)
    const withPhoto = await students.listStudents(mgr, [EDX], { photo: 'yes', q: 'Photo Student' })
    const missing = await students.listStudents(mgr, [EDX], { photo: 'no', q: 'Photo Student' })
    expect(withPhoto.rows.some((r) => r.id === id && r.photo_version === 1)).toBe(true)
    expect(withPhoto.rows.some((r) => r.id === without.id)).toBe(false)
    expect(missing.rows.some((r) => r.id === without.id)).toBe(true)
    expect(missing.rows.some((r) => r.id === id)).toBe(false)
  })
})
