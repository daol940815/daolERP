// 상담일지 공용 로직 (생성·수정 라우트 공용)
import { SHIP_KEYS } from './ship-address'
import { normalizeSeason } from './order-season'

export const CONSULT_TYPES = ['주문', '문의', '요청', '결제', '기타'] as const
export const CONSULT_MIGRATION_HINT =
  '506 마이그레이션(상담일지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}
const toStr = (v: unknown) => String(v ?? '').trim() || null

// 매입할인 파싱 (708) — 개당이면 unit × 수량으로 서버가 재계산 (판매할인 704와 같은 규칙). 주문 저장과 공용
export function parsePurchaseDiscount(r: Record<string, unknown>) {
  const unitMode = r.purchase_discount_mode === '단가'
  const unit = unitMode ? Math.max(0, toInt(r.purchase_discount_unit)) : 0
  return {
    purchase_discount_mode: unitMode ? '단가' as const : '정액' as const,
    purchase_discount_unit: unit,
    purchase_discount: unitMode ? unit * toInt(r.quantity) : Math.max(0, toInt(r.purchase_discount)),
  }
}

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
  discount_mode: '정액' | '단가'      // 할인 종류 (704) — discount_amount는 항상 최종 할인액
  discount_unit: number               // 단가 할인의 개당 할인액(원)
  purchase_price: number
  purchase_shipping: number
  purchase_discount: number                // 매입할인 최종 금액 (708) — 매입합계에서 뺀다
  purchase_discount_mode: '정액' | '단가'  // 매입할인 종류 (708)
  purchase_discount_unit: number           // 개당 매입할인액(원)
  order_season: string | null              // 주문시기 (708) — 상시 · 26설 · 26추석 …
  memo: string | null
  status: string | null              // 품목 상태 — 품절·단가변경 등 (509, 실무자 요청)
  option_note: string | null         // 색상·옵션 등 기타사항 (품목별, 509)
  parent_line_no: number | null      // 옵션(부가상품) 행이 딸린 본 상품 행 번호 (701)
  is_shipping: boolean               // 배송비 행 — 주문 전환 시 본 상품 배송비로 합산 (702)
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
      discount_amount: r.discount_mode === '단가'
        ? toInt(r.discount_unit) * toInt(r.quantity)
        : toInt(r.discount_amount),
      discount_mode: r.discount_mode === '단가' ? '단가' as const : '정액' as const,
      discount_unit: r.discount_mode === '단가' ? toInt(r.discount_unit) : 0,
      purchase_price: toInt(r.purchase_price),
      purchase_shipping: toInt(r.purchase_shipping),
      ...parsePurchaseDiscount(r),
      order_season: normalizeSeason(toStr(r.order_season)) || null,
      memo: toStr(r.memo),
      status: toStr(r.status),
      option_note: toStr(r.option_note),
      parent_line_no: toInt(r.parent_line_no) > 0 ? toInt(r.parent_line_no) : null,
      is_shipping: r.is_shipping === true,
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
    // 결제·발송 정보 확장 (509, 계산서 발행용 — 실무자 요청)
    invoice_email: toStr(body.invoice_email),
    fax: toStr(body.fax),
    biz_number: toStr(body.biz_number),
    ceo_name: toStr(body.ceo_name),
    // 배송지 (706) — 주문서와 같은 5컬럼. body.ship 객체로 받는다 (ShipCard 공용)
    ...((): Record<(typeof SHIP_KEYS)[number], string | null> => {
      const sh = (body.ship ?? {}) as Record<string, unknown>
      return {
        ship_name: toStr(sh.ship_name), ship_phone: toStr(sh.ship_phone), ship_zip: toStr(sh.ship_zip),
        ship_addr1: toStr(sh.ship_addr1), ship_addr2: toStr(sh.ship_addr2),
      }
    })(),
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
    purchase_total: it.purchase_price * it.quantity + it.purchase_shipping - it.purchase_discount,
  }))
}

export const MIGRATION_708_HINT =
  '708 마이그레이션(매입할인 · 주문시기)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

// 509 미적용 호환 — 결제·발송 확장 필드에 값이 전혀 없으면 컬럼을 보내지 않는다
export const CONSULT_509_HINT =
  '509 마이그레이션(실무자 보완)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const NEW_CONSULT_KEYS = ['invoice_email', 'fax', 'biz_number', 'ceo_name'] as const
export const CONSULT_706_HINT =
  '706 마이그레이션(상담일지 배송지)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export function compatConsultFields<T extends Record<string, unknown>>(fields: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields }
  if (!NEW_CONSULT_KEYS.some(k => fields[k] != null)) for (const k of NEW_CONSULT_KEYS) delete out[k]
  // 706 미적용 호환 — 배송지를 입력하지 않은 저장이면 ship_* 컬럼을 보내지 않는다
  if (!SHIP_KEYS.some(k => fields[k] != null)) for (const k of SHIP_KEYS) delete out[k]
  return out
}

// 품목 삽입 — 미적용 마이그레이션 호환:
//  701(parent_line_no)·509(status·option_note)는 값이 전혀 없으면 컬럼을 보내지 않는다
export async function insertConsultItems(
  admin: { from: (t: string) => { insert: (rows: unknown[]) => PromiseLike<{ error: { message: string } | null }> } },
  consultationId: string,
  rows: ReturnType<typeof consultItemRows>,
): Promise<string | null> {
  if (!rows.length) return null
  const hasParent = rows.some(it => it.parent_line_no != null)
  const hasItemMeta = rows.some(it => it.status != null || it.option_note != null)
  const hasShipping = rows.some(it => it.is_shipping)
  const hasDiscountMode = rows.some(it => it.discount_mode === '단가' || it.discount_unit > 0)
  // 708 미적용 호환 — 매입할인 · 주문시기를 쓴 저장에만 새 컬럼을 보낸다
  const has708 = rows.some(it => it.purchase_discount > 0 || it.purchase_discount_mode === '단가' || it.order_season != null)
  const payload = rows.map(it => {
    const {
      parent_line_no, status, option_note, is_shipping, discount_mode, discount_unit,
      purchase_discount, purchase_discount_mode, purchase_discount_unit, order_season, ...rest
    } = it
    return {
      ...rest,
      ...(has708 ? { purchase_discount, purchase_discount_mode, purchase_discount_unit, order_season } : {}),
      ...(hasParent ? { parent_line_no } : {}),
      ...(hasItemMeta ? { status, option_note } : {}),
      ...(hasShipping ? { is_shipping } : {}),
      ...(hasDiscountMode ? { discount_mode, discount_unit } : {}),
      consultation_id: consultationId,
    }
  })
  const { error } = await admin.from('erp_consultation_items').insert(payload)
  if (error && /purchase_discount|order_season/i.test(error.message)) return MIGRATION_708_HINT
  if (error && /parent_line_no/i.test(error.message)) {
    return '701 마이그레이션(상담 품목 옵션)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  if (error && /discount_mode|discount_unit/i.test(error.message)) {
    return '704 마이그레이션(할인 종류)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  if (error && /is_shipping/i.test(error.message)) {
    return '702 마이그레이션(배송비 행·지점명 보정)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  if (error && /status|option_note/i.test(error.message)) {
    return '509 마이그레이션(품목별 상태·기타사항)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  return error ? error.message : null
}
