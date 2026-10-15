import { NextRequest, NextResponse } from 'next/server'
import { can } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { kstToday, monthRange, type HolidayMap } from '@/lib/attendance'
import {
  expandRules, loanPayments, partTimePeriods,
  type LoanRow, type PartTimeRow, type RuleRow, type ScheduleEvent,
} from '@/lib/schedule'

export const dynamic = 'force-dynamic'

// 스케줄 (1단계) — GET ?month=YYYY-MM
// 기존 데이터에서 파생한다: 휴가(200) · 공휴일(201) · 아르바이트 근무기간(109) · 대출 상환일(402).
// ERP에 자리가 없는 일정(급여일·세무 마감·회사 행사·외근)은 관리 규칙(schedule_rules, 202)에서
// 읽어 그 달의 날짜로 펼친다 — 반복은 날짜를 저장하지 않는다.
// 접근은 미들웨어가 API_OWNERS의 hr 그룹으로 검사한다. 금액이 붙는 자금 항목(대출·세무)은
// 회계 조회 권한자에게만 내려보낸다 — 권한이 없으면 아예 응답에 담지 않는다.

const MIGRATION_HINT = '스케줄 마이그레이션(200·201·202)이 아직 적용되지 않았습니다.'
const missingTable = (msg: string) => /attendance_|schedule_rules|relation .* does not exist/i.test(msg)

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

  // 관리 규칙 — 회계 권한이 없으면 finance_only 건을 아예 읽지 않는다
  let ruleQuery = admin.from('schedule_rules')
    .select('id, title, category, repeat_kind, repeat_day, repeat_month, on_date, end_date, holiday_shift, amount, employee_id, finance_only, active, memo')
    .eq('active', true)
  if (!showMoney) ruleQuery = ruleQuery.eq('finance_only', false)
  const { data: rules, error: e4 } = await ruleQuery

  const err = e1 ?? e2 ?? e3 ?? e4 ?? (loansRes && 'error' in loansRes ? loansRes.error : null)
  if (err) {
    return NextResponse.json({ error: missingTable(err.message) ? MIGRATION_HINT : err.message }, { status: 500 })
  }

  const holidays: HolidayMap = {}
  for (const h of hols ?? []) holidays[h.holiday_date as string] = h.name as string

  const events: ScheduleEvent[] = []
  const nameById = new Map<string, string>()

  // 공휴일 — 배경으로 깔리지만 목록에도 넣어 "이번 달 쉬는 날"을 볼 수 있게 한다
  for (const [date, name] of Object.entries(holidays)) {
    events.push({ kind: 'holiday', date, title: name })
  }

  // 휴가 — 직원명을 따로 읽어 붙인다 (FK 임베드 대신)
  const leaveRows = leaves ?? []
  const ruleRows = (rules ?? []) as RuleRow[]
  const needNames = Array.from(new Set([
    ...leaveRows.map(l => l.employee_id as string),
    ...ruleRows.map(r => r.employee_id).filter(Boolean) as string[],
  ]))
  if (needNames.length) {
    const { data: emps } = await admin.from('employees').select('id, name').in('id', needNames)
    for (const e of emps ?? []) nameById.set(e.id as string, e.name as string)
  }

  if (leaveRows.length) {
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

  events.push(...expandRules(ruleRows, month, holidays, nameById))
  if (showMoney) {
    events.push(...loanPayments(((loansRes?.data ?? []) as LoanRow[]), month, holidays))
  }

  return NextResponse.json({
    month, today: kstToday(), holidays, events, showMoney,
    holidayYearCount: Object.keys(holidays).length,
  })
}
