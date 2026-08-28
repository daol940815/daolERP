import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPurchaseHubList } from '@/lib/purchase-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/purchase-hub?from=YYYY-MM-DD&to=YYYY-MM-DD
// 매입처 허브 목록 — 기간 매입·지급·미지급 잔액·담당·상태
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildPurchaseHubList(admin, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

// POST /api/purchase-hub — 신규 매입처 등록
// body: { name, biz_number?, email?, purchase_kind?, note?, force? }
// vendors는 매출처와 공유하는 마스터라 중복 등록이 곧 집계 분산으로 이어진다
// (롯데쇼핑이 5개로 쪼개진 사례). 유사 이름이 있으면 먼저 확인을 받는다 — 확정은 사용자.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    name?: string; biz_number?: string; email?: string
    purchase_kind?: string; note?: string; force?: boolean
  }

  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: '거래처명을 입력해주세요.' }, { status: 400 })

  const kind = body.purchase_kind ?? 'partner'
  if (!['partner', 'retail', 'expense'].includes(kind)) {
    return NextResponse.json({ error: '매입처 구분이 올바르지 않습니다.' }, { status: 400 })
  }
  const email = (body.email ?? '').trim() || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const bizDigits = (body.biz_number ?? '').replace(/\D/g, '')
  if (bizDigits && bizDigits.length !== 10) {
    return NextResponse.json({ error: '사업자번호는 숫자 10자리여야 합니다.' }, { status: 400 })
  }

  // 사업자번호가 같으면 같은 거래처다 — 확인 없이 막는다
  if (bizDigits) {
    const { data: dup } = await admin.from('vendors')
      .select('id, name').eq('biz_number', bizDigits).maybeSingle()
    if (dup) {
      return NextResponse.json(
        { error: `사업자번호가 같은 거래처가 이미 있습니다: ${dup.name}`, existing_id: dup.id },
        { status: 400 })
    }
  }

  // 유사 이름 후보 (공백·법인격 표기 차이 무시) — force가 아니면 확인 요청
  if (!body.force) {
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/[㈜()주식회사]/g, '').toLowerCase()
    const key = norm(name)
    const core = key.length >= 2 ? key.slice(0, 2) : key
    const { data: near } = await admin.from('vendors')
      .select('id, name, biz_number, type').ilike('name', `%${core}%`).limit(50)
    const candidates = (near ?? []).filter(v => {
      const n = norm(v.name as string)
      return n === key || n.includes(key) || key.includes(n)
    }).slice(0, 5)
    if (candidates.length) {
      return NextResponse.json({ needs_confirm: true, candidates })
    }
  }

  const { data: created, error } = await admin.from('vendors')
    .insert({
      name,
      biz_number: bizDigits || null,
      email,
      type: 'vendor',
      purchase_kind: kind,
      note: (body.note ?? '').trim() || null,
    })
    .select('id, name').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 미결제금 기초원장 0원 행을 함께 만든다 — 신규 매입처는 과거 미결제가 없고,
  // 허브 목록은 계산서·지급·발주·기초원장 중 하나라도 있어야 잡히므로
  // 이 행이 없으면 등록 직후 목록에서 보이지 않는다 (일괄 적재와 같은 기준일).
  await admin.from('purchase_opening_balances').insert({
    vendor_id: created.id,
    as_of_date: '2026-06-30',
    amount: 0,
    note: '신규 매입처 등록 — 기초 미결제 없음',
  })

  return NextResponse.json({ ok: true, vendor: created })
}
