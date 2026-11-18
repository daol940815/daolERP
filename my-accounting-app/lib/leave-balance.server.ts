import type { SupabaseClient } from '@supabase/supabase-js'
import { DEDUCT_LEAVE_TYPES, type AttendanceLeave, type HolidayMap } from '@/lib/attendance'
import { computeBalance, type LeaveBalance, type LeaveGrant } from '@/lib/leave-balance'
import { fetchAllRows } from '@/lib/fetch-all-rows'

// 연차 잔여 계산용 서버 조회 (207). 규칙은 lib/leave-balance.ts.
// 207 미적용이면 ready=false — 화면은 "207 실행 필요" 안내를 띄운다.

type PgRes<T> = { data: T[] | null; error: { message: string } | null }

export interface BalanceData {
  ready: boolean
  grants: LeaveGrant[]                 // 그해 부여 (취소 포함)
  leaves: AttendanceLeave[]            // 그해와 겹치는 승인된 차감 휴가
  holidays: HolidayMap
}

const GRANT_COLS = 'id, employee_id, year, kind, days, grant_date, reason, source, status, created_at, cancel_note, created_by, canceled_by'

/** 그해 부여 · 차감 휴가 · 공휴일. employeeIds 를 주면 그 직원들만 */
export async function loadBalanceData(admin: SupabaseClient, year: number, employeeIds?: string[]): Promise<BalanceData> {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const ids = employeeIds ? Array.from(new Set(employeeIds)) : null
  const chunks = ids ? Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150)) : [null]

  const grants: LeaveGrant[] = []
  const leaves: AttendanceLeave[] = []
  for (const chunk of chunks) {
    if (chunk && !chunk.length) continue
    const [g, l] = await Promise.all([
      fetchAllRows<LeaveGrant>((a, b) => {
        let q = admin.from('attendance_leave_grants').select(GRANT_COLS).eq('year', year).order('grant_date').range(a, b)
        if (chunk) q = q.in('employee_id', chunk)
        return q as unknown as PromiseLike<PgRes<LeaveGrant>>
      }),
      fetchAllRows<AttendanceLeave>((a, b) => {
        let q = admin.from('attendance_leaves')
          .select('id, employee_id, leave_type, start_date, end_date, reason, status, decided_by, decide_note, created_at, source')
          .eq('status', 'approved').in('leave_type', DEDUCT_LEAVE_TYPES)
          .lte('start_date', to).gte('end_date', from).range(a, b)
        if (chunk) q = q.in('employee_id', chunk)
        return q as unknown as PromiseLike<PgRes<AttendanceLeave>>
      }),
    ])
    if ('error' in g || 'error' in l) return { ready: false, grants: [], leaves: [], holidays: {} }
    grants.push(...g.data.map(x => ({ ...x, days: Number(x.days) })))
    leaves.push(...l.data)
  }
  const holidays: HolidayMap = {}
  const { data: hols } = await admin.from('attendance_holidays').select('holiday_date, name').gte('holiday_date', from).lte('holiday_date', to)
  for (const h of hols ?? []) holidays[h.holiday_date as string] = h.name as string
  return { ready: true, grants, leaves, holidays }
}

/** 직원별 잔여 맵 */
export function balancesByEmployee(d: BalanceData, year: number, employeeIds: string[]): Map<string, LeaveBalance> {
  const out = new Map<string, LeaveBalance>()
  for (const id of employeeIds) {
    out.set(id, computeBalance({
      year,
      grants: d.grants.filter(g => g.employee_id === id),
      leaves: d.leaves.filter(l => l.employee_id === id),
      holidays: d.holidays,
    }))
  }
  return out
}
