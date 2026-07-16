import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { fetchAllRows } from '@/lib/fetch-all-rows'

export const dynamic = 'force-dynamic'

const VENDOR_FIELDS = 'id, name, biz_number, type, contact_name, contact_phone, email, note, match_aliases, card_numbers, ledger_balance, ledger_balance_updated_at, is_active, created_at, updated_at'

// GET /api/vendors?q=검색어&type=vendor|customer|both&all=true
// type은 콤마로 여러 값을 지정할 수 있다 (예: type=vendor,both → 매입처 + 매입·매출 겸용)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)

  const q     = searchParams.get('q')?.trim()
  const types = searchParams.get('type')?.split(',').map(t => t.trim()).filter(Boolean) ?? []
  const all   = searchParams.get('all') === 'true'

  // 거래처가 1,000곳을 넘으면 PostgREST 기본 한도에 잘려 드롭다운에서 조용히
  // 사라진다 — 페이지네이션으로 전체를 가져온다.
  const result = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let query = admin
      .from('vendors')
      .select(VENDOR_FIELDS)
      .order('name')

    if (!all)            query = query.eq('is_active', true)
    if (types.length === 1) query = query.eq('type', types[0])
    else if (types.length > 1) query = query.in('type', types)
    if (q)               query = query.or(`name.ilike.%${q}%,biz_number.ilike.%${q}%`)
    return query.range(from, to)
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ data: result.data })
}

// POST /api/vendors — 거래처 등록
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json() as {
    name: string; biz_number?: string; type?: string
    contact_name?: string; contact_phone?: string; email?: string; note?: string
    match_aliases?: string[]; card_numbers?: string[]
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '거래처명은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('vendors')
    .insert({
      name:          body.name.trim(),
      biz_number:    body.biz_number?.trim()   || null,
      type:          body.type ?? 'vendor',
      contact_name:  body.contact_name?.trim() || null,
      contact_phone: body.contact_phone?.trim()|| null,
      email:         body.email?.trim()        || null,
      note:          body.note?.trim()         || null,
      match_aliases: body.match_aliases ?? [],
      card_numbers:  body.card_numbers ?? [],
    })
    .select(VENDOR_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
