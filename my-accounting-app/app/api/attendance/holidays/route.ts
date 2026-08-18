import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'

export const dynamic = 'force-dynamic'
export const maxDuration = 30   // 특일정보 API를 12개월치 호출하므로 여유를 둔다

// 공휴일·휴무일 관리
// GET ?year=YYYY — 해당 연도 목록 (로그인한 전 직원)
// POST body.action (전체 관리자 전용):
//   add    { date, name, source? }  — 같은 날짜가 있으면 이름·구분을 갱신
//   delete { date }
//   sync   { year }                 — 공공데이터포털 특일정보 API에서 그 해 법정공휴일을
//                                     받아 교체. 회사 지정 휴무(company)는 보존한다.

const MIGRATION_HINT = '201 마이그레이션(공휴일)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const missingTable = (msg: string) => /attendance_holidays|relation .* does not exist/i.test(msg)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 한국천문연구원 특일 정보 — 국경일·공휴일 (공공데이터포털)
const API_BASE = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'
const KEY_HINT =
  '공휴일 API 키(DATA_GO_KR_SERVICE_KEY)가 설정되지 않았습니다. ' +
  '공공데이터포털에서 발급받은 일반 인증키(Decoding)를 Vercel 환경변수에 등록해주세요.'

interface HolidayItem { holiday_date: string; name: string; source: 'public' }

// 특일정보 API는 월 단위 조회다. 12개월을 병렬로 읽어 합친다.
async function fetchYearHolidays(year: string, rawKey: string): Promise<HolidayItem[]> {
  // 포털은 Encoding/Decoding 두 형태의 키를 준다. 이미 인코딩된 키(% 포함)는 그대로 쓰고,
  // 원본 키는 인코딩한다 — 이중 인코딩되면 인증에 실패한다.
  const key = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey)

  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
  const perMonth = await Promise.all(months.map(async month => {
    const url = `${API_BASE}?serviceKey=${key}&solYear=${year}&solMonth=${month}&numOfRows=100&_type=json`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) })
    const text = await res.text()
    if (!res.ok) throw new Error(`공휴일 API 응답 오류 (HTTP ${res.status})`)

    let json: Record<string, unknown>
    try {
      json = JSON.parse(text)
    } catch {
      // 인증 실패 등은 JSON을 요청해도 XML로 돌아온다
      const msg = /<returnAuthMsg>([^<]*)</.exec(text)?.[1]
        ?? /<errMsg>([^<]*)</.exec(text)?.[1]
        ?? text.replace(/\s+/g, ' ').slice(0, 120)
      throw new Error(`공휴일 API 오류: ${msg}`)
    }

    const response = (json as { response?: Record<string, never> }).response as
      { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown } } | undefined
    const header = response?.header
    if (header?.resultCode && header.resultCode !== '00') {
      throw new Error(`공휴일 API 오류: ${header.resultMsg ?? header.resultCode}`)
    }

    const items = (response?.body?.items as { item?: unknown } | '' | undefined)
    const item = items && typeof items === 'object' ? items.item : undefined
    if (!item) return []                                  // 공휴일 없는 달은 빈 문자열로 온다
    return (Array.isArray(item) ? item : [item]) as Record<string, unknown>[]
  }))

  const byDate = new Map<string, HolidayItem>()
  for (const raw of perMonth.flat()) {
    if (String(raw.isHoliday ?? 'Y') !== 'Y') continue
    const d = String(raw.locdate ?? '')
    if (!/^\d{8}$/.test(d)) continue
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
    const name = String(raw.dateName ?? '').trim() || '공휴일'
    // 같은 날 항목이 여러 건이면 첫 이름을 쓴다
    if (!byDate.has(date)) byDate.set(date, { holiday_date: date, name, source: 'public' })
  }
  return Array.from(byDate.values()).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
}

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
  return NextResponse.json({
    year, holidays: data ?? [], canSync: !!process.env.DATA_GO_KR_SERVICE_KEY,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role !== 'admin') return NextResponse.json({ error: '전체 관리자만 가능합니다.' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, string | undefined>

  if (body.action === 'sync') {
    const year = (body.year ?? '').trim()
    if (!/^\d{4}$/.test(year)) return NextResponse.json({ error: 'year 형식은 YYYY' }, { status: 400 })
    const rawKey = process.env.DATA_GO_KR_SERVICE_KEY
    if (!rawKey) return NextResponse.json({ error: KEY_HINT }, { status: 400 })

    let rows: HolidayItem[]
    try {
      rows = await fetchYearHolidays(year, rawKey)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '공휴일 API 호출에 실패했습니다.'
      return NextResponse.json({ error: /timed out|abort/i.test(msg) ? '공휴일 API 응답이 지연됩니다. 잠시 후 다시 시도해주세요.' : msg }, { status: 502 })
    }
    // 0건이면 교체하지 않는다 — API 일시 오류로 기존 공휴일이 지워지는 것을 막는다
    if (!rows.length) {
      return NextResponse.json({ error: `${year}년 공휴일을 가져오지 못했습니다. 기존 데이터는 그대로 두었습니다.` }, { status: 502 })
    }

    // 법정공휴일만 교체 (회사 지정 휴무는 보존)
    const { error: dErr } = await admin.from('attendance_holidays').delete()
      .eq('source', 'public')
      .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    if (dErr) {
      return NextResponse.json({ error: missingTable(dErr.message) ? MIGRATION_HINT : dErr.message }, { status: 500 })
    }
    const { error } = await admin.from('attendance_holidays')
      .upsert(rows, { onConflict: 'holiday_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, year, count: rows.length })
  }

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
