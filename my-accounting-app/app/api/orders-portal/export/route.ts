import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { filterFromSearchParams, loadFilteredOrders } from '@/lib/orders-portal-list'
import { xlsxResponse } from '@/lib/xlsx-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 주문 현황 엑셀 내보내기 — 목록과 동일 필터(lib/orders-portal-list.ts 공용).
// 품목 행 단위로 전개: 주문 정보가 각 품목 행에 반복되는 기존 ERP 다운로드 형식.
// 원가 노출 정책: 매입가·매입배송비·매입합계·마진 컬럼 전 직원 공개 (2026-08-13 사용자 결정).
//
// GET ?q=&from=&to=&collect=&source=&prepay=1&invoice=1&mine=1

const STATUS_LABEL: Record<string, string> = {
  collected: '수금완료',
  outstanding: '미수금',
  in_progress: '수금진행중',
}

interface ItemRow {
  order_id: string
  line_no: number
  parent_line_no: number | null
  is_canceled: boolean
  is_prepayment: boolean
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  purchase_vendor_name: string | null
  sale_price: number | null
  quantity: number | null
  shipping_fee: number | null
  discount_amount: number | null
  line_total: number | null
  purchase_price: number | null
  purchase_shipping: number | null
  purchase_total: number | null
  channel: string | null
  memo: string | null
}

const CHUNK = 150

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams

  const result = await loadFilteredOrders(admin, me, filterFromSearchParams(sp))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  const { filtered } = result
  if (!filtered.length) {
    return NextResponse.json({ error: '조건에 맞는 주문이 없습니다.' }, { status: 404 })
  }

  // 품목 로드 (주문 id 청크 — .in() URL 길이 제한 회피)
  const orderIds = filtered.map(o => o.id)
  const itemsByOrder = new Map<string, ItemRow[]>()
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK)
    const r = await fetchAllRows<ItemRow>((pf, pt) =>
      admin.from('erp_order_items')
        .select('order_id, line_no, parent_line_no, is_canceled, is_prepayment, item_code, item_name, order_kind, purchase_vendor_name, sale_price, quantity, shipping_fee, discount_amount, line_total, purchase_price, purchase_shipping, purchase_total, channel, memo')
        .in('order_id', chunk).order('order_id').order('line_no').range(pf, pt),
    )
    if ('error' in r) return NextResponse.json({ error: `품목 조회 실패: ${r.error}` }, { status: 500 })
    for (const it of r.data) {
      const list = itemsByOrder.get(it.order_id) ?? []
      list.push(it)
      itemsByOrder.set(it.order_id, list)
    }
  }

  const showCost = true   // 매입가·마진 전 직원 공개 (2026-08-13 사용자 결정)
  const rows: Record<string, unknown>[] = []
  for (const o of filtered) {
    const items = itemsByOrder.get(o.id) ?? []
    const orderCols = {
      '주문일': o.order_date,
      '주문번호': o.order_no ?? '',
      '업체(은행)': o.bank_name ?? '',
      '부서(지점)': o.branch_name ?? '',
      '담당자': o.manager_name ?? '',
      '다올직원': o.staff_name ?? '',
      '수금상태': STATUS_LABEL[o.collect_status ?? ''] ?? (o.collect_status ?? ''),
      '출처': (o.source ?? 'upload') === 'direct' ? '직접입력' : '업로드',
      '총금액(주문)': o.total_amount ?? 0,
      '미수금(주문)': o.outstanding_amount ?? 0,
    }
    if (!items.length) {
      rows.push({ ...orderCols, '주문메모': o.memo ?? '' })
      continue
    }
    for (const it of items) {
      rows.push({
        ...orderCols,
        '상담자': it.channel ?? '',
        '품번': it.item_code ?? '',
        '품명': it.item_name ?? '',
        '옵션': it.parent_line_no ? `${it.parent_line_no}번 행 옵션` : '',
        '구분': it.order_kind ?? '',
        '매입처': it.purchase_vendor_name ?? '',
        '판매가': it.sale_price ?? 0,
        '갯수': it.quantity ?? 0,
        '배송비': it.shipping_fee ?? 0,
        '할인금액': it.discount_amount ?? 0,
        '합계금액': it.line_total ?? 0,
        ...(showCost ? {
          '매입가': it.purchase_price ?? 0,
          '매입배송비': it.purchase_shipping ?? 0,
          '매입합계': it.purchase_total ?? 0,
          '마진': (it.line_total ?? 0) - (it.purchase_total ?? 0),
        } : {}),
        '취소여부': it.is_canceled ? '취소' : '',
        '선결제': it.is_prepayment ? '선결제' : '',
        '품목메모': it.memo ?? '',
        '주문메모': o.memo ?? '',
      })
    }
  }

  const period = [sp.get('from'), sp.get('to')].filter(Boolean).join('~')
  return xlsxResponse(rows, period ? `주문내역_${period}` : '주문내역', [
    11, 13, 14, 14, 12, 9, 9, 8, 11, 11,       // 주문 공통
    9, 12, 34, 12, 6, 14, 9, 6, 9, 9, 10,      // 품목
    ...(showCost ? [9, 9, 10, 10] : []),
    7, 7, 14, 14,
  ])
}
