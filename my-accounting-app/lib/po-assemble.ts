// 발주서 1건의 양식 데이터 조립 — 발주서 다운로드 · 메일(route)과 업체 양식 시험 생성(매입처 양식 탭)이 같은 결과를 쓴다.
// (2026-11-09 purchase-orders/[id]/route.ts에서 그대로 옮김 — 동작 변경 없음)
import type { SupabaseClient } from '@supabase/supabase-js'
import { rosterRowsForOrder } from '@/lib/delivery-roster-server'
import { normalizeShipRequest, type PoExcelData } from '@/lib/po-form'
import type { FormExtra } from '@/lib/po-vendor-form'

export interface PoRecord {
  id: string
  po_no: string
  order_id: string
  vendor_id: string | null
  vendor_name: string
  total_amount: number
  delivery_note: string | null
  email_to: string | null
  send_method: string | null
  sent_at: string | null
  status: string
  created_at: string
  created_by?: string | null
  creator: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null
  vendor?: { uses_custom_po: boolean; po_use_sale_price?: boolean } | { uses_custom_po: boolean; po_use_sale_price?: boolean }[] | null
}
export const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

export async function loadPo(admin: SupabaseClient, id: string) {
  const sel = (withFlags: boolean) => admin.from('erp_purchase_orders')
    .select((withFlags
      ? 'id, po_no, order_id, vendor_id, vendor_name, total_amount, delivery_note, email_to, send_method, sent_at, status, created_at, created_by, creator:employees!erp_purchase_orders_created_by_fkey(name, phone), vendor:vendors(uses_custom_po, po_use_sale_price)'
      : 'id, po_no, order_id, vendor_id, vendor_name, total_amount, delivery_note, email_to, send_method, sent_at, status, created_at, created_by, creator:employees!erp_purchase_orders_created_by_fkey(name, phone)') as string)
    .eq('id', id).maybeSingle()
  // po_use_sale_price는 509 — 미적용 환경이면 플래그 없이 재조회
  let { data: po, error } = await sel(true)
  if (error && /po_use_sale_price/i.test(error.message)) ({ data: po, error } = await sel(false))
  if (error || !po) return null
  const poRec = po as unknown as PoRecord
  const { data: items } = await admin.from('erp_purchase_order_items')
    .select('line_no, order_item_id, item_code, item_name, order_kind, quantity, purchase_price, purchase_shipping, purchase_total, memo')
    .eq('po_id', id).order('line_no')
  const baseCols = 'order_no, order_date, bank_name, branch_name, manager_name, contact, phone, consultation_id'
  // 배송지(513) 포함 조회 — 미적용 DB면 배송지 없이 재조회
  const withShip = await admin.from('erp_orders')
    .select(`${baseCols}, ship_name, ship_phone, ship_zip, ship_addr1, ship_addr2`)
    .eq('id', poRec.order_id).maybeSingle()
  type OrderRow = {
    order_no: string | null; order_date: string | null; bank_name: string | null; branch_name: string | null
    manager_name: string | null; contact: string | null; phone: string | null; consultation_id: string | null
    ship_name?: string | null; ship_phone?: string | null; ship_zip?: string | null; ship_addr1?: string | null; ship_addr2?: string | null
  }
  const order = (withShip.error
    ? (await admin.from('erp_orders').select(baseCols).eq('id', poRec.order_id).maybeSingle()).data
    : withShip.data) as OrderRow | null
  return { po: poRec, items: items ?? [], order }
}

