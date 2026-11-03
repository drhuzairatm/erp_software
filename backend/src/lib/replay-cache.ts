/**
 * One-time nonce store for the internal credential (in this process only).
 *
 * - reserve() checks and inserts in one synchronous step (no await in between): of two concurrent requests with the
 *   same nonce exactly one is accepted, because Node runs this on one thread.
 * - Entries expire at signature time + 65 s (60 s window + 5 s skew); expired entries are swept every 10 s and before
 *   inserting when the store is over 90 % full.
 * - When full after a sweep it FAILS CLOSED ('full', the API answers 503): unexpired entries are never evicted, because
 *   evicting one would allow it to be replayed.
 * - A restart empties the store; the API therefore also refuses credentials signed before the process started.
 * - Valid for ONE API instance only. Several instances need a shared store (separate approval).
 */
export const REPLAY_TTL_MS = 65_000
export const DEFAULT_REPLAY_MAX = 200_000

export class ReplayCache {
  private readonly entries = new Map<string, number>()
  private timer: NodeJS.Timeout | undefined

  constructor(readonly max = DEFAULT_REPLAY_MAX, private readonly now: () => number = Date.now) {}

  /** 'ok' = first use (now recorded); 'duplicate' = seen before; 'full' = store full of unexpired entries. */
  reserve(nonce: string, signedAt: number): 'ok' | 'duplicate' | 'full' {
    if (this.entries.has(nonce)) {
      if (this.entries.get(nonce)! > this.now()) return 'duplicate'
      this.entries.delete(nonce) // expired; the time-window check already refuses such old requests
    }
    if (this.entries.size >= this.max * 0.9) this.sweep()
    if (this.entries.size >= this.max) return 'full'
    this.entries.set(nonce, signedAt + REPLAY_TTL_MS)
    return 'ok'
  }

  sweep() {
    const t = this.now()
    for (const [k, exp] of this.entries) if (exp <= t) this.entries.delete(k)
  }

  get size() { return this.entries.size }

  startSweeping(intervalMs = 10_000) {
    this.timer ??= setInterval(() => this.sweep(), intervalMs)
    this.timer.unref()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined }
}
