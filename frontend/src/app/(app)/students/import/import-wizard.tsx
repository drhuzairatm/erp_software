'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { commitImportAction, previewImportAction } from '@/app/actions/import'
import { initialResult } from '@/components/action-types'
import { ActionForm, SubmitButton } from '@/components/forms'
import type { ImportAnalysis, ImportResult, RowStatus } from '@/services/student-import'

const TONE: Record<RowStatus, string> = { ready: 'bg-green-50 text-green-800', duplicate: 'bg-amber-50 text-amber-900', error: 'bg-red-50 text-red-800' }
const LABEL: Record<RowStatus, string> = { ready: 'Ready', duplicate: 'Possible duplicate', error: 'Error' }

export function ImportWizard({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '')
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [readError, setReadError] = useState('')
  const [filter, setFilter] = useState<RowStatus | 'all'>('all')

  const onFile = async (f: File | undefined) => {
    setReadError('')
    setCsv('')
    if (!f) return
    if (f.size > 2 * 1024 * 1024) { setReadError('The file is larger than 2 MB.'); return }
    setFileName(f.name)
    setCsv(await f.text())
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="org">Import into company</label>
            <select id="org" className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <p className="hint">All rows become students of this brand (originating company).</p>
          </div>
          <div>
            <label className="label" htmlFor="file">CSV file</label>
            <input id="file" type="file" accept=".csv,text/csv" className="block w-full max-w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2"
              onChange={(e) => onFile(e.target.files?.[0])} />
            {readError && <p className="mt-1 text-xs text-red-600">{readError}</p>}
          </div>
        </div>
      </div>

      {csv && <Preview key={`${orgId}:${fileName}:${csv.length}`} orgId={orgId} csv={csv} fileName={fileName} filter={filter} setFilter={setFilter} />}
    </div>
  )
}

/** Step 2: check the file. Kept as its own form; the confirm step is a separate (non-nested) form. */
function Preview({ orgId, csv, fileName, filter, setFilter }: {
  orgId: string; csv: string; fileName: string; filter: RowStatus | 'all'; setFilter: (f: RowStatus | 'all') => void
}) {
  const [state, action, pending] = useActionState(previewImportAction, initialResult)
  const a = state.data?.analysis as ImportAnalysis | undefined
  return (
    <div className="space-y-4">
      {!a && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="csv" value={csv} />
          {state.message && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{state.message}</p>}
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Checking file…' : 'Check file'}</button>
        </form>
      )}
      {a && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {(['ready', 'duplicate', 'error'] as RowStatus[]).map((k) => (
              <button type="button" key={k} onClick={() => setFilter(filter === k ? 'all' : k)}
                className={`card px-4 py-3 text-left ${filter === k ? 'ring-2 ring-brand-600' : ''}`}>
                <p className="text-sm text-slate-600">{LABEL[k]}</p><p className="text-2xl font-semibold">{a.counts[k]}</p>
              </button>
            ))}
          </div>
          <div className="card p-4 text-sm">
            <p><strong>Recognised columns:</strong> {a.recognised.map((r) => `${r.header} → ${r.label}`).join(' · ')}</p>
            {a.ignored.length > 0 && <p className="mt-1 text-amber-800"><strong>Ignored columns:</strong> {a.ignored.join(', ')}</p>}
          </div>
          <div className="card table-wrap max-h-[32rem] overflow-y-auto">
            <table>
              <thead><tr><th>Line</th><th>Status</th><th>Name</th><th>Phone / email</th><th>Programme</th><th>Details</th></tr></thead>
              <tbody>{a.rows.filter((r) => filter === 'all' || r.status === filter).map((r) => (
                <tr key={r.line}>
                  <td className="tabular-nums">{r.line}</td>
                  <td><span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>{LABEL[r.status]}</span></td>
                  <td>{r.fullName || <span className="text-slate-400">—</span>}</td>
                  <td className="text-xs">{r.phone}<div>{r.email}</div></td>
                  <td className="text-xs">{r.summary}</td>
                  <td className="text-xs">{r.messages.length ? <ul className="list-disc pl-4">{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul> : 'OK'}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <CommitForm orgId={orgId} csv={csv} fileName={fileName} analysis={a} />
        </>
      )}
    </div>
  )
}

function CommitForm({ orgId, csv, fileName, analysis }: { orgId: string; csv: string; fileName: string; analysis: ImportAnalysis }) {
  const [includeDup, setIncludeDup] = useState(false)
  const count = analysis.counts.ready + (includeDup ? analysis.counts.duplicate : 0)
  return (
    <ActionForm action={commitImportAction}>
      {(s) => {
        const result = s.data?.result as ImportResult | undefined
        if (result) {
          return (
            <div className="card p-4 text-sm">
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {result.imported.map((r) => <li key={r.id}>Line {r.line}: <Link href={`/students/${r.id}`} className="font-mono">{r.studentCode}</Link></li>)}
              </ul>
              <div className="mt-3 flex gap-2"><Link className="btn-primary" href="/students?sort=newest">Go to students</Link></div>
            </div>
          )
        }
        return (
          <div className="card space-y-3 p-4">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="fileName" value={fileName} />
            {analysis.counts.duplicate > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="includeDuplicates" value="yes" checked={includeDup} onChange={(e) => setIncludeDup(e.target.checked)} className="mt-1" />
                <span>Also import the {analysis.counts.duplicate} possible duplicate{analysis.counts.duplicate === 1 ? '' : 's'} (only if you have checked they are different people — otherwise import them later and merge).</span>
              </label>
            )}
            <p className="text-sm text-slate-700">
              {count} row{count === 1 ? '' : 's'} will be imported into <strong>{analysis.orgName}</strong>.
              {analysis.counts.error > 0 && ` ${analysis.counts.error} row(s) with errors will be skipped — fix them and import them in a separate file.`}
              {' '}The whole import is saved together or not at all.
            </p>
            {count > 0 ? <SubmitButton pendingText="Importing…">Import {count} student{count === 1 ? '' : 's'}</SubmitButton>
              : <p className="text-sm text-red-700">Nothing to import yet.</p>}
          </div>
        )
      }}
    </ActionForm>
  )
}
