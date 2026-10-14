import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, monthRange, type HolidayMap } from '@/lib/attendance'
import {
  loanPayments, partTimePeriods, taxDeadlines,
  type LoanRow, type PartTimeRow, type ScheduleEvent,
} from '@/lib/schedule'

export const dynamic = 'force-dynamic'

// 스케줄 (1단계) — GET ?month=YYYY-MM
// 저장 없이 기존 데이터에서 파생한다: 휴가(200) · 공휴일(201) · 아르바이트 근무기간(109) ·
// 대출 상환일(402) · 세무 반복 마감(코드 상수).
// 접근은 미들웨어가 API_OWNERS의 hr 그룹으로 검사한다. 금액이 붙는 자금 항목(대출·세무)은
// 회계 조회 권한자에게만 내려보낸다 — 권한이 없으면 아예 응답에 담지 않는다.

const MIGRATION_HINT = '근태 마이그레이션(200·201)이 아직 적용되지 않았습니다.'
const missingTable = (msg: string) => /attendance_|relation .* does not exist/i.test(msg)

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month') ?? kstToday().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month 형식은 YYYY-MM' }, { status: 400 })

  const admin = createAdminClient()
  const [mStart, mEnd] = monthRange(month)
  const showMoney = can(me, 'accounting', 'view')

  const [
    { data: hols, error: e1 },
    { data: leaves, error: e2 },
    { data: parttimers, error: e3 },
    loansRes,
  ] = await Promise.all([
    admin.from('attendance_holidays').select('holiday_date, name')
      .gte('holiday_date', mStart).lte('holiday_date', mEnd),
    admin.from('attendance_leaves')
      .select('id, employee_id, leave_type, start_date, end_date, status')
      .in('status', ['approved', 'requested'])
      .lte('start_date', mEnd).gte('end_date', mStart),
    admin.from('employees')
      .select('id, name, work_start, work_end')
      .eq('employment_type', 'parttime').eq('is_active', true),
    showMoney
      ? admin.from('loans')
          .select('id, bank_name, title, monthly_principal, monthly_interest, payment_day, status, maturity_date')
      : Promise.resolve({ data: null, error: null }),
  ])

  const err = e1 ?? e2 ?? e3 ?? (loansRes && 'error' in loansRes ? loansRes.error : null)
  if (err) {
    return NextResponse.json({ error: missingTable(err.message) ? MIGRATION_HINT : err.message }, { status: 500 })
  }

  const holidays: HolidayMap = {}
  for (const h of hols ?? []) holidays[h.holiday_date as string] = h.name as string

  const events: ScheduleEvent[] = []

  // 공휴일 — 배경으로 깔리지만 목록에도 넣어 "이번 달 쉬는 날"을 볼 수 있게 한다
  for (const [date, name] of Object.entries(holidays)) {
    events.push({ kind: 'holiday', date, title: name })
  }

  // 휴가 — 직원명을 따로 읽어 붙인다 (FK 임베드 대신)
  const leaveRows = leaves ?? []
  if (leaveRows.length) {
    const ids = Array.from(new Set(leaveRows.map(l => l.employee_id as string)))
    const { data: emps } = await admin.from('employees').select('id, name').in('id', ids)
    const nameById = new Map((emps ?? []).map(e => [e.id as string, e.name as string]))
    const LABEL: Record<string, string> = {
      annual: '연차', half_am: '오전 반차', half_pm: '오후 반차',
      sick: '병가', official: '공가', other: '휴가',
    }
    for (const l of leaveRows) {
      events.push({
        kind: l.status === 'approved' ? 'leave' : 'leave_pending',
        date: l.start_date as string,
        endDate: l.end_date as string,
        // 사유는 싣지 않는다 — 병가·경조사가 캘린더에 드러나지 않도록 종류만 표시
        title: LABEL[l.leave_type as string] ?? '휴가',
        who: nameById.get(l.employee_id as string) ?? null,
      })
    }
  }

  events.push(...partTimePeriods((parttimers ?? []) as PartTimeRow[], month))

  if (showMoney) {
    events.push(...loanPayments(((loansRes?.data ?? []) as LoanRow[]), month, holidays))
    events.push(...taxDeadlines(month, holidays))
  }

  return NextResponse.json({
    month, today: kstToday(), holidays, events, showMoney,
    holidayYearCount: Object.keys(holidays).length,
  })
}
