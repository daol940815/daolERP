import type { SupabaseClient } from '@supabase/supabase-js'

// 주문 포털 공용 로직 (2단계 — 직접 입력 주문)
//  - 입력 payload 검증·금액 계산은 서버에서 다시 한다 (클라이언트 계산값 불신)
//  - 주문 저장 시 마스터 FK와 함께 기존 텍스트 컬럼(bank_name/manager_name/
//    staff_name/channel)을 병기해 하류(허브·수금 매칭·회계)가 수정 없이 소비한다

export const kstToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

// timestamptz → KST 날짜 문자열 (당일 수정 판정용)
export const kstDateOf = (ts: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(ts))

export interface OrderItemInput {
  product_id?: string | null
  item_code?: string | null
  item_name: string
  order_kind?: string | null          // 지점/개별/샘플
  purchase_vendor_name?: string | null
  sale_price: number
  quantity: number
  shipping_fee?: number
  discount_amount?: number
  purchase_price?: number
  purchase_shipping?: number
  memo?: string | null
}

export interface OrderInput {
  order_date: string
  vendor_id: string                   // 주문처 (vendors 마스터 — 자유 입력 금지)
  contact_id: string                  // 거래처 담당자 (contacts 마스터, 필수)
  counselor_employee_id: string       // 상담자 (employees 마스터, 필수)
  contact?: string | null             // 연락처 (담당자 선택 시 자동, 수정 가능)
  phone?: string | null               // 핸드폰
  introducer?: string | null
  supervisor?: string | null
  supervisor_contact?: string | null
  memo?: string | null
  items: OrderItemInput[]
}

const toInt = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

// 검증 + 금액 재계산. 오류 시 message 반환.
export function validateOrderInput(raw: unknown): { input: OrderInput } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>
  const orderDate = String(b.order_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return { error: '주문일이 올바르지 않습니다.' }
  if (!b.vendor_id) return { error: '주문처를 선택해주세요. (거래처 마스터에서 선택)' }
  if (!b.contact_id) return { error: '거래처 담당자를 선택해주세요.' }
  if (!b.counselor_employee_id) return { error: '상담자를 선택해주세요.' }

  const rawItems = Array.isArray(b.items) ? b.items : []
  const items: OrderItemInput[] = []
  for (const r of rawItems as Record<string, unknown>[]) {
    const name = String(r.item_name ?? '').trim()
    if (!name) continue                       // 품명 없는 빈 행은 무시
    const qty = toInt(r.quantity)
    if (qty <= 0) return { error: `품목 "${name}"의 갯수가 올바르지 않습니다.` }
    items.push({
      product_id: (r.product_id as string) || null,
      item_code: String(r.item_code ?? '').trim() || null,
      item_name: name,
      order_kind: String(r.order_kind ?? '').trim() || null,
      purchase_vendor_name: String(r.purchase_vendor_name ?? '').trim() || null,
      sale_price: toInt(r.sale_price),
      quantity: qty,
      shipping_fee: toInt(r.shipping_fee),
      discount_amount: toInt(r.discount_amount),
      purchase_price: toInt(r.purchase_price),
      purchase_shipping: toInt(r.purchase_shipping),
      memo: String(r.memo ?? '').trim() || null,
    })
  }
  if (!items.length) return { error: '품목을 1개 이상 입력해주세요.' }

  return {
    input: {
      order_date: orderDate,
      vendor_id: String(b.vendor_id),
      contact_id: String(b.contact_id),
      counselor_employee_id: String(b.counselor_employee_id),
      contact: String(b.contact ?? '').trim() || null,
      phone: String(b.phone ?? '').trim() || null,
      introducer: String(b.introducer ?? '').trim() || null,
      supervisor: String(b.supervisor ?? '').trim() || null,
      supervisor_contact: String(b.supervisor_contact ?? '').trim() || null,
      memo: String(b.memo ?? '').trim() || null,
      items,
    },
  }
}

export const lineTotal = (it: OrderItemInput) =>
  it.sale_price * it.quantity + (it.shipping_fee ?? 0) - (it.discount_amount ?? 0)

export const orderTotal = (items: OrderItemInput[]) =>
  items.reduce((s, it) => s + lineTotal(it), 0)

