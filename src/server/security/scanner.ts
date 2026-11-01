import 'server-only'
import { connect } from 'node:net'

/**
 * Virus scanning of uploaded files – pluggable, server-side only.
 *
 *  1. ClamAV daemon (clamd) over TCP:   CLAMAV_HOST, CLAMAV_PORT (default 3310)
 *  2. Any HTTPS scanning service:        SCANNER_URL (+ SCANNER_TOKEN). The bytes are POSTed; the service must answer
 *                                         JSON { "status": "clean" | "infected", "signature"?: string }.
 *
 * When neither is configured, scanFile() returns null and the file stays "not scanned" – nothing ever pretends
 * a file was scanned. Such files need MANUAL security clearance before approval or courier release.
 */
export type ScanOutcome = { status: 'clean' | 'infected' | 'scan_failed'; engine: string; detail?: string }

export function scannerName(): string | null {
  if (process.env.CLAMAV_HOST) return 'ClamAV'
  if (process.env.SCANNER_URL) return 'external scanning service'
  return null
}

export async function scanFile(buf: Buffer): Promise<ScanOutcome | null> {
  if (process.env.CLAMAV_HOST) return clamav(buf, process.env.CLAMAV_HOST, Number(process.env.CLAMAV_PORT) || 3310)
  if (process.env.SCANNER_URL) return httpScanner(buf, process.env.SCANNER_URL)
  return null
}

/** clamd INSTREAM protocol: "zINSTREAM\0", then [4-byte big-endian length][chunk]..., then a zero-length chunk. */
export function clamav(buf: Buffer, host: string, port: number, timeoutMs = 30000): Promise<ScanOutcome> {
  return new Promise((resolve) => {
    let reply = ''
    let done = false
    const finish = (r: ScanOutcome) => { if (!done) { done = true; sock.destroy(); resolve(r) } }
    const sock = connect({ host, port }, () => {
      sock.write('zINSTREAM\0')
      const CHUNK = 64 * 1024
      for (let i = 0; i < buf.length; i += CHUNK) {
        const part = buf.subarray(i, i + CHUNK)
        const len = Buffer.alloc(4); len.writeUInt32BE(part.length)
        sock.write(len); sock.write(part)
      }
      sock.write(Buffer.alloc(4))
    })
    sock.setTimeout(timeoutMs, () => finish({ status: 'scan_failed', engine: 'ClamAV', detail: 'timeout' }))
    sock.on('data', (d) => { reply += d.toString('utf8') })
    sock.on('error', (e) => finish({ status: 'scan_failed', engine: 'ClamAV', detail: `connection error: ${(e as NodeJS.ErrnoException).code ?? 'unknown'}` }))
    sock.on('end', () => {
      const r = reply.replace(/\0/g, '').trim()
      if (/:\s*OK$/.test(r)) finish({ status: 'clean', engine: 'ClamAV' })
      else if (/FOUND$/.test(r)) finish({ status: 'infected', engine: 'ClamAV', detail: r.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '').slice(0, 200) })
      else finish({ status: 'scan_failed', engine: 'ClamAV', detail: r.slice(0, 200) || 'empty reply' })
    })
  })
}

async function httpScanner(buf: Buffer, url: string): Promise<ScanOutcome> {
  const engine = 'external scanning service'
  try {
    const res = await fetch(url, {
      method: 'POST', body: new Uint8Array(buf), signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/octet-stream', ...(process.env.SCANNER_TOKEN ? { Authorization: `Bearer ${process.env.SCANNER_TOKEN}` } : {}) },
    })
    if (!res.ok) return { status: 'scan_failed', engine, detail: `HTTP ${res.status}` }
    const j = (await res.json()) as { status?: string; signature?: string }
    if (j.status === 'clean') return { status: 'clean', engine }
    if (j.status === 'infected') return { status: 'infected', engine, detail: String(j.signature ?? 'malware').slice(0, 200) }
    return { status: 'scan_failed', engine, detail: 'unexpected answer' }
  } catch {
    return { status: 'scan_failed', engine, detail: 'service unreachable' }
  }
}
