import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/user-role'
import TeamWorklogClient from './team-client'

export const dynamic = 'force-dynamic'

// 팀 업무 현황 — manager/admin 전용. 직원(sales)은 접근 자체를 막는다 (사용자 확정).
export default async function TeamWorklogPage() {
  const me = await getCurrentUser()
  if (!me) redirect('/login')
  if (me.role === 'sales') redirect('/me/worklog')
  return <TeamWorklogClient />
}
