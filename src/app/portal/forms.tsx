'use client'

import { ActionForm, FieldError, SubmitButton } from '@/components/forms'
import { chooseAction, requestCodeAction, submitCourierAction, uploadAction, verifyCodeAction } from './actions'

export function RequestCodeForm() {
  return (
    <ActionForm action={requestCodeAction}>
      <div>
        <label htmlFor="identifier" className="label">Email or mobile number you registered with</label>
        <input id="identifier" name="identifier" className="input text-base" autoComplete="username" required autoFocus placeholder="name@example.com or +91 …" />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Sending…">Send me a code</SubmitButton>
    </ActionForm>
  )
}

export function VerifyCodeForm({ challenge }: { challenge: string }) {
  return (
    <ActionForm action={verifyCodeAction.bind(null, challenge)}>
      <div>
        <label htmlFor="code" className="label">6-digit code</label>
        <input id="code" name="code" className="input text-center font-mono text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} required autoFocus />
      </div>
      <SubmitButton className="btn-primary w-full" pendingText="Checking…">Sign in</SubmitButton>
    </ActionForm>
  )
}

export function ChooseButton({ studentId, label }: { studentId: string; label: string }) {
  return <ActionForm action={chooseAction.bind(null, studentId)}><SubmitButton className="btn-secondary w-full justify-between">{label}</SubmitButton></ActionForm>
}

export function PortalUpload({ documentId }: { documentId: string }) {
  return (
    <ActionForm action={uploadAction.bind(null, documentId)} className="mt-2 flex flex-wrap items-center gap-2" resetOnSuccess>
      <label className="sr-only" htmlFor={`f-${documentId}`}>Choose file</label>
      <input id={`f-${documentId}`} type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png"
        className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-800 sm:w-auto" />
      <SubmitButton className="btn-primary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
    </ActionForm>
  )
}

export function CourierDetailsForm({ shipmentId, company, tracking }: { shipmentId: string; company: string | null; tracking: string | null }) {
  return (
    <ActionForm action={submitCourierAction.bind(null, shipmentId)} className="space-y-3">
      {(s) => (
        <>
          <div><label className="label" htmlFor={`pc-${shipmentId}`}>Courier company *</label>
            <input className="input" id={`pc-${shipmentId}`} name="courierCompany" defaultValue={company ?? ''} required maxLength={120} /><FieldError state={s} name="courierCompany" /></div>
          <div><label className="label" htmlFor={`pt-${shipmentId}`}>Tracking / consignment number *</label>
            <input className="input font-mono" id={`pt-${shipmentId}`} name="trackingNumber" defaultValue={tracking ?? ''} required maxLength={80} /><FieldError state={s} name="trackingNumber" /></div>
          <div><label className="label" htmlFor={`pd-${shipmentId}`}>Date sent</label>
            <input className="input" id={`pd-${shipmentId}`} name="dispatchDate" type="date" /></div>
          <SubmitButton className="btn-primary w-full">{company ? 'Update courier details' : 'Send courier details'}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
