// 상담일지 공용 로직 (생성·수정 라우트 공용)

export const CONSULT_TYPES = ['주문', '문의', '요청', '결제', '기타'] as const
export const CONSULT_MIGRATION_HINT =
  '506 마이그레이션(상담일지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}
const toStr = (v: unknown) => String(v ?? '').trim() || null

export interface ConsultItemInput {
  product_id: string | null
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  purchase_vendor_name: string | null
  sale_price: number
  quantity: number
  shipping_fee: number
  discount_amount: number
  purchase_price: number
  purchase_shipping: number
  memo: string | null
}

// 상담 본문 파싱 — 필수는 상담일·구분뿐 (아는 만큼만 기록)
export function parseConsultBody(body: Record<string, unknown>) {
  const consultDate = String(body.consult_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(consultDate)) return { error: '상담일이 올바르지 않습니다.' } as const
  const consultType = String(body.consult_type ?? '').trim()
  if (!(CONSULT_TYPES as readonly string[]).includes(consultType)) {
    return { error: '구분을 선택해주세요.' } as const
  }

  const items: ConsultItemInput[] = (Array.isArray(body.items) ? body.items : [])
    .map((r: Record<string, unknown>) => ({
      product_id: (r.product_id as string) || null,
      item_code: toStr(r.item_code),
      item_name: toStr(r.item_name),
      order_kind: toStr(r.order_kind),
      purchase_vendor_name: toStr(r.purchase_vendor_name),
      sale_price: toInt(r.sale_price),
      quantity: toInt(r.quantity),
      shipping_fee: toInt(r.shipping_fee),
      discount_amount: toInt(r.discount_amount),
      purchase_price: toInt(r.purchase_price),
      purchase_shipping: toInt(r.purchase_shipping),
      memo: toStr(r.memo),
    }))
    .filter(it => it.item_name)

  const fields = {
    consult_date: consultDate,
    consult_type: consultType,
    vendor_group_id: (body.vendor_group_id as string) || null,
    vendor_id: (body.vendor_id as string) || null,
    contact_id: (body.contact_id as string) || null,
    bank_name: toStr(body.bank_name),
    branch_name: toStr(body.branch_name),
    manager_name: toStr(body.manager_name),
    phone: toStr(body.phone),
    tel: toStr(body.tel),
    product_status: toStr(body.product_status),
    option_note: toStr(body.option_note),
    sender_name: toStr(body.sender_name),
    delivery_request: toStr(body.delivery_request),
    greeting_card: toStr(body.greeting_card),
    address_checked: toStr(body.address_checked),
    roster_method: toStr(body.roster_method),
    memo: toStr(body.memo),
  }
  return { fields, items, paymentPlain: String(body.payment_info ?? '').trim() }
}

// 품목 행 구성 — 합계는 서버 재계산 (주문과 동일 공식)
export function consultItemRows(items: ConsultItemInput[]) {
  return items.map((it, i) => ({
    ...it,
    line_no: i + 1,
    line_total: it.sale_price * it.quantity + it.shipping_fee - it.discount_amount,
    purchase_total: it.purchase_price * it.quantity + it.purchase_shipping,
  }))
}
