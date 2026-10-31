'use client'

import { createContext, type ReactNode, useActionState, useContext, useEffect, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { type ActionResult, initialResult } from './action-types'

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>

const PendingContext = createContext<boolean | null>(null)

/**
 * A form bound to a server action. Shows a success/error message, passes field
 * errors to children, and resets on success when `resetOnSuccess` is set.
 */
export function ActionForm({ action, children, className = 'space-y-4', resetOnSuccess, successMessage, id }: {
  action: Action
  children: ReactNode | ((state: ActionResult) => ReactNode)
  className?: string
  resetOnSuccess?: boolean
  successMessage?: string
  id?: string
}) {
  const [state, formAction, actionPending] = useActionState(action, initialResult)
  const [transitionPending, startTransition] = useTransition()
  const ref = useRef<HTMLFormElement>(null)
  // Submitting via onSubmit (instead of only the `action` prop) avoids React 19's automatic
  // form reset, so typed values survive validation errors and warnings. The `action` prop
  // remains as a no-JavaScript fallback.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const fd = new FormData(e.currentTarget, submitter)
    startTransition(() => formAction(fd))
  }
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset()
  }, [state, resetOnSuccess])
  return (
    <PendingContext.Provider value={actionPending || transitionPending}>
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={className} id={id} noValidate>
      {state.message && (
        <div role={state.ok ? 'status' : 'alert'}
          className={`rounded-md border px-3 py-2 text-sm ${state.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          {state.message}
        </div>
      )}
      {!state.message && state.ok && successMessage && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{successMessage}</div>
      )}
      {typeof children === 'function' ? children(state) : children}
    </form>
    </PendingContext.Provider>
  )
}

export function SubmitButton({ children, className = 'btn-primary', pendingText = 'Saving…', name, value, formNoValidate }: {
  children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string; formNoValidate?: boolean
}) {
  const pending = usePending()
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending} name={name} value={value} formNoValidate={formNoValidate}>
      {pending ? pendingText : children}
    </button>
  )
}

/** Two-step confirmation for destructive or sensitive actions. */
export function ConfirmSubmit({ children, confirmText, className = 'btn-danger', pendingText = 'Working…' }: {
  children: ReactNode; confirmText: string; className?: string; pendingText?: string
}) {
  const [asking, setAsking] = useState(false)
  const pending = usePending()
  if (!asking) {
    return <button type="button" className={className} onClick={() => setAsking(true)}>{children}</button>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900" role="group" aria-label="Confirm action">
      <span>{confirmText}</span>
      <button type="submit" className={`${className} btn-sm`} disabled={pending}>{pending ? pendingText : 'Yes, continue'}</button>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  )
}

export function FieldError({ state, name }: { state: ActionResult; name: string }) {
  const e = state.fieldErrors?.[name]
  return e ? <p className="mt-1 text-xs text-red-600" id={`${name}-error`}>{e.join(' ')}</p> : null
}

/** Submits the enclosing form when the select changes (progressive enhancement: still has a button). */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
}

function usePending() {
  const ctx = useContext(PendingContext)
  const { pending } = useFormStatus()
  return ctx ?? pending
}
