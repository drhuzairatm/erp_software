'use client'

import { useState } from 'react'
import { type Condition, type ConditionOptions, FIELDS, type FieldKey, type Group, type Leaf, OPS } from '@/lib/conditions'

export type { ConditionOptions }

type Node = { id: number; kind: 'group'; mode: 'all' | 'any'; items: Node[] } | { id: number; kind: 'leaf'; field: FieldKey; op: string; values: string[]; value: string }

let seq = 0
const nid = () => ++seq

function toNode(c: Condition | null): Node {
  if (!c) return { id: nid(), kind: 'group', mode: 'all', items: [] }
  if ('all' in c || 'any' in c) {
    const mode = 'all' in c ? 'all' : 'any'
    return { id: nid(), kind: 'group', mode, items: ((c as Group & Record<string, Condition[]>)[mode] as Condition[]).map(toNode) }
  }
  const l = c as Leaf
  return { id: nid(), kind: 'leaf', field: l.field, op: l.op, values: 'values' in l ? l.values : [], value: 'value' in l ? String(l.value) : '' }
}

function toCondition(n: Node): Condition | null {
  if (n.kind === 'group') {
    const items = n.items.map(toCondition).filter((x): x is Condition => x !== null)
    if (!items.length) return null
    return n.mode === 'all' ? { all: items } : { any: items }
  }
  if (n.op === 'is_set' || n.op === 'is_not_set') return { field: n.field, op: n.op }
  if (n.op === 'gte' || n.op === 'lte') return n.value === '' ? null : { field: n.field, op: n.op, value: Number(n.value) }
  return n.values.length ? { field: n.field, op: n.op as 'in' | 'not_in', values: n.values } : null
}

/**
 * AND/OR condition editor. Submits the condition as JSON in a hidden input (`name`).
 * Empty = no extra condition.
 */
export function ConditionBuilder({ name = 'conditions', initial, options, label = 'Extra conditions (optional)' }: {
  name?: string; initial: Condition | null; options: ConditionOptions; label?: string
}) {
  const [root, setRoot] = useState<Node>(() => toNode(initial))
  const update = (fn: (n: Node) => Node) => setRoot((r) => fn(r))
  const json = toCondition(root)

  const replace = (n: Node, id: number, f: (x: Node) => Node | null): Node | null => {
    if (n.id === id) return f(n)
    if (n.kind === 'group') return { ...n, items: n.items.map((x) => replace(x, id, f)).filter((x): x is Node => x !== null) }
    return n
  }
  const change = (id: number, f: (x: Node) => Node | null) => update((r) => replace(r, id, f) ?? { id: nid(), kind: 'group', mode: 'all', items: [] })

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    if (n.kind === 'group') {
      return (
        <div key={n.id} className={`space-y-2 rounded-xl border p-3 ${depth === 0 ? 'border-slate-200 bg-slate-50/60' : 'border-dashed border-brand-200 bg-white'}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-slate-600">Match</span>
            <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Match all or any">
              {(['all', 'any'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={n.mode === m}
                  onClick={() => change(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'group' }>), mode: m }))}
                  className={`rounded-md px-2.5 py-1 font-semibold ${n.mode === m ? 'bg-navy-950 text-white' : 'text-slate-600'}`}>
                  {m === 'all' ? 'ALL (and)' : 'ANY (or)'}</button>))}
            </div>
            <span className="text-slate-500">of these conditions</span>
            {depth > 0 && <button type="button" className="ml-auto text-red-700 hover:underline" onClick={() => change(n.id, () => null)}>Remove group</button>}
          </div>
          {n.items.length === 0 && <p className="text-xs text-slate-500">{depth === 0 ? 'No extra conditions: the rule applies by its other settings.' : 'Empty group.'}</p>}
          {n.items.map((x) => renderNode(x, depth + 1))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-sm"
              onClick={() => change(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'group' }>), items: [...(x as Extract<Node, { kind: 'group' }>).items, { id: nid(), kind: 'leaf', field: 'nationality', op: 'in', values: [], value: '' }] }))}>
              + Condition</button>
            {depth < 2 && <button type="button" className="btn-ghost btn-sm"
              onClick={() => change(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'group' }>), items: [...(x as Extract<Node, { kind: 'group' }>).items, { id: nid(), kind: 'group', mode: 'any', items: [] }] }))}>
              + Group</button>}
          </div>
        </div>
      )
    }
    const f = FIELDS[n.field]
    const opts = f.kind === 'number' ? [] : options[f.kind] ?? []
    const ops = f.kind === 'number' ? ['gte', 'lte', 'is_set', 'is_not_set'] : ['in', 'not_in', 'is_set', 'is_not_set']
    const set = (patch: Partial<Extract<Node, { kind: 'leaf' }>>) => change(n.id, (x) => ({ ...(x as Extract<Node, { kind: 'leaf' }>), ...patch }))
    return (
      <div key={n.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Field" className="input w-auto py-1.5 text-sm" value={n.field}
            onChange={(e) => { const fk = e.target.value as FieldKey; set({ field: fk, op: FIELDS[fk].kind === 'number' ? 'gte' : 'in', values: [], value: '' }) }}>
            {Object.entries(FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select aria-label="Operator" className="input w-auto py-1.5 text-sm" value={n.op} onChange={(e) => set({ op: e.target.value })}>
            {ops.map((o) => <option key={o} value={o}>{OPS[o]}</option>)}
          </select>
          {(n.op === 'gte' || n.op === 'lte') && (
            <input aria-label="Number" type="number" min={0} max={1200} className="input w-24 py-1.5 text-sm" value={n.value} onChange={(e) => set({ value: e.target.value })} />)}
          {(n.op === 'in' || n.op === 'not_in') && (
            <select aria-label="Add value" className="input w-auto max-w-56 py-1.5 text-sm" value=""
              onChange={(e) => { if (e.target.value && !n.values.includes(e.target.value)) set({ values: [...n.values, e.target.value] }) }}>
              <option value="">Add a value…</option>
              {opts.filter((o) => !n.values.includes(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>)}
          <button type="button" aria-label="Remove condition" className="ml-auto rounded-md px-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => change(n.id, () => null)}>✕</button>
        </div>
        {(n.op === 'in' || n.op === 'not_in') && n.values.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {n.values.map((v) => (
              <li key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
                {opts.find((o) => o.value === v)?.label ?? 'Unknown'}
                <button type="button" aria-label="Remove value" className="text-brand-500 hover:text-red-700" onClick={() => set({ values: n.values.filter((x) => x !== v) })}>×</button>
              </li>))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <fieldset className="space-y-2">
      <legend className="label">{label}</legend>
      {renderNode(root, 0)}
      <input type="hidden" name={name} value={json ? JSON.stringify(json) : ''} />
    </fieldset>
  )
}
