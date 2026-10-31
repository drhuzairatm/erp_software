'use client'

import { academicCheckAction, addOasRuleAction, addTemplateAction, addThresholdAction, approveTemplateAction, retireTemplateAction, toggleOasRuleAction, toggleThresholdAction } from '@/app/actions/academic'
import { ActionForm, ConfirmSubmit, FieldError, SubmitButton } from '@/components/forms'

type Opt = { id: string; name: string }
const sel = (name: string, label: string, opts: Opt[], any = 'Any') => (
  <div><label className="label" htmlFor={`f-${name}`}>{label}</label>
    <select className="input" id={`f-${name}`} name={name} defaultValue=""><option value="">{any}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
)

export function AddThresholdForm({ countries, universities, courses, intakes }: { countries: Opt[]; universities: Opt[]; courses: Opt[]; intakes: Opt[] }) {
  return (
    <ActionForm action={addThresholdAction} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="f-tname">Name</label><input className="input" id="f-tname" name="name" required placeholder="e.g. Pleven Nursing – Biology 65%" /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="f-subject">Subject</label>
            <select className="input" id="f-subject" name="subjectKey" defaultValue="biology">
              <option value="overall">Overall result</option><option value="physics">Physics</option><option value="chemistry">Chemistry</option><option value="biology">Biology</option><option value="mathematics">Mathematics</option><option value="english">English</option>
            </select></div>
          <div><label className="label" htmlFor="f-min">Minimum %</label><input className="input" id="f-min" name="minPercentage" inputMode="decimal" required /><FieldError state={s} name="minPercentage" /></div>
          <div><label className="label" htmlFor="f-rk">Qualification</label>
            <select className="input" id="f-rk" name="recordKind" defaultValue="plus_two"><option value="plus_two">Plus Two</option><option value="class_10">Class 10</option><option value="bachelor">Bachelor&apos;s</option><option value="mbbs">MBBS</option></select></div>
          {sel('destinationCountryId', 'Destination', countries)}
          {sel('universityId', 'University', universities)}
          {sel('courseId', 'Course / programme', courses)}
          {sel('intakeId', 'Intake', intakes)}
          <div><label className="label" htmlFor="f-grading">Grading system</label>
            <select className="input" id="f-grading" name="gradingSystem" defaultValue=""><option value="">Any</option><option value="percentage">Percentage</option><option value="marks">Marks</option></select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="f-src">Source / note</label><input className="input" id="f-src" name="sourceNote" /></div>
          <div className="md:col-span-4"><SubmitButton>Add threshold</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function AddOasRuleForm({ countries, universities, courses }: { countries: Opt[]; universities: Opt[]; courses: Opt[] }) {
  return (
    <ActionForm action={addOasRuleAction} className="grid grid-cols-1 gap-3 md:grid-cols-4" resetOnSuccess>
      {(s) => (
        <>
          <div className="md:col-span-2"><label className="label" htmlFor="f-rname">Name</label><input className="input" id="f-rname" name="name" required placeholder="e.g. Bulgaria – surname missing on Plus Two" /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="f-req">Requirement</label>
            <select className="input" id="f-req" name="requirement" defaultValue="mandatory"><option value="mandatory">Mandatory</option><option value="recommended">Recommended</option></select></div>
          <div><label className="label" htmlFor="f-mt">Type of difference</label>
            <select className="input" id="f-mt" name="mismatchType" defaultValue=""><option value="">Any</option><option value="spelling">Spelling</option><option value="initials">Initials</option>
              <option value="missing_surname">Surname missing</option><option value="missing_middle_name">Middle name missing</option><option value="name_order">Name order</option>
              <option value="extra_name">Extra name</option><option value="spacing">Spacing</option><option value="other">Other</option></select></div>
          <div><label className="label" htmlFor="f-rkind">Certificate</label>
            <select className="input" id="f-rkind" name="recordKind" defaultValue=""><option value="">Any</option><option value="class_10">Class 10</option><option value="plus_two">Plus Two</option>
              <option value="bachelor">Bachelor&apos;s</option><option value="mbbs">MBBS</option><option value="internship">Internship</option><option value="other">Other</option></select></div>
          {sel('destinationCountryId', 'Destination', countries)}
          {sel('universityId', 'University', universities)}
          {sel('courseId', 'Course / pathway', courses)}
          <div className="md:col-span-4"><SubmitButton>Add rule</SubmitButton></div>
        </>
      )}
    </ActionForm>
  )
}

export function AddTemplateForm() {
  return (
    <ActionForm action={addTemplateAction} className="space-y-3" resetOnSuccess>
      {(s) => (
        <>
          <div><label className="label" htmlFor="f-tpl">Template name</label><input className="input" id="f-tpl" name="name" required /><FieldError state={s} name="name" /></div>
          <div><label className="label" htmlFor="f-body">Wording</label>
            <textarea className="input min-h-32" id="f-body" name="body" required maxLength={6000}
              placeholder={'This is to certify that {{passport_name}} (as in the passport) and {{certificate_name}} (as in the {{document}}) are one and the same person…'} />
            <FieldError state={s} name="body" />
            <p className="hint">Placeholders: {'{{passport_name}} {{certificate_name}} {{document}} {{student_name}} {{date}}'}. New templates are drafts until a manager or the MD approves them.</p></div>
          <SubmitButton className="btn-secondary">Save draft template</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}

export function Toggle({ kind, id, active }: { kind: 'threshold' | 'rule'; id: string; active: boolean }) {
  const action = kind === 'threshold' ? toggleThresholdAction : toggleOasRuleAction
  return <ActionForm action={action.bind(null, id, !active)} className="inline"><SubmitButton className="btn-ghost btn-sm" pendingText="…">{active ? 'Deactivate' : 'Activate'}</SubmitButton></ActionForm>
}
export function TemplateButtons({ id, status, canApprove }: { id: string; status: string; canApprove: boolean }) {
  if (!canApprove) return null
  if (status === 'draft') return <ActionForm action={approveTemplateAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-primary btn-sm" confirmText="Approve this wording for use?">Approve</ConfirmSubmit></ActionForm>
  if (status === 'approved') return <ActionForm action={retireTemplateAction.bind(null, id)} className="inline"><ConfirmSubmit className="btn-ghost btn-sm" confirmText="Retire this template?">Retire</ConfirmSubmit></ActionForm>
  return null
}
export function AcademicCheckSelect({ stageKey, value }: { stageKey: string; value: string }) {
  return (
    <ActionForm action={academicCheckAction.bind(null, stageKey)} className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`ac-${stageKey}`}>Academic check</label>
      <select className="input w-auto py-1 text-sm" id={`ac-${stageKey}`} name="check" defaultValue={value}>
        <option value="none">No check</option><option value="warn">Warn</option><option value="block">Block</option>
      </select>
      <SubmitButton className="btn-ghost btn-sm" pendingText="…">Save</SubmitButton>
    </ActionForm>
  )
}
