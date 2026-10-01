import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import {
  validateOrderInput, buildOrderRows, insertOrderItems, ensureAlias, nextOrderNo,
  resolveDisplayNames, resolveVendorNames, loadOrderSnapshot, cancelOrder,
  canCancelReissue, inheritToReissued, writeEditLogs,
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

  // 취소·재등록 (홈택스 방식): reissue_of가 오면 저장 성공 시 원본을 취소 처리하고
  // 상호 링크·수금·발주 상태를 승계한다. 먼저 원본·511 적용 여부를 확인해
  // 새 주문만 생기고 원본이 살아남는 반쪽 상태를 막는다.
  const reissueOf = ((rawBody ?? {}) as Record<string, unknown>).reissue_of as string | undefined
  let reissueSnap: Awaited<ReturnType<typeof loadOrderSnapshot>> = null
  if (reissueOf) {
    reissueSnap = await loadOrderSnapshot(admin, reissueOf)
    if (!reissueSnap) return NextResponse.json({ error: '재등록할 원본 주문을 찾을 수 없습니다.' }, { status: 400 })
    if (reissueSnap.order.source !== 'direct') {
      return NextResponse.json({ error: '업로드 주문은 취소·재등록할 수 없습니다. (원본 보존)' }, { status: 403 })
    }
    if (reissueSnap.order.canceled_at) {
      return NextResponse.json({ error: '이미 취소된 주문입니다. 재등록 주문에서 진행해주세요.' }, { status: 400 })
    }
    if (!canCancelReissue(reissueSnap.order, me)) {
      return NextResponse.json({ error: '본인이 입력한 주문만 취소·재등록할 수 있습니다. (관리자 제외)' }, { status: 403 })
    }
    const probe = await admin.from('erp_orders').select('canceled_at').limit(1)
    if (probe.error) {
      return NextResponse.json({
        error: '511 마이그레이션(취소·재등록)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.',
      }, { status: 400 })
    }
  }

  // 상담일지 전환: consultation_id가 오면 소유 확인 후 주문에 연결
  const consultationId = (((rawBody ?? {}) as Record<string, unknown>).consultation_id as string | undefined)
    ?? (reissueSnap?.order.consultation_id as string | undefined)   // 재등록 시 상담 연결 승계
  if (consultationId && !reissueOf) {
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

  // 취소·재등록 마무리: 원본 취소 + 상호 링크 + 수금·발주 승계 + 변경 이력
  if (reissueOf && reissueSnap) {
    const editor = { employeeId: me.employeeId, employeeName: me.employeeName }
    const cancelErr = await cancelOrder(
      admin, reissueOf, editor, `재등록 → ${orderNo}`, orderId,
    )
    if (cancelErr) {
      // 원본 취소 실패 시 새 주문을 되돌려 이중 집계를 막는다
      await admin.from('erp_orders').delete().eq('id', orderId)
      return NextResponse.json({ error: cancelErr }, { status: 500 })
    }
    await inheritToReissued(admin, reissueSnap.order, reissueSnap.items, orderId, total)
    await writeEditLogs(admin, orderId, editor, [{
      field: '재등록',
      before: (reissueSnap.order.order_no as string) ?? null,
      after: orderNo,
    }])
  }

  // 상담일지 상태 갱신 — 주문 전환 완료 (재등록은 이미 전환 상태)
  if (consultationId && !reissueOf) {
    await admin.from('erp_consultations').update({ status: '주문전환' }).eq('id', consultationId)
  }

  // 업무일지 자동 기재 — 상담에서 전환된 주문은 '주문전환'으로 구분
  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    // erp_work_logs.action CHECK(700 트랙) 범위 내에서 기재 — 재등록은 내용으로 구분
    action: reissueOf ? '주문작성' : consultationId ? '주문전환' : '주문작성',
    content: orderContent({
      customer: [vendorNames.bankName, vendorNames.branchName].filter(Boolean).join(' '),
      orderNo, itemCount: itemRows.length, total,
    }, reissueOf
      ? `주문 취소·재등록 (원본 ${reissueSnap?.order.order_no ?? ''})`
      : consultationId ? '상담을 주문서로 전환' : '주문서 작성'),
    workDate: input.order_date,
    refType: 'order',
    refId: orderId,
  })

  return NextResponse.json({ id: orderId, order_no: orderNo, total_amount: total })
}
