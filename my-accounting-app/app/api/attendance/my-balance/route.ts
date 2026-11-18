import { NextResponse } from 'next/server'
import { getAttendanceEmployee } from '@/lib/attendance-employee.server'
import { kstToday } from '@/lib/attendance'
import { computeBalance } from '@/lib/leave-balance'
import { loadBalanceData } from '@/lib/leave-balance.server'

export const dynamic = 'force-dynamic'

// 내 연차 잔여 (207) — 근태 · 휴가 신청 양식의 잔여 표시 · 초과 경고용. 전원(API_OWNERS: /api/attendance → my).
// 대상이 아니면(그해 부여 없음) managed=false — 화면은 잔여 줄을 숨긴다.
export async function GET() {
  const ctx = await getAttendanceEmployee()
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { employeeId, admin } = ctx
  const year = Number(kstToday().slice(0, 4))
  const d = await loadBalanceData(admin, year, [employeeId])
  if (!d.ready) return NextResponse.json({ ready: false, year })
  const managed = d.grants.some(g => g.status === 'active')
  const balance = computeBalance({ year, grants: d.grants, leaves: d.leaves, holidays: d.holidays })
  return NextResponse.json({ ready: true, year, managed, balance })
}
