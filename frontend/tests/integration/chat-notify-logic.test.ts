/** The rules that stop duplicate alerts and decide what a notification may say. No database or browser needed. */
import { describe, expect, it } from 'vitest'
import { alertTitle, badgeText, conversationHref, desktopBody, nextDelay, type NotifyMemory, pickNew, toastBody, type UnreadConversation } from '@/components/chat-notify-logic'

const conv = (id: string, msg: string, at: string, more: Partial<UnreadConversation> = {}): UnreadConversation => ({
  id, kind: 'direct', title: null, orgName: 'Fictional Co', unread: 1, muted: false, latest: { id: msg, at, sender: 'Asha', preview: 'Fictional text' }, ...more,
})
const T0 = '2026-11-05T10:00:00.000000Z'; const T1 = '2026-11-05T10:00:05.000000Z'; const T2 = '2026-11-05T10:00:10.000000Z'
const started: NotifyMemory = { baseline: T0, seen: [] }

describe('pickNew', () => {
  it('the first ever run sets a baseline and alerts about nothing older', () => {
    const r = pickNew([conv('c1', 'm1', '2026-11-01T00:00:00.000000Z')], T0, { baseline: null, seen: [] }, null)
    expect(r.fresh).toEqual([]); expect(r.memory.baseline).toBe(T0); expect(r.memory.seen).toEqual(['m1'])
  })
  it('alerts once, however many polls, refreshes or reconnects follow', () => {
    const first = pickNew([conv('c1', 'm1', T1)], T1, started, null)
    expect(first.fresh.map((c) => c.id)).toEqual(['c1'])
    const again = pickNew([conv('c1', 'm1', T1)], T2, JSON.parse(JSON.stringify(first.memory)), null)
    expect(again.fresh).toEqual([])
  })
  it('a further message in the same conversation alerts again; several conversations each alert', () => {
    const one = pickNew([conv('c1', 'm1', T1)], T1, started, null)
    expect(pickNew([conv('c1', 'm2', T2, { unread: 2 }), conv('c2', 'm3', T2)], T2, one.memory, null).fresh.map((c) => c.id)).toEqual(['c1', 'c2'])
  })
  it('a message that commits late is still caught: only the first baseline limits by time', () => {
    const one = pickNew([], T2, started, null)
    expect(pickNew([conv('c1', 'm1', T1)], T2, one.memory, null).fresh).toHaveLength(1)
  })
  it('a muted conversation and the one being read do not alert, and are not saved up for later', () => {
    const r = pickNew([conv('c1', 'm1', T1, { muted: true }), conv('c2', 'm2', T1)], T1, started, 'c2')
    expect(r.fresh).toEqual([])
    expect(pickNew([conv('c1', 'm1', T1), conv('c2', 'm2', T1)], T2, r.memory, null).fresh).toEqual([])
  })
  it('messages from before the baseline never alert, and memory stays bounded', () => {
    expect(pickNew([conv('c1', 'old', '2026-01-01T00:00:00.000000Z')], T1, started, null).fresh).toEqual([])
    const many = { baseline: T0, seen: Array.from({ length: 400 }, (_, i) => `m${i}`) }
    expect(pickNew([conv('c1', 'new', T1)], T1, many, null).memory.seen.length).toBeLessThanOrEqual(300)
  })
})

describe('what an alert says', () => {
  const group = conv('g', 'm', T1, { kind: 'group', title: 'Sales', unread: 3 })
  it('names the sender, the group, and the company only when asked', () => {
    expect(alertTitle(conv('c', 'm', T1), false)).toBe('Asha')
    expect(alertTitle(group, false)).toBe('Asha in Sales')
    expect(alertTitle(group, true)).toBe('Asha in Sales (Fictional Co)')
  })
  it('desktop text hides the message unless the person chose to show it', () => {
    expect(desktopBody(conv('c', 'm', T1), false)).toBe('New message')
    expect(desktopBody(group, false)).toBe('3 new messages')
    expect(desktopBody(conv('c', 'm', T1), true)).toContain('Fictional text')
    expect(toastBody(group)).toContain('Fictional text')
  })
  it('links only to the conversation, and the badge stays short', () => {
    expect(conversationHref('a/b?x')).toBe('/chat?c=a%2Fb%3Fx')
    expect(badgeText(120)).toBe('99+'); expect(badgeText(7)).toBe('7')
  })
})

describe('polling pace', () => {
  it('5 seconds when visible, 15 hidden, backing off to a minute while failing', () => {
    expect(nextDelay(true, 0)).toBe(5000); expect(nextDelay(false, 0)).toBe(15000)
    expect([1, 2, 3, 4, 5, 9].map((f) => nextDelay(true, f))).toEqual([5000, 10000, 20000, 40000, 60000, 60000])
  })
})