// 담당자·상담자 표시명 해석 (주문 텍스트 병기용) — 생성·수정·승인 공용
export async function resolveDisplayNames(
  admin: SupabaseClient,
  input: OrderInput,
): Promise<{ managerName: string | null; counselorName: string | null; error?: string }> {
  const [contactRes, asgnRes, empRes] = await Promise.all([
    admin.from('contacts').select('id, name, phone').eq('id', input.contact_id).maybeSingle(),
    admin.from('contact_assignments').select('title')
      .eq('contact_id', input.contact_id).eq('vendor_id', input.vendor_id)
      .is('ended_at', null).limit(1).maybeSingle(),
    admin.from('employees').select('id, name').eq('id', input.counselor_employee_id).maybeSingle(),
  ])
  if (!contactRes.data) return { managerName: null, counselorName: null, error: '거래처 담당자를 찾을 수 없습니다.' }
  if (!empRes.data) return { managerName: null, counselorName: null, error: '상담자 직원을 찾을 수 없습니다.' }
  const title = (asgnRes.data?.title as string | null) ?? null
  return {
    managerName: [contactRes.data.name, title].filter(Boolean).join(' '),
    counselorName: empRes.data.name as string,
  }
}

// 별칭 확보: alias_type+erp_name 으로 upsert 후 id 조회. vendor_id 미연결이면 연결.
export async function ensureAlias(
  admin: SupabaseClient,
  aliasType: 'customer' | 'purchase',
  erpName: string,
  vendorId?: string | null,
): Promise<string | null> {
  await admin.from('erp_vendor_aliases')
    .upsert({ alias_type: aliasType, erp_name: erpName }, { onConflict: 'alias_type,erp_name', ignoreDuplicates: true })
  const { data } = await admin.from('erp_vendor_aliases')
    .select('id, vendor_id, merged_into_alias_id')
    .eq('alias_type', aliasType).eq('erp_name', erpName).maybeSingle()
  if (!data) return null
  // 병합된 별칭이면 대표를 따라간다
  let id = data.id as string
  let vendorLinked = data.vendor_id as string | null
  for (let i = 0; i < 5 && data.merged_into_alias_id; i++) {
    const { data: rep } = await admin.from('erp_vendor_aliases')
      .select('id, vendor_id, merged_into_alias_id').eq('id', data.merged_into_alias_id).maybeSingle()
    if (!rep) break
    id = rep.id as string
    vendorLinked = rep.vendor_id as string | null
    if (!rep.merged_into_alias_id) break
  }
  if (vendorId && !vendorLinked) {
    await admin.from('erp_vendor_aliases').update({ vendor_id: vendorId }).eq('id', id)
  }
  return id
}

