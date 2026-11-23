import { NextResponse } from 'next/server'
import { can, isManagerLike } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, kstMonthNow, leaveDays, DEDUCT_LEAVE_TYPES, type AttendanceLeave } from '@/lib/attendance'
import { loadMyOrderStats } from '@/lib/my-dashboard'
import { computeBalance } from '@/lib/leave-balance'
import { loadBalanceData } from '@/lib/leave-balance.server'

export const dynamic = 'force-dynamic'

// 내 대시보드 요약 — 개인화면(마이페이지) 홈에서 1회 호출로 필요한 것을 모두 받는다.
//  - KPI 집계: my_dashboard_summary RPC (300 마이그레이션, JSONB 단일 응답) — 담당 거래처 · 영업일지 수만 사용
//  - 주문 카드: loadMyOrderStats (내 작성 주문 · 내 담당 지점 주문, 표준 미수 — 2026-11-19)
//  - 최근 목록·오늘 근태: 소량 조회라 PostgREST 직접 (병렬)
// 300·200 미적용 환경에서도 화면이 죽지 않도록 각 블록은 개별 폴백한다.

const MIGRATION_300_HINT = '300 마이그레이션(내 대시보드)이 아직 적용되지 않았습니다. SQL 편집기에서 300_my_dashboard.sql을 실행해주세요.'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const month = kstMonthNow()
  const today = kstToday()

  const [summaryRes, orderStats, balData, recentJournalRes, attRes, leaveRes, pendingRes] = await Promise.all([
    // KPI 집계 (300 RPC)
    admin.rpc('my_dashboard_summary', {
      p_employee_id: me.employeeId,
      p_staff_name: me.employeeName,
      p_month: month,
    }),
    // 주문 카드 — 내 작성 주문 · 내 담당 지점 주문 (2026-11-19, lib/my-dashboard.ts)
    loadMyOrderStats(admin, me, month),
    // 올해 연차 잔여 (207) — 연차 관리와 같은 계산(lib/leave-balance.ts). 미적용이면 ready=false
    me.employeeId ? loadBalanceData(admin, Number(today.slice(0, 4)), [me.employeeId]) : Promise.resolve(null),
    // 최근 내 영업일지 5건
    me.employeeId
      ? admin
          .from('contact_activities')
          .select('id, activity_date, activity_type, content, next_action, contacts(name), vendors(name)')
          .eq('employee_id', me.employeeId)
          .order('activity_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    // 오늘 출퇴근 (200 미적용이면 null 폴백)
    me.employeeId
      ? admin
          .from('attendance_records')
          .select('check_in_at, check_out_at')
          .eq('employee_id', me.employeeId)
          .eq('work_date', today)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // 최근 휴가 신청 3건 (200 미적용이면 빈 배열 폴백)
    me.employeeId
      ? admin
          .from('attendance_leaves')
          .select('id, leave_type, start_date, end_date, status, created_at')
          .eq('employee_id', me.employeeId)
          .order('created_at', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    // 승인 대기 휴가 전부 (2026-11-19 사용자 요청) — 결재 중인 신청은 아직 연차에서 빠지지 않으므로 따로 보여준다
    me.employeeId
      ? admin
          .from('attendance_leaves')
          .select('id, employee_id, leave_type, start_date, end_date, status, created_at')
          .eq('employee_id', me.employeeId)
          .eq('status', 'requested')
          .order('start_date')
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ])

  type JournalRow = {
    id: string
    activity_date: string
    activity_type: string
    content: string
    next_action: string | null
    contacts: { name: string } | { name: string }[] | null
    vendors: { name: string } | { name: string }[] | null
  }
  const one = (v: { name: string } | { name: string }[] | null) =>
    (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

  // 승인 대기 휴가 일수 계산용 — 공휴일은 연차 잔여 조회에서 읽은 올해 것(207 미적용이면 주말만 제외)
  const year = Number(today.slice(0, 4))
  const holidays = balData?.ready ? balData.holidays : {}
  const pendingRows = (pendingRes.error ? [] : pendingRes.data ?? []) as unknown as AttendanceLeave[]

  return NextResponse.json({
    // canCustomers: 담당 거래처 카드의 드릴다운 목적지 결정용 (내 고객 목록 vs 내 정보 요약)
    me: { name: me.employeeName, canPayments: can(me, 'collections') || can(me, 'accounting'), role: isManagerLike(me) ? (me.role === 'sales' ? 'manager' : me.role) : 'sales', linked: !!me.employeeId, canCustomers: can(me, 'customers') },
    month,
    today,
    summary: summaryRes.error ? null : summaryRes.data,
    summaryError: summaryRes.error ? MIGRATION_300_HINT : null,
    orders: 'error' in orderStats ? null : orderStats,
    ordersError: 'error' in orderStats ? orderStats.error : null,
    recentOrders: 'error' in orderStats ? [] : orderStats.recent_written,
    recentJournal: ((recentJournalRes.data ?? []) as JournalRow[]).map(a => ({
      id: a.id,
      activity_date: a.activity_date,
      activity_type: a.activity_type,
      content: a.content,
      next_action: a.next_action,
      contact_name: one(a.contacts),
      vendor_name: one(a.vendors),
    })),
    attendance: attRes.error ? null : attRes.data ?? null,
    attendanceReady: !attRes.error,
    leaves: leaveRes.error ? [] : leaveRes.data ?? [],
    // 승인 대기 휴가 — days = 근무일 수, deduct = 올해 연차에서 빠질 일수(차감 종류만, 올해 안 부분)
    pendingLeaves: pendingRows.map(l => ({
      id: l.id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date,
      days: leaveDays(l, undefined, undefined, holidays),
      deduct: DEDUCT_LEAVE_TYPES.includes(l.leave_type) ? leaveDays(l, `${year}-01-01`, `${year}-12-31`, holidays) : 0,
    })),
    // 올해 연차 — 그해 유효 부여가 있는 직원만(연차 대상). 없으면 null = 카드 숨김 (2026-11-19)
    leaveBalance: balData?.ready && balData.grants.some(g => g.status === 'active')
      ? { year: Number(today.slice(0, 4)), ...computeBalance({ year: Number(today.slice(0, 4)), grants: balData.grants, leaves: balData.leaves, holidays: balData.holidays }) }
      : null,
  })
}
