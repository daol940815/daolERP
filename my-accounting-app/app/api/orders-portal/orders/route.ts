import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, buildOrderRows, insertOrderItems, ensureAlias, nextOrderNo,
  resolveDisplayNames,
} from '@/lib/orders-portal'

export const dynamic = 'force-dynamic'

// 직접 입력 주문 생성 (2단계)
// POST: OrderInput → source='direct' 주문 + 품목 저장, 주문번호 자동 발번
// 하류 호환: bank_name(주문처명)·manager_name(담당자 표기)·staff_name(입력자)·
//            channel(상담자) 텍스트를 마스터 FK와 병기한다.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const parsed = validateOrderInput(await req.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const input = parsed.input

  const { data: vendor } = await admin.from('vendors').select('id, name').eq('id', input.vendor_id).maybeSingle()
  if (!vendor) return NextResponse.json({ error: '주문처 거래처를 찾을 수 없습니다.' }, { status: 400 })

  const names = await resolveDisplayNames(admin, input)
  if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })

  const aliasId = await ensureAlias(admin, 'customer', vendor.name as string, vendor.id as string)
  const { orderFields, itemRows, total } = buildOrderRows(input, {
    managerName: names.managerName,
    counselorName: names.counselorName,
  })

  // 주문번호 발번 — 동시 입력 충돌 시 재시도
  let orderId: string | null = null
  let orderNo = ''
  for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
    orderNo = await nextOrderNo(admin, input.order_date)
    const { data, error } = await admin.from('erp_orders').insert({
      ...orderFields,
      order_no: orderNo,
      source: 'direct',
      bank_name: vendor.name,
      branch_name: null,
      customer_alias_id: aliasId,
      staff_name: me.employeeName,
      created_by_employee_id: me.employeeId,
      outstanding_amount: total,
      collect_status: 'outstanding',
    }).select('id').single()
    if (!error) { orderId = data.id as string; break }
    if (!/duplicate|unique/i.test(error.message)) {
      const missing = /column|vendor_id|contact_id|counselor|created_by/i.test(error.message)
      return NextResponse.json({
        error: missing
          ? '500 마이그레이션(주문시스템 2단계)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
          : `주문 저장 실패: ${error.message}`,
      }, { status: 500 })
    }
  }
  if (!orderId) return NextResponse.json({ error: '주문번호 발번에 실패했습니다. 다시 시도해주세요.' }, { status: 500 })

  const itemErr = await insertOrderItems(admin, orderId, itemRows)
  if (itemErr) {
    await admin.from('erp_orders').delete().eq('id', orderId)   // 반쪽 저장 방지
    return NextResponse.json({ error: `품목 저장 실패: ${itemErr}` }, { status: 500 })
  }

  return NextResponse.json({ id: orderId, order_no: orderNo, total_amount: total })
}
