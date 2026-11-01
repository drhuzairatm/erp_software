import Link from 'next/link'
import { AdvisoryNotice } from '@/components/advisory-notice'
import { NoticeCard } from '@/components/notice'
import { studentAttention } from '@/server/services/attention'
import type { Ctx } from '@/server/services/base'
import type { StudentProfile } from '@/server/services/students'

/** Staff attention panel: visible on every tab of the student profile. Nothing here blocks the workflow. */
export async function AttentionPanel({ ctx, profile }: { ctx: Ctx; profile: StudentProfile }) {
  const { student: s, permissions: p } = profile
  const at = await studentAttention(ctx, s.id)
  const passportLink = p.passport ? <Link href={`/students/${s.id}?tab=passport`} className="text-sm font-medium">Open Passport tab →</Link> : undefined
  const cards = []
  if (s.passport_status === 'expired') {
    cards.push(<NoticeCard key="pp" level="critical" title="PASSPORT EXPIRED – URGENT RENEWAL REQUIRED" actions={passportLink}>Please contact the student and follow up for a renewed passport.</NoticeCard>)
  } else if (s.passport_status === 'critical') {
    cards.push(<NoticeCard key="pp" level="critical" title="Passport expires within 3 months – urgent renewal required" actions={passportLink}>Contact the student about renewal now. University Application and later stages need at least 12 months of validity.</NoticeCard>)
  } else if (s.passport_status === 'urgent' || s.passport_status === 'warning') {
    cards.push(<NoticeCard key="pp" level="warning" label="Passport" title={`Passport valid for less than ${s.passport_status === 'urgent' ? '6' : '12'} months`} actions={passportLink}>
      From University Application onwards a passport valid for at least 12 months is required. Follow up for renewal.</NoticeCard>)
  }
  if (at.passport_pending) {
    cards.push(<NoticeCard key="ppv" level="warning" label="Passport" title="New passport awaiting verification" compact actions={passportLink}>
      It becomes the active passport only after it is verified on the Passport tab.</NoticeCard>)
  }
  if (at.awaiting_approval > 0 && at.can_approve) {
    cards.push(<NoticeCard key="appr" level="critical" label="Approval" title={`Manager approval required: ${at.awaiting_approval} document(s)`}
      actions={<Link href={`/students/${s.id}?tab=documents`} className="text-sm font-medium">Review documents →</Link>} />)
  }
  if (at.oas_open > 0) {
    cards.push(<NoticeCard key="oas" level="warning" label="One and Same" title={`One and Same certificate pending (${at.oas_open})`} compact
      actions={<Link href={`/students/${s.id}?tab=academic`} className="text-sm font-medium">Open Academic tab →</Link>}>A name difference between the passport and a certificate needs a One and Same document.</NoticeCard>)
  }
  if (at.awaiting_verification > 0 && at.can_review) {
    cards.push(<NoticeCard key="ver" level="warning" label="Documents" compact title={`${at.awaiting_verification} document(s) pending verification`}
      actions={<Link href={`/students/${s.id}?tab=documents`} className="text-sm font-medium">Open Documents →</Link>} />)
  }
  if (!cards.length && !at.advisories.length) return null
  return (
    <section aria-label="Needs attention" className="mb-4 space-y-2">
      {cards}
      {at.advisories.map((a) => <AdvisoryNotice key={a.notice_id} a={a} studentId={s.id} canAck={at.can_ack} />)}
    </section>
  )
}
