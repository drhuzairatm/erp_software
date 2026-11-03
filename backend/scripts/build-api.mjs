// Compiled production build of the API (decision D4): one ESM bundle of backend/src/server.ts with the @/ aliases
// resolved from tsconfig.json; npm packages stay external (loaded from node_modules at run time).
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
await build({
  entryPoints: [path.join(root, 'src/server.ts')],
  outfile: path.join(root, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  tsconfig: path.join(root, 'tsconfig.json'),
  sourcemap: true,
  logLevel: 'warning',
})
console.log('API built: backend/dist/server.mjs')
