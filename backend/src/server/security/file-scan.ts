import 'server-only'
import { anonymous } from '../db'
import { invalid } from '../errors'
import { type Ctx, run } from '../services/base'
import { type ScanOutcome, scanFile } from './scanner'

export const QUARANTINE_MESSAGE = 'The virus scanner found a threat in this file. It has been quarantined and cannot be opened or approved. Please upload a clean copy.'

/** Student document files: scan (if a scanner is configured) and record the result against the stored file. */
export async function scanAndRecord(storageKey: string, buf: Buffer): Promise<ScanOutcome | null> {
  const r = await scanFile(buf)
  if (r) await anonymous((tx) => tx`select app.record_file_scan(${storageKey}, ${r.status}, ${r.engine}, ${r.detail ?? null})`)
  return r
}

/** Photos and attestation evidence: an infected file is refused and never stored (the attempt is audited and alerted). */
export async function refuseIfInfected(ctx: Ctx | null, buf: Buffer, what: string) {
  const r = await scanFile(buf)
  if (r?.status !== 'infected') return r
  const log = (tx: Parameters<Parameters<typeof anonymous>[0]>[0]) => tx`select app.audit('malware_detected', 'upload', ${what}, null, null, null,
    ${tx.json({ detail: r.detail ?? null, engine: r.engine })}, 'denied', '{}'::jsonb, null)`
  if (ctx) await run(ctx, log)
  else await anonymous(log)
  throw invalid('The virus scanner found a threat in this file, so it was not saved. Please upload a clean file.')
}
