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
  parent_line_no: number | null      // 옵션(부가상품) 행이 딸린 본 상품 행 번호 (701)
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
      parent_line_no: toInt(r.parent_line_no) > 0 ? toInt(r.parent_line_no) : null,
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
// parent_line_no는 자기 자신·범위 밖 참조를 무효화 (orders-portal과 동일 규칙)
export function consultItemRows(items: ConsultItemInput[]) {
  return items.map((it, i) => ({
    ...it,
    line_no: i + 1,
    parent_line_no: it.parent_line_no && it.parent_line_no !== i + 1 && it.parent_line_no <= items.length
      ? it.parent_line_no : null,
    line_total: it.sale_price * it.quantity + it.shipping_fee - it.discount_amount,
    purchase_total: it.purchase_price * it.quantity + it.purchase_shipping,
  }))
}

// 품목 삽입 — 701 미적용 환경 호환: 옵션 연결이 전혀 없으면 parent_line_no를 보내지 않는다
export async function insertConsultItems(
  admin: { from: (t: string) => { insert: (rows: unknown[]) => PromiseLike<{ error: { message: string } | null }> } },
  consultationId: string,
  rows: ReturnType<typeof consultItemRows>,
): Promise<string | null> {
  if (!rows.length) return null
  const hasParent = rows.some(it => it.parent_line_no != null)
  const payload = rows.map(it => {
    const { parent_line_no, ...rest } = it
    return {
      ...(hasParent ? { ...rest, parent_line_no } : rest),
      consultation_id: consultationId,
    }
  })
  const { error } = await admin.from('erp_consultation_items').insert(payload)
  if (error && /parent_line_no/i.test(error.message)) {
    return '701 마이그레이션(상담 품목 옵션)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  return error ? error.message : null
}
