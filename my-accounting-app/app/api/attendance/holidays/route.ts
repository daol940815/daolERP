import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'

// 공휴일·휴무일 관리
// GET ?year=YYYY — 해당 연도 목록 (로그인한 전 직원)
// POST body.action (전체 관리자 전용):
//   add    { date, name, source? }  — 같은 날짜가 있으면 이름·구분을 갱신
//   delete { date }

const MIGRATION_HINT = '201 마이그레이션(공휴일)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /attendance_holidays|relation .* does not exist/i.test(msg)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const year = req.nextUrl.searchParams.get('year') ?? String(new Date().getUTCFullYear())
  if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: 'year 형식은 YYYY' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('attendance_holidays')
    .select('holiday_date, name, source')
    .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    .order('holiday_date')
  if (error) {
    return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
  }
  return NextResponse.json({ year, holidays: data ?? [] })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role !== 'admin') return NextResponse.json({ error: '전체 관리자만 가능합니다.' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>
  const date = (body.date ?? '').trim()
  if (!DATE_RE.test(date)) return NextResponse.json({ error: '날짜 형식은 YYYY-MM-DD' }, { status: 400 })

  if (body.action === 'add') {
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: '휴일명을 입력하세요.' }, { status: 400 })
    const source = body.source === 'public' ? 'public' : 'company'
    const { error } = await admin.from('attendance_holidays')
      .upsert({ holiday_date: date, name, source }, { onConflict: 'holiday_date' })
    if (error) {
      return NextResponse.json({ error: missingTable(error.message) ? MIGRATION_HINT : error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    const { error } = await admin.from('attendance_holidays').delete().eq('holiday_date', date)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}
