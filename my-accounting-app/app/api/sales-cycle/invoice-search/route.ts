import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadBillingFamily } from '@/lib/billing'
import { searchSalesInvoices } from '@/lib/order-invoice-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/sales-cycle/invoice-search?vendorId=&amount=&from=&to=&q=
// 연결 창의 "다른 거래처 계산서에서 찾기" — 이 매출처 · 청구처가 아닌 거래처에 붙은 매출 계산서를 금액 · 발행일 · 상호로 찾는다.
// 찾기만 한다(저장 없음). 금액은 계산서의 남은 금액과 같은 것만, 비우면 금액 조건 없음(최근 것부터).
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const vendorId = sp.get('vendorId')
  if (!vendorId) return NextResponse.json({ error: 'vendorId가 필요합니다.' }, { status: 400 })
  const admin = createAdminClient()
  const fam = await loadBillingFamily(admin, vendorId)
  const amount = Math.round(Number(String(sp.get('amount') ?? '').replace(/,/g, '')))
  const q = sp.get('q')
  if (!(amount > 0) && !(q ?? '').trim()) return NextResponse.json({ error: '금액이나 상호 중 하나는 입력하세요.' }, { status: 400 })
  const r = await searchSalesInvoices(admin, {
    amounts: amount > 0 ? [amount] : [], from: sp.get('from'), to: sp.get('to'), q,
    excludeVendorIds: Array.from(new Set([vendorId, fam.root])), limit: 50,
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ invoices: r.data })
}
