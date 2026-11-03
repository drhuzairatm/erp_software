/**
 * Test-only: runs the real Express API as a separate process on a random loopback port (for the frontend contract tests
 * through BFF → Express). Uses only the environment it is given (the throwaway test database settings); it does NOT
 * load .env. Prints {"port":n} on the first stdout line; refusal logs go to stderr (never header values).
 */
import type { AddressInfo } from 'node:net'
import { createApp } from '../../src/app'

const { app } = createApp({ secret: process.env.INTERNAL_API_SECRET!, log: (e) => process.stderr.write(`${JSON.stringify(e)}\n`) })
const server = app.listen(0, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ port: (server.address() as AddressInfo).port })}\n`))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