// 발주담당자·연락처: 발주 진행(다운로드·발송) 시점의 로그인 직원 기준 (사용자 확정
// 2026-08-24). 직원 정보가 없으면 발주서 작성자로 대체.
// 연락처는 업무용 핸드폰(employees.work_phone, 205) → 비어 있으면 직원 핸드폰(phone)
// → 둘 다 없으면 비워 두어 양식이 회사 대표번호를 쓴다 (2026-11-05 사용자 결정).
// 205 미적용 DB에서는 직원 핸드폰만 본다.
export async function currentStaff(
  admin: SupabaseClient,
  employeeId: string | null | undefined,
  po: PoRecord,
): Promise<{ name: string | null; phone: string | null }> {
  const lookup = async (id: string) => {
    const r = await admin.from('employees').select('name, work_phone, phone').eq('id', id).maybeSingle()
    if (!r.error) {
      return r.data ? {
        name: (r.data.name as string) ?? null,
        phone: ((r.data.work_phone as string) || (r.data.phone as string)) ?? null,
      } : null
    }
    const old = await admin.from('employees').select('name, phone').eq('id', id).maybeSingle()   // 205 미적용
    return old.data ? { name: (old.data.name as string) ?? null, phone: (old.data.phone as string) ?? null } : null
  }
  if (employeeId) {
    const s = await lookup(employeeId)
    if (s) return s
  }
  if (po.created_by) {
    const s = await lookup(po.created_by)
    if (s) return s
  }
  const c = one(po.creator)
  return { name: c?.name ?? null, phone: c?.phone ?? null }
}

