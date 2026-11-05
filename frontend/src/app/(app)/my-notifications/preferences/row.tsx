'use client'

import { setNotificationPreferenceAction } from '@/app/actions/staff-notifications'
import { ActionForm, SubmitButton } from '@/components/forms'

export function PreferenceRow({ category, label, help, inApp, email }: { category: string; label: string; help: string; inApp: boolean; email: boolean }) {
  return (
    <li className="py-3">
      <ActionForm action={setNotificationPreferenceAction.bind(null, category)} className="flex flex-wrap items-center justify-between gap-3">
        <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{help}</span></span>
        <span className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1"><input type="checkbox" name="inApp" defaultChecked={inApp} />In the ERP</label>
          <label className="flex items-center gap-1"><input type="checkbox" name="email" defaultChecked={email} />By email</label>
          <SubmitButton className="btn-secondary btn-sm">Save</SubmitButton>
        </span>
      </ActionForm>
    </li>
  )
}
