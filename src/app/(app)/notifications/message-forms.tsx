'use client'

import { useState } from 'react'
import { consentAction, processNowAction, retryMessageAction, saveRuleAction, saveTemplateAction } from '@/app/actions/notifications'
import { ActionForm, FieldError, SubmitButton } from '@/components/forms'

export function ConsentForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={consentAction.bind(null, studentId)} className="grid grid-cols-1 gap-3 md:grid-cols-5" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label" htmlFor="recipient">Who</label>
            <select className="input" id="recipient" name="recipient"><option value="student">Student</option><option value="parent">Parent / guardian</option></select></div>
          <div><label className="label" htmlFor="channel">Channel</label>
            <select className="input" id="channel" name="channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
          <div><label className="label" htmlFor="granted">Decision</label>
            <select className="input" id="granted" name="granted"><option value="yes">Agrees to receive</option><option value="no">Withdraws / does not agree</option></select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="source">How was this given?</label>
            <input className="input" id="source" name="source" required placeholder='e.g. "Signed form", "Replied STOP on WhatsApp"' /><FieldError state={s} name="source" /></div>
          <div className="md:col-span-5"><SubmitButton className="btn-secondary">Record</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function RetryButton({ id, back }: { id: string; back: string }) {
  return <ActionForm action={retryMessageAction.bind(null, id, back)} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">Retry</SubmitButton></ActionForm>
}

export function ProcessNowButton() {
  return <ActionForm action={processNowAction}><SubmitButton className="btn-secondary" pendingText="Processing…">Process queue now</SubmitButton></ActionForm>
}

export function TemplateForm({ t, placeholders }: { t: { id: string; channel: string; subject: string | null; body: string; provider_template_name: string | null; provider_params: string[] }; placeholders: readonly string[] }) {
  return (
    <ActionForm action={saveTemplateAction.bind(null, t.id)} className="space-y-2">
      {t.channel === 'email' && (<div><label className="label text-xs" htmlFor={`sub-${t.id}`}>Subject</label><input className="input" id={`sub-${t.id}`} name="subject" defaultValue={t.subject ?? ''} /></div>)}
      <div><label className="label text-xs" htmlFor={`body-${t.id}`}>{t.channel === 'whatsapp' ? 'Message text (reference copy of the approved WhatsApp template)' : 'Message'}</label>
        <textarea className="input font-mono text-xs" id={`body-${t.id}`} name="body" rows={t.channel === 'email' ? 6 : 3} defaultValue={t.body} /></div>
      {t.channel !== 'email' && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div><label className="label text-xs" htmlFor={`ptn-${t.id}`}>{t.channel === 'whatsapp' ? 'Approved template name in Gallabox' : 'DLT template ID'}</label>
            <input className="input font-mono" id={`ptn-${t.id}`} name="providerTemplateName" defaultValue={t.provider_template_name ?? ''} /></div>
          <div><label className="label text-xs" htmlFor={`pp-${t.id}`}>Variables in template order (comma-separated; use gallaboxName=placeholder if names differ)</label>
            <input className="input font-mono" id={`pp-${t.id}`} name="providerParams" defaultValue={t.provider_params.join(', ')} /></div>
        </div>
      )}
      <p className="text-xs text-slate-500">Placeholders: {placeholders.map((p) => `{{${p}}}`).join(' ')}</p>
      <SubmitButton className="btn-secondary btn-sm">Save template</SubmitButton>
    </ActionForm>
  )
}

export function RuleToggle({ orgId, eventKey, channel, audience, templateId, enabled, stageKeys, stages }: {
  orgId: string; eventKey: string; channel: string; audience: string; templateId: string; enabled: boolean; stageKeys: string[]
  stages?: { key: string; name: string }[]
}) {
  const [on, setOn] = useState(enabled)
  return (
    <ActionForm action={saveRuleAction.bind(null, orgId, eventKey, channel, audience, templateId)} className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" value="yes" checked={on} onChange={(e) => setOn(e.target.checked)} /> {on ? 'On' : 'Off'}
      </label>
      {stages && on && (
        <details className="text-xs"><summary className="cursor-pointer text-slate-600">{stageKeys.length ? `${stageKeys.length} stages` : 'All stages'}</summary>
          <div className="mt-1 grid grid-cols-1 gap-0.5">{stages.map((s) => (
            <label key={s.key} className="flex items-center gap-1"><input type="checkbox" name="stage" value={s.key} defaultChecked={stageKeys.includes(s.key)} /> {s.name}</label>))}
          </div>
          <p className="mt-1 text-slate-500">None ticked = every stage change</p>
        </details>
      )}
      <SubmitButton className="btn-ghost btn-sm" pendingText="…">Save</SubmitButton>
    </ActionForm>
  )
}
