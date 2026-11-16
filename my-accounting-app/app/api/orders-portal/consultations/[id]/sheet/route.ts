import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { isOrderAssignee } from '@/lib/order-request'
import { decryptPayment, maskPayment } from '@/lib/payment-crypto'
import { loadBillingFamily } from '@/lib/billing'
import { findRoster } from '@/lib/delivery-roster-server'
import { normalizeSeason } from '@/lib/order-season'
import { honorify } from '@/lib/contact-label'
import { buildConsultSheetExcel, consultSheetFileName, type ConsultSheetData, type ConsultSheetItem } from '@/lib/consult-sheet'
import type { RosterRowInput } from '@/lib/delivery-roster'

export const dynamic = 'force-dynamic'

// 상담일지 출력 양식 엑셀 다운로드 (2026-11-16 사용자 승인 — 시안 docs/mockups/상담일지_출력양식_시안.html)
//  GET ?payment=plain  → 결제정보 평문 포함 (열람 권한자만: 본인 작성분 · can_view_payment_info). 그 외는 마스킹.
//  열람 범위는 상담 상세 GET과 동일(작성자 · 관리자급 · 주문 진행 요청받은 직원, 아르바이트 미연결 차단, 삭제분은 관리자급).
//  다운로드는 erp_consultation_sheet_downloads에 기록 (710 — 미적용이면 기록 없이 진행).

type Row = Record<string, unknown>
const s = (v: unknown) => { const t = String(v ?? '').trim(); return t || null }
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

const canAccess = (c: Row, me: CurrentUser) => isManagerLike(me) || (!!me.employeeId && c.employee_id === me.employeeId)
const canView = (c: Row, me: CurrentUser) => canAccess(c, me) || isOrderAssignee(c, me.employeeId)

