import type { Metadata } from 'next'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canManageRules } from '@/server/services/verification-rules'
import { ruleOptions } from '../options'
import { conditionOptions } from '@/server/services/rules'
import { RuleForm } from '../rule-forms'

export const metadata: Metadata = { title: 'New verification rule' }

export default async function NewRulePage() {
  const ctx = await requireUser()
  if (!canManageRules(ctx)) return <PageHeader title="New rule" description="You do not have permission to create rules." />
  return (
    <>
      <PageHeader title="New verification rule" back={{ href: '/admin/verification-rules', label: 'Verification rules' }} />
      <Card><RuleForm id={null} options={await ruleOptions(ctx)} condOptions={await conditionOptions(ctx)} /></Card>
    </>
  )
}
