import type { SupabaseClient } from '@supabase/supabase-js'
import { contactLabel } from '@/lib/contact-label'

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
  parent_line_no?: number | null      // 옵션(부가상품) 행이 딸린 본 상품 행 번호
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
      parent_line_no: toInt(r.parent_line_no) > 0 ? toInt(r.parent_line_no) : null,
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
    // 거래처 담당자는 존칭을 붙여 기록한다 (기존 ERP 표기와 동일 — lib/contact-label.ts)
    managerName: contactLabel(contactRes.data.name as string, title),
    counselorName: empRes.data.name as string,
  }
}

// 주문처 업체/지점 이름 해석 (505 — vendor_groups)
//  bank_name=업체명, branch_name=지점명(거래처명에서 업체명 접두 제거).
//  그룹 없으면 업체=거래처명, 지점=NULL (단일 업체). 505 미적용 환경도 동일 동작.
export async function resolveVendorNames(
  admin: SupabaseClient,
  vendorId: string,
): Promise<{ vendorName: string; bankName: string; branchName: string | null } | { error: string }> {
  let name: string | null = null
  let groupName: string | null = null
  const withGroup = await admin.from('vendors')
    .select('id, name, group_id, vendor_groups(name)').eq('id', vendorId).maybeSingle()
  if (!withGroup.error && withGroup.data) {
    name = withGroup.data.name as string
    const g = withGroup.data.vendor_groups as unknown as { name: string } | null
    groupName = g?.name ?? null
  } else {
    const plain = await admin.from('vendors').select('id, name').eq('id', vendorId).maybeSingle()
    if (!plain.data) return { error: '주문처 거래처를 찾을 수 없습니다.' }
    name = plain.data.name as string
  }
  if (!name) return { error: '주문처 거래처를 찾을 수 없습니다.' }

  if (!groupName) return { vendorName: name, bankName: name, branchName: null }
  let branch = name
  if (name.startsWith(groupName)) branch = name.slice(groupName.length).trim()
  return { vendorName: name, bankName: groupName, branchName: branch || null }
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
    // 본 상품 행 번호 — 자기 자신·범위 밖 참조는 무시
    parent_line_no: it.parent_line_no && it.parent_line_no !== i + 1 && it.parent_line_no <= input.items.length
      ? it.parent_line_no : null,
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
  // 504 미적용 환경 호환: 옵션 연결이 전혀 없으면 parent_line_no 컬럼을 아예 보내지 않는다
  const hasParent = itemRows.some(it => it.parent_line_no != null)
  const rows = []
  for (const it of itemRows) {
    const aliasId = it.purchase_vendor_name
      ? await ensureAlias(admin, 'purchase', it.purchase_vendor_name)
      : null
    const { parent_line_no, ...rest } = it
    rows.push({
      ...(hasParent ? { ...rest, parent_line_no } : rest),
      order_id: orderId,
      purchase_alias_id: aliasId,
    })
  }
  const { error } = await admin.from('erp_order_items').insert(rows)
  if (error && /parent_line_no/i.test(error.message)) {
    return '504 마이그레이션(부가상품 옵션)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
  }
  return error ? error.message : null
}

// ── 취소·재등록 (2026-08-25 확정 — 홈택스 방식) ────────────────────
// 당일 수정: 기본정보 직접 갱신+변경 로그, 품목은 변경분만 행 취소+새 행 등록
//   (변경 없는 품목 행 보존 → 발주 링크 유지). 익일 이후: 전체 취소+재등록.
// 삭제는 물리 삭제 폐지 — 취소 처리로 상계 (집계는 취소 제외라 음수 행 불필요).

export interface Editor { employeeId: string | null; employeeName: string | null }

// 취소·재등록 권한 (2026-08-25 사용자 확정): 입력자 본인 + manager/admin만.
// 입력자 기록이 없는 옛 주문은 관리자만 처리할 수 있다.
export function canCancelReissue(
  order: Record<string, unknown>,
  me: { role: string; employeeId: string | null },
): boolean {
  if (order.source !== 'direct' || order.canceled_at) return false
  if (me.role === 'manager' || me.role === 'admin') return true
  return !!me.employeeId && order.created_by_employee_id === me.employeeId
}

// 변경 로그 기록 — 511 미적용이면 경고 문구만 반환 (수정 자체는 유지)
export async function writeEditLogs(
  admin: SupabaseClient,
  orderId: string,
  editor: Editor,
  rows: { field: string; before?: string | null; after?: string | null }[],
): Promise<string | null> {
  if (!rows.length) return null
  const { error } = await admin.from('erp_order_edit_logs').insert(rows.map(r => ({
    order_id: orderId,
    employee_id: editor.employeeId,
    employee_name: editor.employeeName,
    field_label: r.field,
    before_text: r.before ?? null,
    after_text: r.after ?? null,
  })))
  return error ? '변경 로그 저장 실패 — 511 마이그레이션을 SQL 편집기에서 실행해주세요.' : null
}

// last_edited_at 표시 갱신 — 511 미적용이면 조용히 무시 (부가 정보)
async function touchLastEdited(admin: SupabaseClient, orderId: string) {
  await admin.from('erp_orders').update({ last_edited_at: new Date().toISOString() }).eq('id', orderId)
}

