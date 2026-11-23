import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { saveStocktake } from '@/lib/stock-review'

export const dynamic = 'force-dynamic'

// POST /api/stock/stocktakes { product_id, take_date, counted_qty, note? } — 선매입 재고 실사 입력 (1400 표)
// 그날 말 전산 재고 사본을 함께 남기고, 차이는 확인 필요 탭에서 조정 행으로 해소한다(실사 기록은 고치지 않음).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const productId = String(b.product_id ?? '')
  const takeDate = String(b.take_date ?? '')
  const counted = Number(b.counted_qty)
  if (!productId) return NextResponse.json({ error: '품목을 골라 주세요.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takeDate)) return NextResponse.json({ error: '실사 날짜가 올바르지 않습니다.' }, { status: 400 })
  if (!Number.isInteger(counted) || counted < 0) return NextResponse.json({ error: '실사 수량은 0 이상의 정수로 적어 주세요.' }, { status: 400 })
  const r = await saveStocktake(createAdminClient(), {
    product_id: productId, take_date: takeDate, counted_qty: counted, note: String(b.note ?? '').trim() || null,
  }, { employeeId: me.employeeId, employeeName: me.employeeName })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 })
  return NextResponse.json({ ok: true, ...r })
}
