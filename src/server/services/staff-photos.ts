import { randomUUID } from 'node:crypto'
import { invalid } from '../errors'
import { getStorage } from '../storage'
import { type Ctx, run } from './base'
import { type Crop, processPhoto } from './photos'

const UUID = /^[0-9a-f-]{36}$/i

/** Square staff profile photo: original (metadata removed), square display version and 256 × 256 thumbnail; private storage. */
export async function saveStaffPhoto(ctx: Ctx, userId: string, file: File, crop: Crop | null) {
  if (!UUID.test(userId)) throw invalid('Unknown staff member.')
  const [p] = await run(ctx, (tx) => tx<{ ok: boolean }[]>`select app.can_change_staff_photo(${userId}) as ok`)
  if (!p?.ok) throw invalid('You cannot change this person\'s photo.')
  const img = await processPhoto(file, crop, 1)
  const storage = await getStorage()
  const base = `staff/${userId}/${randomUUID()}`
  const keys = { original: `${base}-original`, display: `${base}-display`, thumb: `${base}-thumb` }
  await storage.put(keys.original, img.original, img.mime)
  await storage.put(keys.display, img.portrait, 'image/jpeg')
  await storage.put(keys.thumb, img.thumb, 'image/jpeg')
  try {
    const [r] = await run(ctx, (tx) => tx<{ old: string[] }[]>`select app.set_staff_photo(${userId}, ${keys.original}, ${img.mime}, ${keys.display}, ${keys.thumb}) as old`)
    for (const k of r.old ?? []) await storage.remove(k).catch(() => {})
  } catch (e) {
    for (const k of Object.values(keys)) await storage.remove(k).catch(() => {})
    throw e
  }
}

export async function removeStaffPhoto(ctx: Ctx, userId: string) {
  const [r] = await run(ctx, (tx) => tx<{ old: string[] }[]>`select app.remove_staff_photo(${userId}) as old`)
  const storage = await getStorage()
  for (const k of r.old ?? []) await storage.remove(k).catch(() => {})
}

export async function staffPhotoBytes(ctx: Ctx, userId: string, variant: 'thumb' | 'display') {
  if (!UUID.test(userId)) return null
  const [f] = await run(ctx, (tx) => tx<{ storage_key: string; version: number }[]>`select * from app.staff_photo_file(${userId}, ${variant})`)
  if (!f) return null
  return { data: await (await getStorage()).get(f.storage_key), version: f.version }
}

/** Current photo versions for a set of people (for avatars). */
export async function staffPhotoVersions(ctx: Ctx, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && UUID.test(x)))]
  if (!ids.length) return {} as Record<string, number>
  const rows = await run(ctx, (tx) => tx<{ user_id: string; version: number }[]>`select user_id, version from staff_photos where is_current and user_id = any(${ids}::uuid[])`)
  return Object.fromEntries(rows.map((r) => [r.user_id, r.version])) as Record<string, number>
}