const nowKst = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date()).replace(',', '')
const dateKst = (iso: unknown) => {
  if (!iso) return null
  const d = new Date(String(iso))
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d)
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const { data: c } = await admin.from('erp_consultations').select('*').eq('id', params.id).maybeSingle()
  if (!c) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  if (!canView(c, me)) return NextResponse.json({ error: '본인 작성 상담일지(또는 나에게 주문 진행이 요청된 상담)만 받을 수 있습니다.' }, { status: 403 })
  if (me.employmentType === 'parttime' && !(c.vendor_id && c.contact_id)) {
    return NextResponse.json({ error: '아르바이트 계정은 마스터 미연결 상담을 열 수 없습니다. 담당 직원에게 요청해주세요.' }, { status: 403 })
  }
  if (c.deleted_at && !isManagerLike(me)) return NextResponse.json({ error: '삭제된 상담일지입니다.' }, { status: 404 })

  const { data: itemsRaw } = await admin.from('erp_consultation_items').select('*').eq('consultation_id', params.id).order('line_no')
  const items = (itemsRaw ?? []) as Row[]

  // 결제정보 — ERP 열람 규칙: 본인 작성분 또는 결제정보 열람 권한자만 복호화, 평문은 ?payment=plain + 권한
  const isOwner = !!me.employeeId && c.employee_id === me.employeeId
  const canPayment = isOwner || !!me.canViewPaymentInfo
  const wantPlain = new URL(req.url).searchParams.get('payment') === 'plain'
  const paymentPlain = wantPlain && canPayment
  let payment: string | null = null
  if (c.payment_info_enc) {
    if (!canPayment) payment = '(저장됨 — 열람 권한 없음)'
    else {
      const plain = decryptPayment(String(c.payment_info_enc))
      payment = plain === null ? '(복호화 실패)' : paymentPlain ? plain : maskPayment(plain)
    }
  }

  // 이름들: 작성자 · 주문 진행 담당 · 종결자 · 상담자(= 고객의 다올 담당, 112)
  const ids = [c.employee_id, c.order_assignee_id, c.closed_by].filter(Boolean) as string[]
  let staffId: string | null = null
  if (c.contact_id && c.vendor_id) {
    const { data: asg } = await admin.from('contact_assignments').select('staff_employee_id')
      .eq('contact_id', c.contact_id).eq('vendor_id', c.vendor_id).is('ended_at', null).limit(1).maybeSingle()
    staffId = (asg?.staff_employee_id as string | null) ?? null   // 112 미적용이면 error → null
    if (staffId) ids.push(staffId)
  }
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: emps } = await admin.from('employees').select('id, name').in('id', Array.from(new Set(ids)))
    for (const e of emps ?? []) names.set(e.id as string, e.name as string)
  }
  const nameOf = (id: unknown) => (id ? names.get(String(id)) ?? null : null)

  // 전환된 주문 · 청구처 · 배송명단 — 병렬
  const [ordersRes, billing, rosterRes] = await Promise.all([
    admin.from('erp_orders').select('order_no, staff_name, canceled_at').eq('consultation_id', params.id).order('order_date', { ascending: false }),
    c.vendor_id ? loadBillingFamily(admin, String(c.vendor_id)).catch(() => null) : Promise.resolve(null),
    findRoster(admin, { consultationId: params.id }).catch(() => ({ roster: null, error: null })),
  ])
  const orders = ((ordersRes.data ?? []) as Row[]).filter(o => !o.canceled_at)
  let rosterRows: RosterRowInput[] | null = null
  if (rosterRes.roster) {
    const { data: rr } = await admin.from('erp_delivery_roster_rows').select('*').eq('roster_id', rosterRes.roster.id).order('seq').limit(5000)
    rosterRows = (rr ?? []) as unknown as RosterRowInput[]
  }

  const orderProgress = orders.length
    ? `${Array.from(new Set(orders.map(o => s(o.staff_name)).filter(Boolean))).join(', ') || '-'} (주문 입력)`
    : c.order_assignee_id ? `${nameOf(c.order_assignee_id) ?? ''} (요청)` : null

  const seasons = Array.from(new Set(items.map(it => normalizeSeason(s(it.order_season))).filter(Boolean)))
  const season = seasons.length === 0 ? normalizeSeason(null) : seasons.length === 1 ? seasons[0] : `${seasons[0]} 외`

  const sheetItems: ConsultSheetItem[] = items.map(it => ({
    line_no: n(it.line_no), parent_line_no: it.parent_line_no ? n(it.parent_line_no) : null, is_shipping: it.is_shipping === true,
    item_code: s(it.item_code), order_kind: s(it.order_kind), item_name: s(it.item_name),
    quantity: n(it.quantity), sale_price: n(it.sale_price),
    discount_amount: n(it.discount_amount), discount_mode: s(it.discount_mode), discount_unit: n(it.discount_unit),
    line_total: n(it.line_total),
    purchase_price: n(it.purchase_price), purchase_shipping: n(it.purchase_shipping),
    purchase_discount: n(it.purchase_discount), purchase_discount_mode: s(it.purchase_discount_mode), purchase_discount_unit: n(it.purchase_discount_unit),
    // purchase_total 컬럼이 없는(구) 환경 대비 — 708 정의로 재계산
    purchase_total: it.purchase_total != null ? n(it.purchase_total) : n(it.purchase_price) * n(it.quantity) + n(it.purchase_shipping) - n(it.purchase_discount),
    status: s(it.status), memo: s(it.memo), option_note: s(it.option_note),
  }))

  const hasShip = ['ship_name', 'ship_phone', 'ship_zip', 'ship_addr1', 'ship_addr2'].some(k => s(c[k]))
  const data: ConsultSheetData = {
    status: String(c.status ?? '진행중'),
    order_nos: orders.map(o => String(o.order_no ?? '')).filter(Boolean),
    closed: c.status === '종결' ? { by: nameOf(c.closed_by), at: dateKst(c.closed_at), reason: s(c.close_reason) } : null,
    consult_date: String(c.consult_date ?? ''),
    consult_type: String(c.consult_type ?? ''),
    season,
    writer: nameOf(c.employee_id),
    counselor: nameOf(staffId),
    order_progress: orderProgress,
    bank_name: s(c.bank_name), branch_name: s(c.branch_name),
    manager_name: honorify(s(c.manager_name)) || null,
    tel: s(c.tel), phone: s(c.phone),
    billing_name: billing?.billing?.name ?? null,
    items: sheetItems,
    sender_name: s(c.sender_name), delivery_request: s(c.delivery_request), greeting_card: s(c.greeting_card),
    address_checked: s(c.address_checked), roster_method: s(c.roster_method),
    ship: hasShip ? {
      ship_name: s(c.ship_name), ship_phone: s(c.ship_phone), ship_zip: s(c.ship_zip), ship_addr1: s(c.ship_addr1), ship_addr2: s(c.ship_addr2),
    } : null,
    payment, payment_plain: paymentPlain,
    invoice_email: s(c.invoice_email), fax: s(c.fax), biz_number: s(c.biz_number), ceo_name: s(c.ceo_name),
    prepay: items.some(it => s(it.item_name) === '선결제'),
    memo: s(c.memo),
    printed_by: me.employeeName ?? null,
    printed_at: nowKst(),
    roster_rows: rosterRows,
  }

  // 다운로드 기록 (710) — 미적용이면 조용히 건너뜀
  await admin.from('erp_consultation_sheet_downloads')
    .insert({ consultation_id: params.id, employee_id: me.employeeId, payment_plain: paymentPlain })

  const buf = await buildConsultSheetExcel(data)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(consultSheetFileName(data))}`,
    },
  })
}
