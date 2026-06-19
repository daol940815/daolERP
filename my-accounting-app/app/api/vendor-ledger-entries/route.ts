import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const ENTRY_TYPES = ['opening', 'payment', 'adjustment']

// GET /api/vendor-ledger-entries?vendorId=
// 매입처 상세 페이지 "정산 원장" 타임라인 — 기초잔액/입금/조정 내역 (날짜 역순)
export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const vendorId = searchParams.get('vendorId')

  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })

  const { data, error } = await admin
    .from('vendor_ledger_entries')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}

// POST /api/vendor-ledger-entries
// body: { vendor_id, entry_type: 'opening'|'payment'|'adjustment', entry_date, amount, memo? }
// 잔액을 직접 수정하지 않고 항목만 추가한다 (append-only). 기초잔액(opening)도 동일하게 새 행을
// 추가하는 방식으로 "수정"하며, 이전 행은 그대로 남아 변경 이력(로그) 역할을 한다.
export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const body = await req.json() as {
    vendor_id?: string; entry_type?: string; entry_date?: string; amount?: number; memo?: string
    transaction_id?: string
  }

  if (!body.vendor_id)  return NextResponse.json({ error: 'vendor_id가 필요합니다.' }, { status: 400 })
  if (!body.entry_type || !ENTRY_TYPES.includes(body.entry_type)) {
    return NextResponse.json({ error: 'entry_type 값이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!body.entry_date) return NextResponse.json({ error: 'entry_date가 필요합니다.' }, { status: 400 })
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount === 0) {
    return NextResponse.json({ error: '금액은 0이 아닌 숫자여야 합니다.' }, { status: 400 })
  }
  if (body.entry_type !== 'adjustment' && body.amount < 0) {
    return NextResponse.json({ error: '기초잔액/입금 금액은 0보다 커야 합니다.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('vendor_ledger_entries')
    .insert({
      vendor_id:      body.vendor_id,
      entry_type:     body.entry_type,
      entry_date:     body.entry_date,
      amount:         body.amount,
      memo:           body.memo?.trim() || null,
      transaction_id: body.transaction_id ?? null,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
