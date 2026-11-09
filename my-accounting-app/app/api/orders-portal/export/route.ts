import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { filterFromSearchParams, loadFilteredOrders } from '@/lib/orders-portal-list'
import { xlsxResponse } from '@/lib/xlsx-export'
import { honorify } from '@/lib/contact-label'
import { REPLY_LABEL } from '@/lib/order-reply'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 주문 현황 엑셀 내보내기 — 목록과 동일 필터(lib/orders-portal-list.ts 공용).
// 품목 행 단위로 전개: 주문 정보가 각 품목 행에 반복되는 기존 ERP 다운로드 형식.
// 원가 노출 정책: 매입가·매입배송비·매입합계·마진 컬럼 전 직원 공개 (2026-08-13 사용자 결정).
//
// GET ?q=&c=<항목>:<값>(반복)&from=&to=&collect=&source=&prepay=1&invoice=1&mine=consult|handled

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
  is_vip: boolean | null
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  purchase_vendor_name: string | null
  sale_price: number | null
  quantity: number | null
  shipping_fee: number | null
  discount_amount: number | null
  purchase_discount?: number | null   // 708 매입할인
  order_season?: string | null        // 708 주문시기
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
  const { filtered, replyMap } = result
  if (!filtered.length) {
    return NextResponse.json({ error: '조건에 맞는 주문이 없습니다.' }, { status: 404 })
  }

  // 품목 로드 (주문 id 청크 — .in() URL 길이 제한 회피)
  const orderIds = filtered.map(o => o.id)
  const itemsByOrder = new Map<string, ItemRow[]>()
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK)
    const BASE_COLS = 'order_id, line_no, parent_line_no, is_canceled, is_prepayment, is_vip, item_code, item_name, order_kind, purchase_vendor_name, sale_price, quantity, shipping_fee, discount_amount, line_total, purchase_price, purchase_shipping, purchase_total, channel, memo'
    const load = (cols: string) => fetchAllRows<ItemRow>((pf, pt) =>
      admin.from('erp_order_items')
        .select(cols as string as "*")
        .in('order_id', chunk).order('order_id').order('line_no').range(pf, pt),
    )
    // 708(매입할인 · 주문시기) 미적용 DB면 새 열 없이 다시 조회
    let r = await load(`${BASE_COLS}, purchase_discount, order_season`)
    if ('error' in r && /purchase_discount|order_season/i.test(String(r.error))) r = await load(BASE_COLS)
    if ('error' in r) return NextResponse.json({ error: `품목 조회 실패: ${r.error}` }, { status: 500 })
    for (const it of r.data) {
      const list = itemsByOrder.get(it.order_id) ?? []
      list.push(it)
      itemsByOrder.set(it.order_id, list)
    }
  }

  const showCost = true   // 매입가·마진 전 직원 공개 (2026-08-13 사용자 결정)
  // 품목 열 (품목 없는 주문은 전부 빈 칸) — 모든 행이 같은 키 순서를 갖게 해 열이 어긋나지 않게 한다.
  // 주문메모는 항상 마지막 열 (2026-11-05: 품목 없는 주문이 첫 행이면 주문메모가 품번 앞에 오던 문제 수정)
  const itemColsOf = (it: ItemRow | null): Record<string, unknown> => ({
    '품번': it?.item_code ?? '',
    '품명': it?.item_name ?? '',
    '옵션': it?.parent_line_no ? `${it.parent_line_no}번 행 옵션` : '',
    '배송종류': it?.order_kind ?? '',
    '주문시기': it?.order_season ?? '',
    '매입처': it?.purchase_vendor_name ?? '',
    '판매가': it ? it.sale_price ?? 0 : '',
    '갯수': it ? it.quantity ?? 0 : '',
    '배송비': it ? it.shipping_fee ?? 0 : '',
    '판매할인': it ? it.discount_amount ?? 0 : '',
    '합계금액': it ? it.line_total ?? 0 : '',
    ...(showCost ? {
      '매입가': it ? it.purchase_price ?? 0 : '',
      '매입할인': it ? it.purchase_discount ?? 0 : '',
      '매입배송비': it ? it.purchase_shipping ?? 0 : '',
      '매입합계': it ? it.purchase_total ?? 0 : '',
      '마진': it ? (it.line_total ?? 0) - (it.purchase_total ?? 0) : '',
    } : {}),
    '취소여부': it?.is_canceled ? '취소' : '',
    '선결제': it?.is_prepayment ? '선결제' : '',
    'VIP': it?.is_vip ? 'VIP' : '',          // 품명 'VIP' — 매출 집계 제외 (2026-11-09)
    '품목메모': it?.memo ?? '',
  })

  const rows: Record<string, unknown>[] = []
  for (const o of filtered) {
    const items = itemsByOrder.get(o.id) ?? []
    const orderCols = {
      '주문일': o.order_date,
      '주문번호': o.order_no ?? '',
      '업체(은행)': o.bank_name ?? '',
      '부서(지점)': o.branch_name ?? '',
      '담당자': honorify(o.manager_name as string | null),
      '담당자 핸드폰': o.phone ?? '',
      '담당자 연락처': o.contact ?? '',
      '다올직원': o.staff_name ?? '',
      // 상담자는 다올직원 바로 옆 — 같은 사람이어도 둘 다 표기 (2026-11-05 사용자 요청, 목록과 동일). 값은 품목 행마다 채움
      '상담자': '',
      '수금상태': STATUS_LABEL[o.collect_status ?? ''] ?? (o.collect_status ?? ''),
      // 완료 회신 (515) — 회신 대상 아니면 빈 칸
      '회신': replyMap.get(o.id) ? REPLY_LABEL[replyMap.get(o.id)!.state] : '',
      '출처': (o.source ?? 'upload') === 'direct' ? '직접입력' : '업로드',
      '총금액(주문)': o.total_amount ?? 0,
      '미수금(주문)': o.outstanding_amount ?? 0,
    }
    if (!items.length) {
      rows.push({ ...orderCols, ...itemColsOf(null), '주문메모': o.memo ?? '' })
      continue
    }
    for (const it of items) {
      rows.push({ ...orderCols, '상담자': it.channel ?? '', ...itemColsOf(it), '주문메모': o.memo ?? '' })
    }
  }

  const period = [sp.get('from'), sp.get('to')].filter(Boolean).join('~')
  return xlsxResponse(rows, period ? `주문내역_${period}` : '주문내역', [
    11, 13, 14, 14, 12, 9, 9, 9, 9, 8, 11, 11,    // 주문 공통 (다올직원 · 상담자 나란히 · 회신)
    12, 34, 12, 6, 14, 9, 6, 9, 9, 10,         // 품목
    ...(showCost ? [9, 9, 10, 10] : []),
    7, 7, 6, 14, 14,
  ])
}
