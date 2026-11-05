import 'server-only'
import { anonymous } from '../db'
import { appUrl, emailConfigured, sendEmail } from '../email'
import { getStorage } from '../storage'
import { scanFile, scannerName } from './scanner'

/** Daily: scan files that were stored while no scanner was available (incl. manually cleared ones). */
export async function rescanPendingFiles(limit = 100) {
  if (!scannerName()) return { scanner: null, scanned: 0, infected: 0, failed: 0 }
  const files = await anonymous((tx) => tx<{ storage_key: string }[]>`select * from app.files_to_rescan(${limit})`)
  const storage = await getStorage()
  let scanned = 0, infected = 0, failed = 0
  for (const f of files) {
    let r
    try { r = await scanFile(await storage.get(f.storage_key)) } catch { r = { status: 'scan_failed' as const, engine: scannerName()!, detail: 'file could not be read' } }
    if (!r) break
    await anonymous((tx) => tx`select app.record_file_scan(${f.storage_key}, ${r.status}, ${r.engine}, ${r.detail ?? null})`)
    scanned++; if (r.status === 'infected') infected++; if (r.status === 'scan_failed') failed++
  }
  // secure files with no student document (task attachments and later modules)
  const secure = await anonymous((tx) => tx<{ storage_key: string }[]>`select * from app.secure_files_to_rescan(${limit})`)
  for (const f of secure) {
    let r
    try { r = await scanFile(await storage.get(f.storage_key)) } catch { r = { status: 'scan_failed' as const, engine: scannerName()!, detail: 'file could not be read' } }
    if (!r) break
    await anonymous((tx) => tx`select app.record_secure_file_scan(${f.storage_key}, ${r.status}, ${r.engine}, ${r.detail ?? null})`)
    scanned++; if (r.status === 'infected') infected++; if (r.status === 'scan_failed') failed++
  }
  return { scanner: scannerName(), scanned, infected, failed }
}

/** Every run: email new high/critical security alerts to holders of security.alerts (only when email is configured). */
export async function emailSecurityAlerts() {
  if (!emailConfigured()) return { emailed: 0, reason: 'email not configured' }
  const alerts = await anonymous((tx) => tx<{ alert_id: string; severity: string; title: string; created_at: Date; recipients: string[] }[]>`
    select * from app.security_alerts_to_email()`)
  const done: string[] = []
  for (const a of alerts) {
    let reachedSomeone = false
    for (const to of a.recipients) {
      const r = await sendEmail(to, `[Security ${a.severity}] ${a.title}`,
        `A ${a.severity} security alert was raised in the staff portal:\n\n${a.title}\n\nReview it (sign-in required): ${appUrl('/admin/security')}\n\nNo personal details are included in this email.`)
      reachedSomeone = reachedSomeone || r.sent
    }
    // Marked once anyone received it: one failing address must not re-send the alert to the others on every run.
    // The alert also stays on the Security page. If nobody was reached, it stays pending and is retried.
    if (reachedSomeone) done.push(a.alert_id)
  }
  if (done.length) await anonymous((tx) => tx`select app.mark_alerts_emailed(${done}::uuid[])`)
  return { emailed: done.length }
}
