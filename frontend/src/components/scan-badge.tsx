import { Badge } from './ui'

/** Virus-scan state of a file. "Manually cleared" is deliberately distinct from "Virus-scanned clean". */
export const SCAN_LABEL: Record<string, string> = {
  not_scanned: 'Not virus-scanned', clean: 'Virus-scanned: clean', infected: 'Infected – quarantined',
  scan_failed: 'Virus scan failed', manually_cleared: 'Manually cleared (not scanned)',
}
export function ScanBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const tone = status === 'clean' ? 'green' : status === 'infected' ? 'red' : status === 'manually_cleared' ? 'purple' : 'amber'
  return <Badge tone={tone}>{SCAN_LABEL[status] ?? status}</Badge>
}