// 개정 양식 데이터 조립 — 양식이 요구하는 항목 중 ERP가 아는 값을 채운다.
// 엑셀 생성과 화면 미리보기(GET의 form)가 같은 조립 결과를 쓴다.
export async function assembleForm(
  admin: SupabaseClient,
  data: NonNullable<Awaited<ReturnType<typeof loadPo>>>,
  staff: { name: string | null; phone: string | null },
): Promise<PoExcelData> {
  const { po, items, order } = data

  // 출고요청일: 주문에 연결된 상담일지의 배송요청일 (없으면 공란 — 수기 기입)
  let shipRequest: string | null = null
  if (order?.consultation_id) {
    const { data: c } = await admin.from('erp_consultations')
      .select('delivery_request').eq('id', order.consultation_id).maybeSingle()
    shipRequest = (c?.delivery_request as string) ?? null
  }

  // 품목 구분 (2026-11-05): 원 주문 품목 → 품목 마스터의 '비용 품목'(is_shipping) · 부가상품(is_addon 또는 옵션 행)
  // 택배비 줄(2026-11-12): 품목 관리의 박스당 택배비 + 원 주문 품목의 실제 매입배송비도 함께 읽는다
  const roleByOrderItem = new Map<string, 'fee' | 'addon'>()
  const shipByOrderItem = new Map<string, { box_fee: number | null; purchase: number }>()
  const orderItemIds = items.map(it => it.order_item_id).filter(Boolean) as string[]
  if (orderItemIds.length) {
    const { data: ois } = await admin.from('erp_order_items')
      .select('id, product_id, parent_line_no, purchase_shipping').in('id', orderItemIds)
    const pids = Array.from(new Set((ois ?? []).map(o => o.product_id).filter(Boolean))) as string[]
    const prodFlags = new Map<string, { fee: boolean; addon: boolean; box_fee: number }>()
    if (pids.length) {
      const withShip = await admin.from('erp_products').select('id, is_addon, is_shipping, carton_shipping_fee, loose_shipping_fee').in('id', pids)
      const rows = withShip.error
        ? (await admin.from('erp_products').select('id, is_addon, carton_shipping_fee, loose_shipping_fee').in('id', pids)).data   // 703 미적용 폴백
        : withShip.data
      for (const p of (rows ?? []) as { id: string; is_addon?: boolean; is_shipping?: boolean; carton_shipping_fee?: number | null; loose_shipping_fee?: number | null }[]) {
        const carton = Number(p.carton_shipping_fee ?? 0) || 0
        prodFlags.set(p.id, { fee: !!p.is_shipping, addon: !!p.is_addon, box_fee: carton > 0 ? carton : (Number(p.loose_shipping_fee ?? 0) || 0) })
      }
    }
    for (const o of ois ?? []) {
      const f = o.product_id ? prodFlags.get(o.product_id as string) : undefined
      if (f?.fee) roleByOrderItem.set(o.id as string, 'fee')
      else if (f?.addon || o.parent_line_no) roleByOrderItem.set(o.id as string, 'addon')
      shipByOrderItem.set(o.id as string, { box_fee: f ? f.box_fee : null, purchase: Number(o.purchase_shipping ?? 0) || 0 })
    }
  }

  // 개별 배송 명단 (707) — 이 주문에 연결된 수령인 행. 미적용 DB면 빈 배열
  const rosterRows = await rosterRowsForOrder(admin, po.order_id).catch(() => [])

  return {
    po_no: po.po_no,
    order_date: order?.order_date ?? null,
    ship_request: normalizeShipRequest(shipRequest, order?.order_date ?? null),   // 'YYYY-MM-DD'로 통일 (2026-11-09)
    vendor_name: po.vendor_name,
    customer: [order?.bank_name, order?.branch_name].filter(Boolean).join(' ') || '-',
    customer_bank: (order?.bank_name as string | null) ?? null,
    customer_branch: (order?.branch_name as string | null) ?? null,
    customer_manager: order?.manager_name ?? null,
    customer_phone: (order?.phone as string) || (order?.contact as string) || null,
    staff_name: staff.name,
    staff_phone: staff.phone,
    total_amount: po.total_amount ?? 0,
    delivery_note: po.delivery_note,
    ship: order && 'ship_addr1' in order ? {
      ship_name: (order.ship_name as string | null) ?? null, ship_phone: (order.ship_phone as string | null) ?? null,
      ship_zip: (order.ship_zip as string | null) ?? null, ship_addr1: (order.ship_addr1 as string | null) ?? null,
      ship_addr2: (order.ship_addr2 as string | null) ?? null,
    } : null,
    roster_rows: rosterRows,
    items: items.map(it => ({
      item_code: it.item_code, item_name: it.item_name, order_kind: it.order_kind,
      quantity: it.quantity ?? 0, purchase_price: it.purchase_price ?? 0,
      purchase_shipping: it.purchase_shipping ?? 0, purchase_total: it.purchase_total ?? 0,
      memo: it.memo,
      role: it.order_item_id ? roleByOrderItem.get(it.order_item_id as string) ?? null : null,
      ship_box_fee: it.order_item_id ? shipByOrderItem.get(it.order_item_id as string)?.box_fee ?? null : null,
      ship_purchase: it.order_item_id ? shipByOrderItem.get(it.order_item_id as string)?.purchase ?? null : null,
    })),
    sale_basis: one(po.vendor)?.po_use_sale_price === true,
  }
}

export type LoadedPo = NonNullable<Awaited<ReturnType<typeof loadPo>>>

// 업체 양식(516)에만 필요한 값 — 상담일지 '보내는분 명의' · 발주 담당 직급 · 고객 담당자(존칭 없이)
export async function formExtraOf(admin: SupabaseClient, data: LoadedPo, employeeId: string | null | undefined): Promise<FormExtra> {
  const consultationId = data.order?.consultation_id ?? null
  const [c, e] = await Promise.all([
    consultationId
      ? admin.from('erp_consultations').select('sender_name').eq('id', consultationId).maybeSingle()
      : Promise.resolve({ data: null }),
    employeeId || data.po.created_by
      ? admin.from('employees').select('position').eq('id', (employeeId || data.po.created_by)!).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const sender = ((c.data as { sender_name?: string | null } | null)?.sender_name ?? '').trim()
  const manager = (data.order?.manager_name ?? '').replace(/\s*님$/, '').trim()
  return {
    sender_name: sender || null,
    staff_title: ((e.data as { position?: string | null } | null)?.position ?? null) || null,
    manager_plain: manager || null,
  }
}
