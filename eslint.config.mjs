import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // "_" marks intentionally unused parameters (e.g. the previous state of server actions)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // the backend has no pages or links; the Next.js page-link rule only applies to the app in frontend/
    files: ['backend/**'],
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  // one shared configuration for both workspaces (frontend/ and backend/ run "eslint ." and find this file)
  globalIgnores(['**/.next/**', '**/out/**', '**/build/**', '**/next-env.d.ts', '**/.data/**', '**/playwright-report/**', '**/test-results/**', '**/public/pdfjs/**', '**/node_modules/**']),
])
