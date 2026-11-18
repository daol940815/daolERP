import type { LeaveBalance, LeaveGrant } from '@/lib/leave-balance'
import type { LeaveType } from '@/lib/attendance'

// 연차 관리 화면 공용 타입 — GET /api/attendance/balance 응답
export type BalanceRow = LeaveBalance & {
  employee_id: string; name: string; team: string | null; position: string | null; hire_date: string | null; has_login: boolean
}
export interface BalanceLeave { id: string; employee_id: string; leave_type: LeaveType; start_date: string; end_date: string; source: string; days: number }
export interface RecommendRow {
  employee_id: string; name: string; team: string | null; position: string | null; hire_date: string | null; has_login: boolean
  managed: boolean; base_days: number | null; years: number; rule: string
  carry_days: number; expire_days: number; prev_over: number; base_exists: boolean; carry_exists: boolean
}
export interface BalanceRes {
  ready: boolean
  error?: string
  year: number
  thisYear: number
  rows: BalanceRow[]
  grants: LeaveGrant[]
  leaves: BalanceLeave[]
  recommend?: RecommendRow[]
  employees: { id: string; name: string; team: string | null; position: string | null; has_login: boolean }[]
  can_edit: boolean
}

export async function fetchBalance(year: number, recommend = false): Promise<{ data: BalanceRes | null; error: string | null }> {
  const res = await fetch(`/api/attendance/balance?year=${year}${recommend ? '&recommend=1' : ''}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { data: null, error: json.error ?? '조회 실패' }
  if (json.ready === false) return { data: null, error: json.error ?? '207 마이그레이션이 필요합니다.' }
  return { data: json as BalanceRes, error: null }
}

export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
