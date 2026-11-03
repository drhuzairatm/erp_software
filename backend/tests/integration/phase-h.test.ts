/** Phase H: consent-based notifications, test mode, providers (mocked), retries, privacy. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { processQueue } from '@/lib/notifications/dispatcher'
import { gallaboxBody } from '@/lib/notifications/providers'
import { renderTemplate, toInternationalDigits } from '@/lib/notifications/render'
import * as documents from '@/services/documents'
import * as notifications from '@/services/notifications'
import * as students from '@/services/students'
import { adminSql, ctxFor, expectDbError, orgId } from '../support/helpers'

let EDX: string
const rand = () => String(Math.floor(Math.random() * 90000) + 10000)
const ENV = { ...process.env }
beforeAll(async () => { EDX = await orgId('EDX') })
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals() })
afterAll(async () => { await adminSql().end(); await db().end() })

async function expectServiceError(p: Promise<unknown>, kind?: string) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ServiceError); if (kind) expect((e as ServiceError).kind).toBe(kind); return }
  throw new Error('expected ServiceError')
}

/** New EDX student; consents given as e.g. ['student.whatsapp']. Clears the queue first. */
async function student(consents: string[] = [], extra: Record<string, unknown> = {}) {
  await processQueue(500) // flush anything earlier tests queued
  const mgr = await ctxFor('edx.manager@demo.test')
  const raw: Record<string, unknown> = { originatingOrgId: EDX, fullName: `Notify Student ${rand()}`, phone: `90060${rand()}`, email: `n${rand()}@example.test`, ...extra }
  for (const c of consents) raw[`consent.${c}`] = 'yes'
  const r = await students.createStudent(mgr, raw)
  if (!r.ok) throw new Error('create failed')
  return { mgr, id: r.id }
}
const messagesOf = (id: string) => adminSql()`select * from notification_messages where student_id = ${id} order by created_at, channel`

describe('rendering helpers', () => {
  it('fills placeholders as plain text', () => {
    expect(renderTemplate('Dear {{student_name}}, stage: {{ stage }} {{unknown}}.', { student_name: '<b>Asha</b>', stage: 'Visa' })).toBe('Dear <b>Asha</b>, stage: Visa .')
  })
  it('normalises Indian numbers for WhatsApp', () => {
    expect(toInternationalDigits('+91 90000 12345')).toBe('919000012345')
    expect(toInternationalDigits('9000012345')).toBe('919000012345')
    expect(toInternationalDigits('00974 5555 1234')).toBe('97455551234')
  })
  it('builds the Gallabox request with named body values', () => {
    expect(gallaboxBody('ch1', '919000012345', 'Asha', 'stage_update', ['name=student_name', 'stage'], { student_name: 'Asha', stage: 'Visa' })).toEqual({
      channelId: 'ch1', channelType: 'whatsapp', recipient: { name: 'Asha', phone: '919000012345' },
      whatsapp: { type: 'template', template: { templateName: 'stage_update', bodyValues: { name: 'Asha', stage: 'Visa' } } },
    })
  })
})

