import type { Metadata } from 'next'
import { contactRequiredStage } from '@/server/services/passport'
import { noticesByCountry } from '@/server/services/requirements'
import { notFound } from 'next/navigation'
import { updateStudentAction } from '@/app/actions/students'
import { Alert, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { getStudent } from '@/server/services/students'
import { currentSelections } from '@/server/services/master-data'
import { StudentForm } from '../../student-form'

export const metadata: Metadata = { title: 'Edit student' }

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const profile = await getStudent(ctx, id)
  if (!profile) notFound()
  const s = profile.student
  if (!profile.permissions.update) {
    return <><PageHeader title="Edit student" back={{ href: `/students/${id}`, label: s.full_name }} /><Alert tone="amber">You cannot edit this record.</Alert></>
  }
  const [lookups, current] = await Promise.all([getLookups(ctx), currentSelections(ctx, id)])
  return (
    <>
      <PageHeader title={`Edit ${s.full_name}`} description={s.student_code} back={{ href: `/students/${id}`, label: 'Back to profile' }} />
      <StudentForm contactRequiredFrom={(await contactRequiredStage(ctx))?.name} countryNotices={await noticesByCountry(ctx)} action={updateStudentAction.bind(null, id)} mode="edit" cancelHref={`/students/${id}`} contactEditable={s.contact_visible} passportEditable={s.passport_visible}
        registerOrgs={[]} organizations={lookups.organizations} lookups={lookups} currentSelections={current}
        initial={{
          originatingOrgId: s.originating_org_id, processingOrgId: s.processing_org_id, leadSourceId: s.lead_source_id, fullName: s.full_name,
          phone: s.phone, phoneCountry: s.phone_country, phone2: s.phone2, phone2Country: s.phone2_country, phone3: s.phone3,
          phone3Country: s.phone3_country, phone3Label: s.phone3_label, residenceCountryId: s.residence_country_id, email: s.email, dateOfBirth: s.date_of_birth, preferredLanguage: s.preferred_language,
          destinationCountryId: s.destination_country_id, courseId: s.course_id, preferredUniversityId: s.preferred_university_id,
          highestQualification: s.highest_qualification, qualificationBoard: s.qualification_board, qualificationYear: s.qualification_year,
          qualificationScore: s.qualification_score, entranceExam: s.entrance_exam, entranceScore: s.entrance_score, academicNotes: s.academic_notes,
          registrationDate: s.registration_date, nextAction: s.next_action, nextActionDue: s.next_action_due,
          contractingEntityId: s.contracting_entity_id, paymentRecipientEntityId: s.payment_recipient_entity_id,
          previousEducationCountryId: s.previous_education_country_id, schoolCountryId: s.school_country_id, institutionName: s.institution_name,
          passportNumber: s.passport_number, passportExpiry: s.passport_expiry, passportCountryId: s.passport_country_id,
          preferredCampusId: s.preferred_campus_id,
          visaApplicationCountryId: s.visa_application_country_id, intakeId: s.intake_id,
          parentName: s.parent_name, parentPhone: s.parent_phone, parentEmail: s.parent_email,
        }} />
    </>
  )
}