// 품목 내용 키 — 이 값이 전부 같으면 "변경 없음"으로 보고 행을 보존한다
type AnyRow = Record<string, unknown>
const itemKey = (r: AnyRow) => [
  r.product_id ?? '', r.item_code ?? '', r.item_name ?? '', r.order_kind ?? '',
  r.purchase_vendor_name ?? '', r.sale_price ?? 0, r.quantity ?? 0,
  r.shipping_fee ?? 0, r.discount_amount ?? 0,
  r.purchase_price ?? 0, r.purchase_shipping ?? 0, r.memo ?? '',
].join('|')

const itemBrief = (r: AnyRow) =>
  `${r.item_name ?? ''} ×${r.quantity ?? 0} (판매 ${Number(r.line_total ?? 0).toLocaleString('ko-KR')}원)`

// 헤더 필드 변경 로그 계산
function headerDiffs(
  before: AnyRow,
  after: { orderFields: AnyRow; bankName: string; branchName: string | null },
): { field: string; before?: string | null; after?: string | null }[] {
  const customerOf = (b: unknown, br: unknown) => [b, br].filter(Boolean).join(' ')
  const pairs: [string, unknown, unknown][] = [
    ['주문일', before.order_date, after.orderFields.order_date],
    ['주문처', customerOf(before.bank_name, before.branch_name), customerOf(after.bankName, after.branchName)],
    ['담당자', before.manager_name, after.orderFields.manager_name],
    ['연락처', before.contact, after.orderFields.contact],
    ['핸드폰', before.phone, after.orderFields.phone],
    ['메모', before.memo, after.orderFields.memo],
  ]
  return pairs
    .filter(([, b, a]) => String(b ?? '') !== String(a ?? ''))
    .map(([field, b, a]) => ({ field, before: String(b ?? '') || null, after: String(a ?? '') || null }))
}

// 기존 주문에 수정 내용 반영 (당일 직접 수정)
// 수금 반영분 보존: 기수금액 = 기존 총액 - 기존 미수 → 새 미수 = max(0, 새 총액 - 기수금액)
// 품목은 내용이 같은 행을 보존(발주 링크 유지)하고, 바뀐 행만 취소+새 행 등록한다.
export async function applyOrderEdit(
  admin: SupabaseClient,
  orderId: string,
  input: OrderInput,
  ctx: ApplyContext,
  editor?: Editor,
): Promise<{ error: string } | { warning: string | null }> {
  const snap = await loadOrderSnapshot(admin, orderId)
  if (!snap) return { error: '주문을 찾을 수 없습니다.' }
  const { orderFields, itemRows, total } = buildOrderRows(input, ctx)

  const collected = Math.max(0, (snap.order.total_amount ?? 0) - (snap.order.outstanding_amount ?? 0))
  const outstanding = Math.max(0, total - collected)
  const collectStatus = outstanding === 0 ? 'collected'
    : collected > 0 ? 'in_progress' : snap.order.collect_status

  // 주문처 변경 시 업체/지점 이름·별칭도 갱신
  const names = await resolveVendorNames(admin, input.vendor_id)
  if ('error' in names) return { error: names.error }
  const aliasName = [names.bankName, names.branchName].filter(Boolean).join(' ')
  const aliasId = await ensureAlias(admin, 'customer', aliasName, input.vendor_id)

  const { error: upErr } = await admin.from('erp_orders').update({
    ...orderFields,
    bank_name: names.bankName,
    branch_name: names.branchName,
    customer_alias_id: aliasId,
    outstanding_amount: outstanding,
    collect_status: collectStatus,
  }).eq('id', orderId)
  if (upErr) return { error: `주문 저장 실패: ${upErr.message}` }

  // ── 품목 대사: 내용 키가 같은 행 보존, 나머지 취소+등록 ──
  const existing = (snap.items as AnyRow[]).filter(it => !it.is_canceled)
  const pool = new Map<string, AnyRow[]>()   // key → 기존 행들 (같은 내용 여러 행 허용)
  for (const it of existing) {
    const k = itemKey(it)
    pool.set(k, [...(pool.get(k) ?? []), it])
  }
  const kept: { row: AnyRow; newRow: (typeof itemRows)[number] }[] = []
  const added: (typeof itemRows)[number][] = []
  for (const nr of itemRows) {
    const bucket = pool.get(itemKey(nr))
    const match = bucket?.shift()
    if (match) kept.push({ row: match, newRow: nr })
    else added.push(nr)
  }
  const dropped = Array.from(pool.values()).flat()

  // line_no 유일 제약 회피: 보존 행을 임시 대역(+10000)으로 옮긴 뒤 최종 번호 부여
  for (const { row } of kept) {
    await admin.from('erp_order_items')
      .update({ line_no: Number(row.line_no) + 10000 }).eq('id', row.id as string)
  }
  // 취소 행: 1000번대로 이동 (표시 순서 뒤, 기존 취소 행과 충돌 방지)
  const canceledBase = 1000 + (snap.items as AnyRow[]).filter(it => it.is_canceled).length
  for (let i = 0; i < dropped.length; i++) {
    const { error } = await admin.from('erp_order_items')
      .update({ is_canceled: true, line_no: canceledBase + i, line_outstanding: 0 })
      .eq('id', dropped[i].id as string)
    if (error) return { error: `품목 취소 처리 실패: ${error.message}` }
  }
  for (const { row, newRow } of kept) {
    const { error } = await admin.from('erp_order_items').update({
      line_no: newRow.line_no,
      parent_line_no: newRow.parent_line_no,
      channel: newRow.channel,
      settlement_month: newRow.settlement_month,
    }).eq('id', row.id as string)
    if (error) return { error: `품목 갱신 실패: ${error.message}` }
  }
  if (added.length) {
    const insErr = await insertOrderItems(admin, orderId, added)
    if (insErr) return { error: insErr }
  }

  // ── 변경 로그 + '수정됨' 표시 ──
  let warning: string | null = null
  if (editor) {
    const logs = headerDiffs(snap.order as AnyRow, { orderFields, bankName: names.bankName, branchName: names.branchName })
    for (const d of dropped) logs.push({ field: '품목 취소', before: itemBrief(d), after: null })
    for (const a of added) logs.push({ field: '품목 추가', before: null, after: itemBrief(a as unknown as AnyRow) })
    warning = await writeEditLogs(admin, orderId, editor, logs)
    if (logs.length) await touchLastEdited(admin, orderId)
  }
  return { warning }
}

