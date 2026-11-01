import { type Ctx, run } from './base'
import { studentAdvisories } from './requirements'

/** Everything on a student that needs staff attention (shown on every tab of the profile). Informational only. */
export async function studentAttention(ctx: Ctx, studentId: string) {
  const advisories = await studentAdvisories(ctx, studentId)
  const [x] = await run(ctx, (tx) => tx<{ oas_open: number; awaiting_approval: number; awaiting_verification: number; can_ack: boolean; can_approve: boolean; can_review: boolean; passport_pending: boolean }[]>`
    select (select count(*)::int from one_and_same_cases k where k.student_id = ${studentId} and k.cancelled_at is null
              and app.one_and_same_status(k.id) in ('mandatory', 'recommended', 'pending', 'received')) as oas_open,
           (select count(*)::int from student_documents d where d.student_id = ${studentId} and d.status = 'pending_approval') as awaiting_approval,
           (select count(*)::int from student_documents d where d.student_id = ${studentId} and d.status in ('uploaded', 'under_review')) as awaiting_verification,
           (app.can_on_student(${studentId}, 'students.update') or app.can_on_student(${studentId}, 'documents.review')) as can_ack,
           app.can_on_student(${studentId}, 'documents.approve') as can_approve, app.can_on_student(${studentId}, 'documents.review') as can_review,
           (app.can_on_student(${studentId}, 'students.passport.view')
             and exists (select 1 from student_passports p where p.student_id = ${studentId} and p.verification_status = 'pending')) as passport_pending`)
  return { advisories, ...x }
}
