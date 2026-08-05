import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, kstMonthNow } from '@/lib/attendance'

export const dynamic = 'force-dynamic'

// 내 대시보드 요약 — 개인화면(마이페이지) 홈에서 1회 호출로 필요한 것을 모두 받는다.
//  - KPI 집계: my_dashboard_summary RPC (300 마이그레이션, JSONB 단일 응답)
//  - 최근 목록·오늘 근태: 소량 조회라 PostgREST 직접 (병렬)
// 300·200 미적용 환경에서도 화면이 죽지 않도록 각 블록은 개별 폴백한다.

const MIGRATION_300_HINT = '300 마이그레이션(내 대시보드)이 아직 적용되지 않았습니다. SQL 편집기에서 300_my_dashboard.sql을 실행해주세요.'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const month = kstMonthNow()
  const today = kstToday()

  const [summaryRes, recentOrdersRes, recentJournalRes, attRes, leaveRes] = await Promise.all([
    // KPI 집계 (300 RPC)
    admin.rpc('my_dashboard_summary', {
      p_employee_id: me.employeeId,
      p_staff_name: me.employeeName,
      p_month: month,
    }),
    // 최근 내 입력 주문 5건 (이름 대조)
    me.employeeName
      ? admin
          .from('erp_orders')
          .select('id, order_no, order_date, bank_name, branch_name, total_amount, outstanding_amount')
          .eq('staff_name', me.employeeName)
          .order('order_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
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

  return NextResponse.json({
    me: { name: me.employeeName, role: me.role, linked: !!me.employeeId },
    month,
    today,
    summary: summaryRes.error ? null : summaryRes.data,
    summaryError: summaryRes.error ? MIGRATION_300_HINT : null,
    recentOrders: (recentOrdersRes.data ?? []).map(o => ({
      id: o.id,
      order_no: o.order_no,
      order_date: o.order_date,
      customer: [o.bank_name, o.branch_name].filter(Boolean).join(' ') || '(주문처 미상)',
      total_amount: o.total_amount ?? 0,
      outstanding_amount: o.outstanding_amount ?? 0,
    })),
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
  })
}
