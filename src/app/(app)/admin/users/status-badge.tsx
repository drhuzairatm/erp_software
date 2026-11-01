import { Badge } from '@/components/ui'

export const STATUS_LABEL: Record<string, string> = { invited: 'Invitation pending', active: 'Active', suspended: 'Suspended', terminated: 'Terminated' }

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'green' : status === 'invited' ? 'amber' : status === 'suspended' ? 'red' : 'slate'
  return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>
}
