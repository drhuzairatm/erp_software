import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

/**
 * Records what a browser test needs for its report: console errors, uncaught page errors, failed requests and server errors,
 * plus a screenshot. `finish` fails the test if anything unexpected was seen. Fictional data only.
 */
const DIR = process.env.E2E_EVIDENCE_DIR ?? path.resolve(import.meta.dirname, '../../test-results/evidence')
type Seen = { role: string; kind: string; detail: string }

export class Evidence {
  private seen: Seen[] = []
  private pages: { page: Page; role: string }[] = []
  private requests = 0
  constructor(private workflow: string, private expected: RegExp[] = []) { mkdirSync(DIR, { recursive: true }) }

  watch(page: Page, role: string) {
    this.pages.push({ page, role })
    page.on('console', (m) => { if (m.type() === 'error') this.note(role, 'console', m.text()) })
    page.on('pageerror', (e) => this.note(role, 'pageerror', e.message))
    page.on('request', () => { this.requests++ })
    page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) this.note(role, 'requestfailed', `${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`) })
    page.on('response', (r) => { if (r.status() >= 500) this.note(role, 'http5xx', `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
    return page
  }

  private note(role: string, kind: string, detail: string) {
    if (!this.expected.some((x) => x.test(detail))) this.seen.push({ role, kind, detail: detail.slice(0, 300) })
  }

  async finish(actual: string) {
    const slug = this.workflow.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    const shots: string[] = []
    for (const [i, { page, role }] of this.pages.entries()) {
      if (page.isClosed()) continue
      const file = path.join(DIR, `${slug}-${i}-${role.replace(/[^a-z0-9]+/gi, '-')}.png`)
      // Playwright's screenshot marks inputs to hide the caret, which React reports as a mismatch if the page is still hydrating. Polling pages never go idle, hence the short limit.
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
      await page.screenshot({ path: file }).catch(() => {})
      shots.push(path.basename(file))
    }
    appendFileSync(path.join(DIR, 'evidence.jsonl'), JSON.stringify({ workflow: this.workflow, roles: this.pages.map((p) => p.role), actual, requests: this.requests, problems: this.seen, screenshots: shots }) + '\n')
    expect(this.seen, `unexpected browser problems in "${this.workflow}"`).toEqual([])
  }
}
