import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadOrderSnapshot } from '@/lib/orders-portal'
import {
  buildStatementExcel, statementFileName, type StatementData, type StatementItem,
} from '@/lib/trade-statement'

export const dynamic = 'force-dynamic'

// 거래명세서 엑셀 다운로드 — 주문 1건의 판매 내역을 실무자 양식으로 출력.
// 단가는 할인 반영가, 배송비는 '택배비' 품목 행으로 분리 (발주서와 동일 방식).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const snap = await loadOrderSnapshot(admin, params.id)
  if (!snap) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  const active = snap.items.filter(it => !it.is_canceled)
  if (active.length === 0) {
    return NextResponse.json({ error: '출력할 품목이 없습니다.' }, { status: 400 })
  }

  // 상품 행: 판매금액 = 품목 합계 - 배송비 (할인 반영). 단가 = 금액 ÷ 수량 —
  // 할인로 나누어떨어지지 않으면 소수 단가를 그대로 두어 단가×수량 수식이 성립한다.
  const items: StatementItem[] = active.map(it => {
    const qty = Number(it.quantity ?? 0)
    const amount = Number(it.line_total ?? 0) - Number(it.shipping_fee ?? 0)
    return {
      item_name: String(it.item_name ?? ''),
      quantity: qty,
      unit_price: qty > 0 ? amount / qty : amount,
      amount,
      memo: (it.memo as string | null) ?? null,
    }
  })
  const shipping = active.reduce((s, it) => s + Number(it.shipping_fee ?? 0), 0)
  if (shipping > 0) {
    items.push({ item_name: '택배비', quantity: 1, unit_price: shipping, amount: shipping, memo: null })
  }

  const data: StatementData = {
    order_date: (snap.order.order_date as string | null) ?? null,
    bank_name: (snap.order.bank_name as string | null) ?? null,
    branch_name: (snap.order.branch_name as string | null) ?? null,
    manager_name: (snap.order.manager_name as string | null) ?? null,
    phone: (snap.order.phone as string | null) || (snap.order.contact as string | null) || null,
    total_amount: items.reduce((s, it) => s + it.amount, 0),
    items,
  }

  const buf = await buildStatementExcel(data)
  const filename = encodeURIComponent(statementFileName(data))
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
