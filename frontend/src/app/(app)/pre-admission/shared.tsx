import { label } from '@/components/format'
import { Badge } from '@/components/ui'

const STATUS_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'slate', new_request: 'blue', assigned: 'blue', under_verification: 'blue', additional_documents_required: 'amber', correction_required: 'amber', pending_further_review: 'amber',
  verification_completed: 'green', returned_to_counselor: 'green', resubmitted: 'blue', closed: 'slate', cancelled: 'slate',
}
const STATUS_TEXT: Record<string, string> = { returned_to_counselor: 'Returned to counsellor', resubmitted: 'Re-submitted' }
export function dvrStatusText(s: string) { return STATUS_TEXT[s] ?? label(s) }
export function DvrStatus({ status }: { status: string }) { return <Badge tone={STATUS_TONE[status] ?? 'slate'}>{dvrStatusText(status)}</Badge> }

const RESULT_TONE: Record<string, 'green' | 'red' | 'amber'> = { verified: 'green', not_acceptable: 'red', correction_required: 'amber', missing_document: 'amber', additional_clarification_required: 'amber', possible: 'green', possible_with_conditions: 'amber', not_possible: 'red', pending_further_review: 'amber' }
export function DvrResult({ result }: { result: string | null }) { return result ? <Badge tone={RESULT_TONE[result] ?? 'amber'}>{label(result)}</Badge> : <Badge tone="slate">Not reviewed</Badge> }
