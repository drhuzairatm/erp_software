import { MIN_SECRET_LENGTH } from '@/lib/http/internal-credential'

export interface ApiConfig {
  host: string
  port: number
  secret: string
}

const LOOPBACK = ['127.0.0.1', '::1', 'localhost']

/**
 * API process settings. Refuses (throws) instead of starting in an unsafe or unsupported way:
 * - INTERNAL_API_SECRET must have at least 32 characters;
 * - API_HOST must be a loopback address: remote/production topology is not decided yet (decision D5);
 * - exactly ONE instance (API_INSTANCES unset or 1; never as a cluster worker): the one-time-nonce store lives in this
 *   process, so several instances would let a request be replayed against another instance.
 */
export function apiConfig(env: Record<string, string | undefined>, isClusterWorker = false): ApiConfig {
  const problems: string[] = []
  const secret = env.INTERNAL_API_SECRET ?? ''
  if (secret.length < MIN_SECRET_LENGTH) problems.push(`INTERNAL_API_SECRET must be set (at least ${MIN_SECRET_LENGTH} characters).`)
  const host = env.API_HOST || '127.0.0.1'
  if (!LOOPBACK.includes(host)) problems.push('API_HOST must be a loopback address (127.0.0.1, ::1 or localhost); other hosts are not supported yet.')
  const portText = env.API_PORT || '4000'
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || port > 65535) problems.push('API_PORT must be a port number.')
  if ((env.API_INSTANCES ?? '1') !== '1') problems.push('API_INSTANCES must be 1: running several API instances is not supported (the replay store is per process).')
  if (isClusterWorker) problems.push('The API must not run as a cluster worker (one instance only).')
  if (problems.length) throw new Error(`Refusing to start the API: ${problems.join(' ')}`)
  return { host, port, secret }
}