// 주문 취소 (삭제 대체·재등록 공용) — 품목 전체 취소 + 주문 취소 표시, 미수 0
export async function cancelOrder(
  admin: SupabaseClient,
  orderId: string,
  editor: Editor,
  reason: string | null,
  reissuedTo?: string | null,
): Promise<string | null> {
  const { error: itemErr } = await admin.from('erp_order_items')
    .update({ is_canceled: true, line_outstanding: 0 })
    .eq('order_id', orderId).eq('is_canceled', false)
  if (itemErr) return `품목 취소 실패: ${itemErr.message}`

  const { error } = await admin.from('erp_orders').update({
    canceled_at: new Date().toISOString(),
    canceled_by: editor.employeeId,
    cancel_reason: reason,
    outstanding_amount: 0,
    ...(reissuedTo ? { reissued_to_order_id: reissuedTo } : {}),
  }).eq('id', orderId)
  if (error) {
    return /column|canceled/i.test(error.message)
      ? '511 마이그레이션(취소·재등록)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
      : `주문 취소 실패: ${error.message}`
  }
  await writeEditLogs(admin, orderId, editor, [{
    field: reissuedTo ? '취소 (재등록)' : '취소',
    before: null,
    after: reason,
  }])
  return null
}

// 재등록 주문으로 수금·발주 승계 (원본 → 새 주문)
//  - 기수금액 승계 후 새 미수 재계산
//  - 발주서 order_id 이관, 내용이 같은 품목은 발주 링크 승계 (바뀐 품목은 미발주 표시)
export async function inheritToReissued(
  admin: SupabaseClient,
  origOrder: AnyRow,
  origItems: AnyRow[],
  newOrderId: string,
  newTotal: number,
): Promise<void> {
  const collected = Math.max(0, Number(origOrder.total_amount ?? 0) - Number(origOrder.outstanding_amount ?? 0))
  const outstanding = Math.max(0, newTotal - collected)
  await admin.from('erp_orders').update({
    outstanding_amount: outstanding,
    collect_status: outstanding === 0 ? 'collected' : collected > 0 ? 'in_progress' : 'outstanding',
    reissued_from_order_id: origOrder.id,
  }).eq('id', newOrderId)

  // 발주서 이관
  const { data: pos } = await admin.from('erp_purchase_orders')
    .select('id').eq('order_id', origOrder.id as string)
  if (!pos?.length) return
  await admin.from('erp_purchase_orders')
    .update({ order_id: newOrderId }).eq('order_id', origOrder.id as string)

  // 품목 링크 승계 — 원본 품목 id → 내용 키 → 새 품목 행 매칭
  const { data: newItems } = await admin.from('erp_order_items')
    .select('*').eq('order_id', newOrderId).order('line_no')
  const byKey = new Map<string, AnyRow[]>()
  for (const it of (newItems ?? []) as AnyRow[]) {
    const k = itemKey(it)
    byKey.set(k, [...(byKey.get(k) ?? []), it])
  }
  const origById = new Map(origItems.map(it => [it.id as string, it]))
  const { data: poItems } = await admin.from('erp_purchase_order_items')
    .select('id, order_item_id').in('po_id', pos.map(p => p.id as string))
    .not('order_item_id', 'is', null)
  for (const pi of (poItems ?? []) as AnyRow[]) {
    const orig = origById.get(pi.order_item_id as string)
    if (!orig) continue
    const match = byKey.get(itemKey(orig))?.shift()
    if (match) {
      await admin.from('erp_purchase_order_items')
        .update({ order_item_id: match.id as string }).eq('id', pi.id as string)
    }
  }
}