describe('consent decides who is messaged', () => {
  it('no consent → recorded as skipped; with consent → prepared and kept in test mode', async () => {
    const none = await student([])
    const withC = await student(['student.whatsapp', 'student.email'])
    for (const s of [none, withC]) await students.changeStage(s.mgr, s.id, { toStage: 'registration', nextAction: 'Send passport copy' })
    const a = await messagesOf(none.id)
    const studentMsgs = a.filter((m) => m.event_key === 'stage_changed' && m.recipient_type === 'student')
    expect(studentMsgs.length).toBeGreaterThan(0)
    expect(studentMsgs.every((m) => m.status === 'skipped' && m.skip_reason === 'no consent')).toBe(true)
    // parent has no phone on file
    expect(a.find((m) => m.recipient_type === 'parent')?.skip_reason).toBe('no phone number')
    await processQueue(100)
    const b = (await messagesOf(withC.id)).filter((m) => m.event_key === 'stage_changed' && m.recipient_type === 'student')
    expect(b.map((m) => m.channel).sort()).toEqual(['email', 'whatsapp'])
    for (const m of b) {
      expect(m.status).toBe('test') // test mode: never sent
      expect(m.body).toContain('Registration')
      expect(m.body).toMatch(/Notify Student \d+/)
    }
    expect(b.find((m) => m.channel === 'email')!.subject).toBe('Your application: Registration')
  })

  it('disabled rules produce nothing; stage filters are respected', async () => {
    const s = await student(['student.whatsapp'])
    await adminSql()`update notification_rules set stage_keys = '{visa_processing}' where org_id = ${EDX} and event_key = 'stage_changed'`
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    expect((await messagesOf(s.id)).filter((m) => m.event_key === 'stage_changed')).toHaveLength(0)
    await adminSql()`update notification_rules set stage_keys = '{}' where org_id = ${EDX} and event_key = 'stage_changed'`
  })

  it('withdrawing consent stops further messages; consent records are permanent', async () => {
    const s = await student(['student.whatsapp'])
    await notifications.recordConsent(s.mgr, s.id, 'whatsapp', 'student', false, 'Replied STOP')
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    const w = (await messagesOf(s.id)).filter((m) => m.channel === 'whatsapp' && m.event_key === 'stage_changed' && m.recipient_type === 'student')
    expect(w[0]).toMatchObject({ status: 'skipped', skip_reason: 'no consent' })
    await expectDbError(adminSql()`delete from contact_consents where student_id = ${s.id}`, 'P0001')
    await expectServiceError(notifications.recordConsent(await ctxFor('edx.finance@demo.test'), s.id, 'email', 'student', true, 'x'), 'forbidden')
  })

  it('parents are messaged on their own number with their own consent', async () => {
    const s = await student(['parent.whatsapp'], { parentName: 'Parent Test', parentPhone: '+91 90061 11111' })
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    const p = (await messagesOf(s.id)).find((m) => m.recipient_type === 'parent' && m.event_key === 'stage_changed')
    expect(p).toMatchObject({ channel: 'whatsapp', to_address: '+91 90061 11111', status: 'queued' })
  })

  it('document review outcomes notify with the reason', async () => {
    const s = await student(['student.whatsapp'])
    const doc = (await documents.getChecklist(s.mgr, s.id)).items.find((i) => i.type_key === 'passport')!
    await documents.uploadDocument(s.mgr, doc.id, new File([Buffer.from('%PDF-1.4\n%x\n')], 'p.pdf', { type: 'application/pdf' }))
    await documents.documentAction(s.mgr, doc.id, 'request_changes', 'Photo page is blurred')
    await processQueue(100)
    const m = (await messagesOf(s.id)).find((x) => x.event_key === 'document_changes_required' && x.channel === 'whatsapp')
    expect(m?.body).toContain('Photo page is blurred')
    expect(m?.body).toContain('Passport')
  })
})

