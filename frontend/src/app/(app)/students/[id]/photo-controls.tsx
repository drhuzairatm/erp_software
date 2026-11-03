'use client'

import { useRef, useState } from 'react'
import { removeStudentPhotoAction, uploadStudentPhotoAction } from '@/app/actions/students'
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/forms'
import { PhotoCapture } from '@/components/photo-capture'

/** Profile header avatar: photo (click for a larger view) or initials, plus upload / replace / remove / download. */
export function StudentPhoto({ studentId, name, initials, version, canEdit }: { studentId: string; name: string; initials: string; version: number | null; canEdit: boolean }) {
  const view = useRef<HTMLDialogElement>(null)
  const edit = useRef<HTMLDialogElement>(null)
  const [chosen, setChosen] = useState(false)
  const [k, setK] = useState(0)
  const thumb = version ? `/api/students/${studentId}/photo?size=thumb&v=${version}` : null
  return (
    <div className="-mt-10 shrink-0">
      {thumb ? (
        <button type="button" onClick={() => view.current?.showModal()} aria-label={`View ${name}'s photo`}
          className="block rounded-full border-4 border-white shadow-lg focus-visible:outline-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" className="h-20 w-20 rounded-full object-cover" />
        </button>
      ) : (
        <span aria-hidden className="inline-flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-brand-500 to-teal-brand text-2xl font-bold text-white shadow-lg">{initials}</span>
      )}
      <div className="mt-1 flex justify-center gap-1">
        {canEdit && <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => { setK((x) => x + 1); setChosen(false); edit.current?.showModal() }}>
          {version ? 'Replace photo' : 'Upload photo'}</button>}
      </div>

      <dialog ref={view} className="m-auto max-w-[95vw] rounded-2xl p-0 shadow-2xl backdrop:bg-black/60" aria-label="Student photo">
        <div className="space-y-3 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {version && <img src={`/api/students/${studentId}/photo?size=portrait&v=${version}`} alt={`Photo of ${name}`} className="mx-auto max-h-[70vh] w-auto rounded-lg" />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a className="btn-primary btn-sm" href={`/api/students/${studentId}/photo/download`}>Download Passport Photo</a>
            <div className="flex gap-2">
              {canEdit && version && (
                <ActionForm action={removeStudentPhotoAction.bind(null, studentId)} onSuccess={() => view.current?.close()}>
                  <ConfirmSubmit confirmText="Remove the photo? The initials will be shown instead." className="btn-danger btn-sm">Remove photo</ConfirmSubmit>
                </ActionForm>
              )}
              <button type="button" className="btn-secondary btn-sm" onClick={() => view.current?.close()}>Close</button>
            </div>
          </div>
        </div>
      </dialog>

      <dialog ref={edit} className="m-auto w-[min(92vw,34rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-black/60" aria-label={version ? 'Replace photo' : 'Upload photo'}>
        <ActionForm key={k} action={uploadStudentPhotoAction.bind(null, studentId)} className="space-y-3 p-5" onSuccess={() => edit.current?.close()}>
          <h2 className="text-base font-semibold">{version ? 'Replace photo' : 'Upload photo'} – {name}</h2>
          <PhotoCapture onChange={setChosen} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => edit.current?.close()}>Cancel</button>
            {chosen && <SubmitButton pendingText="Saving…">{version ? 'Confirm and replace' : 'Save photo'}</SubmitButton>}
          </div>
        </ActionForm>
      </dialog>
    </div>
  )
}