// direct 주문번호 자동 발번: D + YYMMDD + '-' + 3자리 (같은 날짜 내 순번)
export async function nextOrderNo(admin: SupabaseClient, orderDate: string): Promise<string> {
  const prefix = `D${orderDate.slice(2).replace(/-/g, '')}-`
  const { data } = await admin.from('erp_orders')
    .select('order_no').like('order_no', `${prefix}%`)
    .order('order_no', { ascending: false }).limit(1)
  const last = data?.[0]?.order_no as string | undefined
  const seq = last ? parseInt(last.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(3, '0')}`
}

// 주문+품목 스냅샷 (수정요청 감사 이력·상세 화면 공용)
export async function loadOrderSnapshot(admin: SupabaseClient, orderId: string) {
  const { data: order, error } = await admin.from('erp_orders').select('*').eq('id', orderId).maybeSingle()
  if (error || !order) return null
  const { data: items } = await admin.from('erp_order_items')
    .select('*').eq('order_id', orderId).order('line_no')
  return { order, items: items ?? [] }
}

interface ApplyContext {
  managerName: string | null      // 거래처 담당자 표시명 (이름+직함) — 하류 호환 텍스트
  counselorName: string | null    // 상담자 이름 — 품목 channel 텍스트
  staffName?: string | null       // 입력 직원 이름 (신규 생성 시만)
}

// 주문 필드·품목 행 재구성 (생성·수정·승인 반영 공용)
export function buildOrderRows(input: OrderInput, ctx: ApplyContext) {
  const total = orderTotal(input.items)
  const orderFields = {
    order_date: input.order_date,
    vendor_id: input.vendor_id,
    contact_id: input.contact_id,
    counselor_employee_id: input.counselor_employee_id,
    manager_name: ctx.managerName,
    contact: input.contact,
    phone: input.phone,
    introducer: input.introducer,
    supervisor: input.supervisor,
    supervisor_contact: input.supervisor_contact,
    memo: input.memo,
    total_amount: total,
  }
  const itemRows = input.items.map((it, i) => ({
    line_no: i + 1,
    is_canceled: false,
    is_vip: false,
    is_prepayment: it.item_name === '선결제',
    product_id: it.product_id ?? null,
    item_code: it.item_code ?? null,
    item_name: it.item_name,
    order_kind: it.order_kind ?? null,
    purchase_vendor_name: it.purchase_vendor_name ?? null,
    sale_price: it.sale_price,
    quantity: it.quantity,
    shipping_fee: it.shipping_fee ?? 0,
    discount_amount: it.discount_amount ?? 0,
    line_total: lineTotal(it),
    line_outstanding: lineTotal(it),
    purchase_price: it.purchase_price ?? 0,
    purchase_shipping: it.purchase_shipping ?? 0,
    purchase_total: (it.purchase_price ?? 0) * it.quantity + (it.purchase_shipping ?? 0),
    settlement_month: input.order_date.slice(0, 7),
    channel: ctx.counselorName,
    memo: it.memo ?? null,
  }))
  return { orderFields, itemRows, total }
}

// 품목의 매입처 별칭 연결 후 품목 행 삽입
export async function insertOrderItems(
  admin: SupabaseClient,
  orderId: string,
  itemRows: ReturnType<typeof buildOrderRows>['itemRows'],
): Promise<string | null> {
  const rows = []
  for (const it of itemRows) {
    const aliasId = it.purchase_vendor_name
      ? await ensureAlias(admin, 'purchase', it.purchase_vendor_name)
      : null
    rows.push({ ...it, order_id: orderId, purchase_alias_id: aliasId })
  }
  const { error } = await admin.from('erp_order_items').insert(rows)
  return error ? error.message : null
}

// 기존 주문에 수정 내용 반영 (당일 직접 수정 · 수정요청 승인 공용)
// 수금 반영분 보존: 기수금액 = 기존 총액 - 기존 미수 → 새 미수 = max(0, 새 총액 - 기수금액)
export async function applyOrderEdit(
  admin: SupabaseClient,
  orderId: string,
  input: OrderInput,
  ctx: ApplyContext,
): Promise<string | null> {
  const snap = await loadOrderSnapshot(admin, orderId)
  if (!snap) return '주문을 찾을 수 없습니다.'
  const { orderFields, itemRows, total } = buildOrderRows(input, ctx)

  const collected = Math.max(0, (snap.order.total_amount ?? 0) - (snap.order.outstanding_amount ?? 0))
  const outstanding = Math.max(0, total - collected)
  const collectStatus = outstanding === 0 ? 'collected'
    : collected > 0 ? 'in_progress' : snap.order.collect_status

  // 주문처 변경 시 별칭도 갱신
  const { data: vendor } = await admin.from('vendors').select('id, name').eq('id', input.vendor_id).maybeSingle()
  if (!vendor) return '주문처 거래처를 찾을 수 없습니다.'
  const aliasId = await ensureAlias(admin, 'customer', vendor.name as string, vendor.id as string)

  const { error: upErr } = await admin.from('erp_orders').update({
    ...orderFields,
    bank_name: vendor.name,
    branch_name: null,
    customer_alias_id: aliasId,
    outstanding_amount: outstanding,
    collect_status: collectStatus,
  }).eq('id', orderId)
  if (upErr) return `주문 저장 실패: ${upErr.message}`

  const { error: delErr } = await admin.from('erp_order_items').delete().eq('order_id', orderId)
  if (delErr) return `기존 품목 교체 실패: ${delErr.message}`
  return insertOrderItems(admin, orderId, itemRows)
}