describe('sending (providers simulated)', () => {
  function liveWhatsApp() {
    process.env.NOTIFICATIONS_MODE = 'live'
    process.env.GALLABOX_API_KEY = 'k'; process.env.GALLABOX_API_SECRET = 's'; process.env.GALLABOX_CHANNEL_ID_EDX = 'chan-edx'
  }

  it('live WhatsApp: accepted → sent with provider id; request carries template and values', async () => {
    const s = await student(['student.whatsapp'])
    liveWhatsApp()
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'gb-123' }), { status: 200 }) }))
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    await processQueue(100)
    const m = (await messagesOf(s.id)).find((x) => x.channel === 'whatsapp' && x.event_key === 'stage_changed' && x.recipient_type === 'student')!
    expect(m).toMatchObject({ status: 'sent', provider: 'gallabox', provider_message_id: 'gb-123' })
    const call = calls.find((c) => JSON.parse(String(c.init.body)).recipient.phone.startsWith('9190060'))!
    expect((call.init.headers as Record<string, string>).apikey).toBe('k')
    const body = JSON.parse(String(call.init.body))
    expect(body.channelId).toBe('chan-edx')
    expect(body.whatsapp.template.templateName).toBe('demo_application_progress')
    expect(body.whatsapp.template.bodyValues.stage).toBe('Registration')
  })

  it('temporary failure retries later; permanent failure is marked failed (never "sent")', async () => {
    const s = await student(['student.whatsapp', 'student.email'])
    liveWhatsApp()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    await processQueue(100)
    let w = (await messagesOf(s.id)).find((x) => x.channel === 'whatsapp' && x.event_key === 'stage_changed' && x.recipient_type === 'student')!
    expect(w).toMatchObject({ status: 'queued', attempts: 1 })
    expect(w.last_error).toContain('503')
    expect(new Date(w.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    const e = (await messagesOf(s.id)).find((x) => x.channel === 'email' && x.event_key === 'stage_changed')!
    expect(e).toMatchObject({ status: 'skipped', skip_reason: 'email not configured' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad template', { status: 400 })))
    await adminSql()`update notification_messages set next_attempt_at = now() where id = ${w.id}`
    await processQueue(100)
    w = (await adminSql()`select * from notification_messages where id = ${w.id}`)[0]
    expect(w.status).toBe('failed')
    expect(w.sent_at).toBeNull()
  })

  it('test mode only delivers to the test-recipient list', async () => {
    const s = await student(['student.whatsapp'], { phone: '+91 90062 22222' })
    process.env.NOTIFICATIONS_MODE = 'test'
    process.env.NOTIFICATIONS_TEST_RECIPIENTS = '9000000000, +91 90062 22222'
    process.env.GALLABOX_API_KEY = 'k'; process.env.GALLABOX_API_SECRET = 's'; process.env.GALLABOX_CHANNEL_ID_EDX = 'c'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"t1"}', { status: 200 })))
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    await processQueue(100)
    expect((await messagesOf(s.id)).find((x) => x.channel === 'whatsapp' && x.event_key === 'stage_changed' && x.recipient_type === 'student')?.status).toBe('sent')
  })

  it('SMS has no provider: recorded as skipped with the reason', async () => {
    const s = await student([])
    await adminSql()`insert into contact_consents (student_id, channel, recipient, granted, source) values (${s.id}, 'sms', 'student', true, 'test')`
    const [tpl] = await adminSql()`insert into notification_templates (org_id, name, channel, body) values (${EDX}, ${'SMS test ' + rand()}, 'sms', 'Hi {{student_name}}') returning id`
    await adminSql()`insert into notification_rules (org_id, event_key, channel, audience, template_id, is_enabled) values (${EDX}, 'visa_outcome', 'sms', 'student', ${tpl.id}, true)
                     on conflict (org_id, event_key, channel, audience) do update set template_id = excluded.template_id, is_enabled = true`
    process.env.NOTIFICATIONS_MODE = 'live'
    await adminSql()`update students set visa_outcome = 'pending' where id = ${s.id}`
    await processQueue(100)
    const m = (await messagesOf(s.id)).find((x) => x.channel === 'sms')
    expect(m).toMatchObject({ status: 'skipped' })
    expect(m?.skip_reason).toContain('DLT')
  })
})

describe('outbox privacy', () => {
  it('staff without contact or outbox permission (e.g. finance) cannot read messages; managers can', async () => {
    const s = await student(['student.whatsapp'])
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    expect((await notifications.listMessages(s.mgr, [EDX], { studentId: s.id })).rows.length).toBeGreaterThan(0)
    expect((await notifications.listMessages(await ctxFor('edx.finance@demo.test'), [EDX], { studentId: s.id })).rows).toHaveLength(0)
    expect((await notifications.listMessages(await ctxFor('grd.manager@demo.test'), [EDX], { studentId: s.id })).rows).toHaveLength(0)
  })
  it('a message can only be retried once consent exists', async () => {
    const s = await student([])
    await students.changeStage(s.mgr, s.id, { toStage: 'registration' })
    const m = (await messagesOf(s.id)).find((x) => x.channel === 'whatsapp' && x.event_key === 'stage_changed' && x.recipient_type === 'student')!
    await expectServiceError(notifications.retryMessage(s.mgr, m.id), 'invalid')
    await notifications.recordConsent(s.mgr, s.id, 'whatsapp', 'student', true, 'Verbal on call')
    await notifications.retryMessage(s.mgr, m.id)
    const [after] = await adminSql()`select status from notification_messages where id = ${m.id}`
    expect(after.status).toBe('test')
  })
})
