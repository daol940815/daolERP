import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, buildOrderRows, insertOrderItems, ensureAlias, nextOrderNo,
  resolveDisplayNames, resolveVendorNames,
} from '@/lib/orders-portal'
import { recordWorkLog, orderContent } from '@/lib/work-log'

export const dynamic = 'force-dynamic'

// 직접 입력 주문 생성 (2단계)
// POST: OrderInput → source='direct' 주문 + 품목 저장, 주문번호 자동 발번
// 하류 호환: bank_name(주문처명)·manager_name(담당자 표기)·staff_name(입력자)·
//            channel(상담자) 텍스트를 마스터 FK와 병기한다.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const rawBody = await req.json().catch(() => null)
  const parsed = validateOrderInput(rawBody)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const input = parsed.input

  // 상담일지 전환: consultation_id가 오면 소유 확인 후 주문에 연결
  const consultationId = ((rawBody ?? {}) as Record<string, unknown>).consultation_id as string | undefined
  if (consultationId) {
    const { data: consult } = await admin.from('erp_consultations')
      .select('id, employee_id').eq('id', consultationId).maybeSingle()
    if (!consult) return NextResponse.json({ error: '연결할 상담일지를 찾을 수 없습니다.' }, { status: 400 })
    if (me.role === 'sales' && consult.employee_id !== me.employeeId) {
      return NextResponse.json({ error: '본인 상담일지만 주문으로 전환할 수 있습니다.' }, { status: 403 })
    }
  }

  const vendorNames = await resolveVendorNames(admin, input.vendor_id)
  if ('error' in vendorNames) return NextResponse.json({ error: vendorNames.error }, { status: 400 })

  const names = await resolveDisplayNames(admin, input)
  if (names.error) return NextResponse.json({ error: names.error }, { status: 400 })

  const aliasName = [vendorNames.bankName, vendorNames.branchName].filter(Boolean).join(' ')
  const aliasId = await ensureAlias(admin, 'customer', aliasName, input.vendor_id)
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
      bank_name: vendorNames.bankName,
      branch_name: vendorNames.branchName,
      customer_alias_id: aliasId,
      staff_name: me.employeeName,
      created_by_employee_id: me.employeeId,
      outstanding_amount: total,
      collect_status: 'outstanding',
      ...(consultationId ? { consultation_id: consultationId } : {}),
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

  // 상담일지 상태 갱신 — 주문 전환 완료
  if (consultationId) {
    await admin.from('erp_consultations').update({ status: '주문전환' }).eq('id', consultationId)
  }

  // 업무일지 자동 기재 — 상담에서 전환된 주문은 '주문전환'으로 구분
  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: consultationId ? '주문전환' : '주문작성',
    content: orderContent({
      customer: [vendorNames.bankName, vendorNames.branchName].filter(Boolean).join(' '),
      orderNo, itemCount: itemRows.length, total,
    }, consultationId ? '상담을 주문서로 전환' : '주문서 작성'),
    workDate: input.order_date,
    refType: 'order',
    refId: orderId,
  })

  return NextResponse.json({ id: orderId, order_no: orderNo, total_amount: total })
}
