// Copies pdf.js worker (and wasm decoders, if present) into public/pdfjs so the
// in-app viewer loads them from our own origin (no CDN, CSP-compatible).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
const src = 'node_modules/pdfjs-dist'
mkdirSync('public/pdfjs', { recursive: true })
cpSync(`${src}/build/pdf.worker.min.mjs`, 'public/pdfjs/pdf.worker.min.mjs')
if (existsSync(`${src}/wasm`)) cpSync(`${src}/wasm`, 'public/pdfjs/wasm', { recursive: true })
if (existsSync(`${src}/standard_fonts`)) cpSync(`${src}/standard_fonts`, 'public/pdfjs/standard_fonts', { recursive: true })
console.log('pdf.js assets copied to public/pdfjs')
