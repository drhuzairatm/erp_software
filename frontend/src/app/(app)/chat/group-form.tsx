'use client'

import { useState } from 'react'
import { createGroupAction } from '@/app/actions/chat'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

export function NewGroupForm({ orgs, people, types }: { orgs: { id: string; name: string }[]; people: { id: string; full_name: string; org_id: string }[]; types: { value: string; label: string }[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? '')
  const [type, setType] = useState('custom')
  const [who, setWho] = useState('')
  const auto = type === 'all_employees' || type === 'core_team'
  return (
    <ActionForm action={createGroupAction} className="space-y-2">
      {(s) => (<>
        <div><label className="label" htmlFor="g-org">Company</label><select className="input" id="g-org" name="orgId" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div><label className="label" htmlFor="g-type">Type</label><select className="input" id="g-type" name="groupType" value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
        <div><label className="label" htmlFor="g-name">Name</label><input className="input" id="g-name" name="name" required maxLength={100} /><FieldError state={s} name="name" /></div>
        {auto ? <p className="hint">Members come from the company list automatically.</p> : (
          <fieldset><legend className="label">Members</legend><label className="sr-only" htmlFor="g-find">Find a person</label><input id="g-find" className="input mb-1" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Type a name" autoComplete="off" /><div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 text-sm">{people.filter((p) => p.org_id === org).map((p) => <label key={p.id} className={`items-center gap-2 ${p.full_name.toLowerCase().includes(who.trim().toLowerCase()) ? 'flex' : 'hidden'}`}><input type="checkbox" name="members" value={p.id} />{p.full_name}</label>)}</div></fieldset>)}
        <SubmitButton className="btn-secondary btn-sm">Create group</SubmitButton>
      </>)}
    </ActionForm>
  )
}
