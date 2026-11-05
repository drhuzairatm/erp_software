'use client'

import Link from 'next/link'
import { useState } from 'react'
import { addReferenceAction, cancelInviteAction, createRoleAction, createStaffAction, inviteAction, reassignTasksAction, revokeSessionsAction, staffDetailsAction, staffStatusAction, membershipAction, orgSettingsAction, removeStaffPhotoAction, reportingManagerAction, resetLinkAction, roleStructureAction, rolePermissionsAction, staffPhotoAction, toggleReferenceAction, workflowAction, staffDesignationAction } from '@/app/actions/admin'
import { PhotoCapture } from '@/components/photo-capture'
import { adminResetMfaAction } from '@/app/actions/auth'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { value: string; label: string }

function LinkBox({ link }: { link?: unknown }) {
  if (typeof link !== 'string') return null
  return <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="One-time link" />
}

export function CreateStaffForm({ orgs, roles, managers, departments = [] }: { orgs: Opt[]; roles: { id: string; org_id: string; name: string }[]; managers: Opt[]; departments?: { id: string; org_id: string; name: string }[] }) {
  const [k, setK] = useState(0)
  const [org, setOrg] = useState('')
  return (
    <ActionForm action={createStaffAction} resetOnSuccess onSuccess={() => setK((x) => x + 1)}>
      {(s) => (
        <>
          <LinkBox link={s.data?.link} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div><label className="label" htmlFor="fullName">Full name</label><input className="input" id="fullName" name="fullName" required /><FieldError state={s} name="fullName" /></div>
            <div><label className="label" htmlFor="email">Work email</label><input className="input" id="email" name="email" type="email" required /><FieldError state={s} name="email" /></div>
            <div><label className="label" htmlFor="jobTitle">Job title</label><input className="input" id="jobTitle" name="jobTitle" /></div>
            <div><label className="label" htmlFor="staff-role">Company and role</label>
              <select className="input" id="staff-role" name="roleOrg" required onChange={(e) => {
                const [roleId, orgId] = e.currentTarget.value.split('|')
                const f = e.currentTarget.form!
                ;(f.elements.namedItem('roleId') as HTMLInputElement).value = roleId
                ;(f.elements.namedItem('orgId') as HTMLInputElement).value = orgId
                setOrg(orgId)
              }} defaultValue="">
                <option value="" disabled>Choose…</option>
                {orgs.map((o) => (
                  <optgroup key={o.value} label={o.label}>
                    {roles.filter((r) => r.org_id === o.value).map((r) => <option key={r.id} value={`${r.id}|${o.value}`}>{r.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <input type="hidden" name="roleId" /><input type="hidden" name="orgId" />
              <FieldError state={s} name="roleId" /></div>
            <div><label className="label" htmlFor="reportsTo">Reporting manager</label>
              <select className="input" id="reportsTo" name="reportsTo" defaultValue=""><option value="">— none —</option>{managers.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><label className="label" htmlFor="staff-dept">Department</label>
              <select className="input" id="staff-dept" name="departmentId" defaultValue="" key={org}><option value="">— none —</option>
                {departments.filter((d) => d.org_id === org).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><FieldError state={s} name="departmentId" /></div>
            <div><label className="label" htmlFor="staff-phone">Mobile</label><input className="input" id="staff-phone" name="phone" type="tel" placeholder="+91 …" /><FieldError state={s} name="phone" /></div>
            <div><label className="label" htmlFor="staff-joining">Joining date</label><input className="input" id="staff-joining" name="joiningDate" type="date" /><FieldError state={s} name="joiningDate" /></div>
          </div>
          <div><p className="label">Staff Profile Photo (optional)</p>
            <PhotoCapture key={k} square help="A clear, recent photo of the face. JPG or PNG, maximum 5 MB. Shown as this person's avatar to colleagues." /></div>
          <div><SubmitButton>Add staff</SubmitButton></div>
          <p className="hint">New people receive a one-time invitation (valid for a limited number of days) to create their own password; nobody else ever sees it. If the email already has an account (e.g. in the other company), the person is added to this company with the chosen role. Roles in one company never grant access in the other.</p>
        </>
      )}
    </ActionForm>
  )
}

export function MembershipForm({ id, roleId, active, roles, departments, departmentId }: {
  id: string; roleId: string; active: boolean; roles: { id: string; name: string }[]; departments: { id: string; name: string }[]; departmentId: string | null
}) {
  return (
    <ActionForm action={membershipAction.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${id}`}>Role</label>
      <select id={`role-${id}`} name="roleId" className="input py-1 text-xs" defaultValue={roleId}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <label className="sr-only" htmlFor={`dept-${id}`}>Department</label>
      <select id={`dept-${id}`} name="departmentId" className="input py-1 text-xs" defaultValue={departmentId ?? ''}>
        <option value="">No department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" value="yes" defaultChecked={active} /> Active</label>
      <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
    </ActionForm>
  )
}

export function UserButtons({ userId, status, mfaEnabled, canResetMfa = false }: { userId: string; status: string; mfaEnabled: boolean; canResetMfa?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {mfaEnabled && canResetMfa && (
        <ActionForm action={adminResetMfaAction.bind(null, userId)} className="flex flex-col items-end gap-1">
          {(s) => (<>
            <label className="sr-only" htmlFor={`mfa-reason-${userId}`}>How was their identity verified?</label>
            <input id={`mfa-reason-${userId}`} name="reason" className="input py-1 text-xs" minLength={10} maxLength={500} required placeholder="How was their identity verified?" />
            <FieldError state={s} name="reason" />
            <ConfirmSubmit className="btn-secondary btn-sm" confirmText="Reset their two-factor login?">Reset 2FA</ConfirmSubmit>
          </>)}
        </ActionForm>
      )}
      {status === 'active' && (
        <ActionForm action={resetLinkAction.bind(null, userId)} className="flex flex-col items-end gap-1">
          {(s) => <><LinkBox link={s.data?.link} /><SubmitButton className="btn-secondary btn-sm">Issue reset link</SubmitButton></>}
        </ActionForm>
      )}
      <Link className="btn-ghost btn-sm" href={`/admin/users/${userId}#account`}>Manage account</Link>
    </div>
  )
}

/** Invitation: send / resend (earlier links stop working) or cancel. */
export function InvitationButtons({ userId, pending }: { userId: string; pending: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={inviteAction.bind(null, userId)} className="flex flex-col gap-1">
        {(s) => <><LinkBox link={s.data?.link} /><SubmitButton className="btn-primary btn-sm">{pending ? 'Resend invitation' : 'Send new invitation'}</SubmitButton></>}
      </ActionForm>
      {pending && <ActionForm action={cancelInviteAction.bind(null, userId)}><ConfirmSubmit className="btn-secondary btn-sm" confirmText="Cancel the invitation link?">Cancel invitation</ConfirmSubmit></ActionForm>}
    </div>
  )
}

/** Suspend / terminate (reason required) / reactivate. */
export function StaffStatusForm({ userId, status }: { userId: string; status: string }) {
  const [next, setNext] = useState(status === 'active' || status === 'invited' ? 'suspended' : 'active')
  const needsReason = next !== 'active'
  return (
    <ActionForm action={staffStatusAction.bind(null, userId)} className="space-y-2">
      {(s) => (<>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="label" htmlFor="st-next">Change account status</label>
            <select id="st-next" name="status" className="input" value={next} onChange={(e) => setNext(e.target.value)}>
              {status !== 'active' && status !== 'invited' && <option value="active">Reactivate</option>}
              {status !== 'suspended' && <option value="suspended">Suspend (temporary)</option>}
              {status !== 'terminated' && <option value="terminated">Deactivate (employment ended)</option>}
              {(status === 'suspended' || status === 'terminated') && <option value="archived">Archive</option>}
            </select></div>
          {needsReason && <div className="min-w-full flex-1 sm:min-w-64"><label className="label" htmlFor="st-reason">Reason *</label>
            <input id="st-reason" name="reason" className="input" maxLength={500} required /><FieldError state={s} name="reason" /></div>}
          {needsReason
            ? <ConfirmSubmit className="btn-danger btn-sm" confirmText={next === 'archived' ? 'Archive this account? History is kept.' : next === 'terminated' ? 'Deactivate and sign out everywhere?' : 'Suspend and sign out everywhere?'}>{next === 'terminated' ? 'Terminate' : 'Suspend'}</ConfirmSubmit>
            : <SubmitButton className="btn-secondary btn-sm">Reactivate</SubmitButton>}
        </div>
        <p className="hint">Suspending or terminating ends every session at once and blocks sign-in and access to all company data, including documents. Tasks, history and audit records are kept.</p>
      </>)}
    </ActionForm>
  )
}

export function SignOutEverywhereButton({ userId }: { userId: string }) {
  return (
    <ActionForm action={revokeSessionsAction.bind(null, userId)}>
      <ConfirmSubmit className="btn-secondary btn-sm" confirmText="End all of this person's sessions?">Sign out everywhere</ConfirmSubmit>
    </ActionForm>
  )
}

export function StaffDetailsForm({ userId, v }: { userId: string; v: { full_name: string; job_title: string | null; phone: string | null; joining_date: string | null; first_name: string | null; middle_name: string | null; last_name: string | null; secondary_phone: string | null; additional_phone: string | null; address_line: string | null; city: string | null; state_region: string | null; postal_code: string | null; address_country: string | null } }) {
  return (
    <ActionForm action={staffDetailsAction.bind(null, userId)} className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {(s) => (<>
        <div><label className="label" htmlFor="sd-first">First name</label><input className="input" id="sd-first" name="firstName" defaultValue={v.first_name ?? ''} /></div>
        <div><label className="label" htmlFor="sd-middle">Middle name</label><input className="input" id="sd-middle" name="middleName" defaultValue={v.middle_name ?? ''} /></div>
        <div><label className="label" htmlFor="sd-last">Last name</label><input className="input" id="sd-last" name="lastName" defaultValue={v.last_name ?? ''} /></div>
        <div><label className="label" htmlFor="sd-second">Secondary phone</label><input className="input" id="sd-second" name="secondaryPhone" type="tel" defaultValue={v.secondary_phone ?? ''} /><FieldError state={s} name="secondaryPhone" /></div>
        <div><label className="label" htmlFor="sd-add">Additional phone</label><input className="input" id="sd-add" name="additionalPhone" type="tel" defaultValue={v.additional_phone ?? ''} /><FieldError state={s} name="additionalPhone" /></div>
        <div className="md:col-span-3"><label className="label" htmlFor="sd-addr">Address</label><input className="input" id="sd-addr" name="addressLine" defaultValue={v.address_line ?? ''} /></div>
        <div><label className="label" htmlFor="sd-city">City</label><input className="input" id="sd-city" name="city" defaultValue={v.city ?? ''} /></div>
        <div><label className="label" htmlFor="sd-state">State</label><input className="input" id="sd-state" name="stateRegion" defaultValue={v.state_region ?? ''} /></div>
        <div><label className="label" htmlFor="sd-post">Postal code</label><input className="input" id="sd-post" name="postalCode" defaultValue={v.postal_code ?? ''} /></div>
        <div><label className="label" htmlFor="sd-country">Country</label><input className="input" id="sd-country" name="addressCountry" defaultValue={v.address_country ?? ''} /></div>
        <div><label className="label" htmlFor="sd-name">Display name (shown across the ERP)</label><input className="input" id="sd-name" name="fullName" defaultValue={v.full_name} required /><FieldError state={s} name="fullName" /></div>
        <div><label className="label" htmlFor="sd-title">Designation</label><input className="input" id="sd-title" name="jobTitle" defaultValue={v.job_title ?? ''} /></div>
        <div><label className="label" htmlFor="sd-phone">Mobile</label><input className="input" id="sd-phone" name="phone" type="tel" defaultValue={v.phone ?? ''} /><FieldError state={s} name="phone" /></div>
        <div><label className="label" htmlFor="sd-join">Joining date</label><input className="input" id="sd-join" name="joiningDate" type="date" defaultValue={v.joining_date ?? ''} /><FieldError state={s} name="joiningDate" /></div>
        <div className="md:col-span-4"><SubmitButton className="btn-secondary btn-sm">Save details</SubmitButton></div>
      </>)}
    </ActionForm>
  )
}

export function DesignationForm({ userId, orgId, orgName, current, options }: { userId: string; orgId: string; orgName: string; current: string | null; options: Opt[] }) {
  return (
    <ActionForm action={staffDesignationAction.bind(null, userId, orgId)} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor={`dg-${orgId}`}>Designation at {orgName}</label>
        <select id={`dg-${orgId}`} name="designationId" className="input" defaultValue={current ?? ''}><option value="">Not set</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <SubmitButton className="btn-secondary btn-sm">Save designation</SubmitButton>
    </ActionForm>
  )
}

export function ReassignTasksForm({ userId, people, count }: { userId: string; people: Opt[]; count: number }) {
  return (
    <ActionForm action={reassignTasksAction.bind(null, userId)} className="flex flex-wrap items-end gap-2">
      {(s) => (<>
        <div><label className="label" htmlFor="rt-to">Reassign all {count} open task{count === 1 ? '' : 's'} to</label>
          <select id="rt-to" name="toUserId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          <FieldError state={s} name="toUserId" /></div>
        <ConfirmSubmit className="btn-primary btn-sm" confirmText={`Move ${count} open task${count === 1 ? '' : 's'}?`}>Reassign tasks</ConfirmSubmit>
      </>)}
    </ActionForm>
  )
}

export function RolePermissionsForm({ roleId, perms, all, disabled, grantable }: { roleId: string; perms: string[]; all: { key: string; category: string; description: string; is_sensitive: boolean }[]; disabled: boolean; grantable: string[] }) {
  const cats = [...new Set(all.map((p) => p.category))]
  return (
    <ActionForm action={rolePermissionsAction.bind(null, roleId)}>
      <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cats.map((c) => (
          <div key={c}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{c}</p>
            {all.filter((p) => p.category === c).map((p) => (
              <label key={p.key} className="flex items-start gap-2 py-0.5 text-sm">
                <input type="checkbox" name="perm" value={p.key} defaultChecked={perms.includes(p.key)} className="mt-1"
                  disabled={!grantable.includes(p.key)} title={grantable.includes(p.key) ? undefined : 'You can only grant permissions you hold yourself'} />
                {!grantable.includes(p.key) && perms.includes(p.key) && <input type="hidden" name="perm" value={p.key} />}
                <span>{p.description}{p.is_sensitive && <span className="ml-1 text-xs text-amber-700">(sensitive)</span>}<span className="block font-mono text-xs text-slate-400">{p.key}</span></span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      {!disabled && <SubmitButton>Save permissions</SubmitButton>}
    </ActionForm>
  )
}

export function CreateRoleForm({ orgs }: { orgs: Opt[] }) {
  return (
    <ActionForm action={createRoleAction} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      <div><label className="label" htmlFor="role-org">Company</label><select className="input" id="role-org" name="orgId">{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
      <div><label className="label" htmlFor="role-name">Role name</label><input className="input" id="role-name" name="name" required /></div>
      <div><label className="label" htmlFor="role-desc">Description</label><input className="input" id="role-desc" name="description" /></div>
      <div className="flex items-end"><SubmitButton className="btn-secondary">Create role</SubmitButton></div>
    </ActionForm>
  )
}

export function OrgSettingsForm({ orgId, name, currency, allowSelf, supportPhone, supportEmail, portalPayments }: { orgId: string; name: string; currency: string; allowSelf: boolean; supportPhone?: string; supportEmail?: string; portalPayments?: boolean }) {
  return (
    <ActionForm action={orgSettingsAction.bind(null, orgId)} className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div className="md:col-span-2"><label className="label" htmlFor={`n-${orgId}`}>Company name</label><input className="input" id={`n-${orgId}`} name="name" defaultValue={name} required /></div>
      <div><label className="label" htmlFor={`c-${orgId}`}>Ledger currency</label><input className="input uppercase" id={`c-${orgId}`} name="currency" defaultValue={currency} maxLength={3} required /></div>
      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="allowSelfVerify" value="yes" defaultChecked={allowSelf} /> Allow staff to verify payments they recorded</label>
      <div><label className="label" htmlFor={`sp-${orgId}`}>Student portal: support phone</label><input className="input" id={`sp-${orgId}`} name="supportPhone" defaultValue={supportPhone ?? ''} /></div>
      <div><label className="label" htmlFor={`se-${orgId}`}>Student portal: support email</label><input className="input" id={`se-${orgId}`} name="supportEmail" type="email" defaultValue={supportEmail ?? ''} /></div>
      <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2"><input type="checkbox" name="portalPayments" value="yes" defaultChecked={portalPayments} /> Show students their own fees, confirmed payments and balance in the portal</label>
      <div><SubmitButton>Save</SubmitButton></div>
    </ActionForm>
  )
}

type RefKind = 'country' | 'course' | 'university' | 'legal_entity' | 'lead_source' | 'fee_category' | 'department' | 'designation'

export function AddReferenceForm({ kind, fields }: { kind: RefKind; fields: { name: string; label: string; options?: Opt[]; required?: boolean }[] }) {
  return (
    <ActionForm action={addReferenceAction.bind(null, kind)} className="flex flex-wrap items-end gap-2" resetOnSuccess>
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label text-xs" htmlFor={`${kind}-${f.name}`}>{f.label}</label>
          {f.options
            ? <select className="input py-1.5" id={`${kind}-${f.name}`} name={f.name} required={f.required}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            : <input className="input py-1.5" id={`${kind}-${f.name}`} name={f.name} required={f.required} />}
        </div>
      ))}
      <SubmitButton className="btn-secondary btn-sm">Add</SubmitButton>
    </ActionForm>
  )
}

export function ToggleReference({ kind, id, active }: { kind: RefKind; id: string; active: boolean }) {
  return (
    <ActionForm action={toggleReferenceAction.bind(null, kind, id, !active)} className="inline">
      <SubmitButton className="btn-ghost btn-sm" pendingText="…">{active ? 'Deactivate' : 'Activate'}</SubmitButton>
    </ActionForm>
  )
}

export function WorkflowForm({ id, stages, selected, docs, selectedDocs }: { id: string; stages: Opt[]; selected: string[]; docs: Opt[]; selectedDocs: string[] }) {
  return (
    <ActionForm action={workflowAction.bind(null, id)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset><legend className="mb-1 text-sm font-medium">Applicable stages (On Hold and Cancelled are always available)</legend>
          {stages.map((s) => <label key={s.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="stage" value={s.value} defaultChecked={selected.includes(s.value)} /> {s.label}</label>)}
        </fieldset>
        <fieldset><legend className="mb-1 text-sm font-medium">Required documents</legend>
          {docs.map((d) => <label key={d.value} className="flex items-center gap-2 text-sm"><input type="checkbox" name="doc" value={d.value} defaultChecked={selectedDocs.includes(d.value)} /> {d.label}</label>)}
        </fieldset>
      </div>
      <SubmitButton className="btn-secondary">Save workflow</SubmitButton>
    </ActionForm>
  )
}

export function StaffPhotoForm({ userId, hasPhoto }: { userId: string; hasPhoto: boolean }) {
  const [chosen, setChosen] = useState(false)
  const [k, setK] = useState(0)
  return (
    <div className="space-y-3">
      <ActionForm key={k} action={staffPhotoAction.bind(null, userId)} className="space-y-3" onSuccess={() => { setK((x) => x + 1); setChosen(false) }}>
        <PhotoCapture square onChange={setChosen} help="A clear, recent photo of the face. JPG or PNG, maximum 5 MB." />
        {chosen && <SubmitButton>{hasPhoto ? 'Confirm and replace photo' : 'Save photo'}</SubmitButton>}
      </ActionForm>
      {hasPhoto && (
        <ActionForm action={removeStaffPhotoAction.bind(null, userId)}>
          <ConfirmSubmit confirmText="Remove the photo? Initials will be shown instead." className="btn-ghost btn-sm text-red-700">Remove photo</ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  )
}

export function ReportingManagerForm({ userId, current, managers }: { userId: string; current: string | null; managers: Opt[] }) {
  return (
    <ActionForm action={reportingManagerAction.bind(null, userId)} className="flex flex-wrap items-end gap-2">
      <div><label className="label" htmlFor="rm">Reporting manager</label>
        <select className="input" id="rm" name="reportsTo" defaultValue={current ?? ''}><option value="">— none —</option>{managers.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
      <SubmitButton className="btn-secondary">Save</SubmitButton>
    </ActionForm>
  )
}

export function RoleStructureForm({ roleId, active, parent, parents, disabled }: { roleId: string; active: boolean; parent: string | null; parents: Opt[]; disabled: boolean }) {
  return (
    <ActionForm action={roleStructureAction.bind(null, roleId)} className="flex flex-wrap items-end gap-3">
      <div><label className="label text-xs" htmlFor={`rp-${roleId}`}>Reports to (role)</label>
        <select className="input py-1.5 text-sm" id={`rp-${roleId}`} name="parentRoleId" defaultValue={parent ?? ''} disabled={disabled}>
          <option value="">— top level —</option>{parents.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
      <div><label className="label text-xs" htmlFor={`ra-${roleId}`}>Status</label>
        <select className="input py-1.5 text-sm" id={`ra-${roleId}`} name="isActive" defaultValue={String(active)} disabled={disabled}>
          <option value="true">Active</option><option value="false">Inactive (cannot be assigned)</option></select></div>
      {!disabled && <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>}
    </ActionForm>
  )
}
