import type { SupabaseClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

// 발주서 공용 로직 (3단계 — 주문 단위 발주)
// 발주서 1장 = 주문 1건 × 매입처 1곳. 품목 연결로 중복 발주를 막고
// 스냅샷으로 발주 시점 내용을 보존한다. 상세 설계: docs/order-system-track.md

export const PO_MIGRATION_HINT =
  '507 마이그레이션(발주서)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

export interface OrderItemRow {
  id: string
  line_no: number
  parent_line_no: number | null
  is_canceled: boolean
  item_code: string | null
  item_name: string | null
  order_kind: string | null
  purchase_vendor_name: string | null
  purchase_alias_id: string | null
  quantity: number | null
  purchase_price: number | null
  purchase_shipping: number | null
  purchase_total: number | null
  memo: string | null
}

// POyymmdd-## 발번 (같은 날짜 내 순번)
export async function nextPoNo(admin: SupabaseClient): Promise<string> {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const prefix = `PO${today.slice(2).replace(/-/g, '')}-`
  const { data } = await admin.from('erp_purchase_orders')
    .select('po_no').like('po_no', `${prefix}%`)
    .order('po_no', { ascending: false }).limit(1)
  const last = data?.[0]?.po_no as string | undefined
  const seq = last ? parseInt(last.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(2, '0')}`
}

// 배송 참고 취합: 주문 메모 + 연결된 상담일지의 발송 정보
export async function buildDeliveryNote(
  admin: SupabaseClient,
  order: { memo?: string | null; consultation_id?: string | null },
): Promise<string | null> {
  const parts: string[] = []
  if (order.memo) parts.push(order.memo)
  if (order.consultation_id) {
    const { data: c } = await admin.from('erp_consultations')
      .select('delivery_request, greeting_card, sender_name, roster_method, option_note')
      .eq('id', order.consultation_id).maybeSingle()
    if (c) {
      if (c.delivery_request) parts.push(`배송요청일 ${c.delivery_request}`)
      if (c.greeting_card) parts.push(`인사장·명함 ${c.greeting_card}`)
      if (c.sender_name) parts.push(`보내는분 ${c.sender_name}`)
      if (c.roster_method) parts.push(`고객명단 ${c.roster_method}`)
      if (c.option_note) parts.push(c.option_note)
    }
  }
  return parts.length ? parts.join(' · ') : null
}

// 주문의 발주 섹션 데이터: 매입처별 품목 묶음 + 발주 상태 + 매입처 정보
export async function loadPurchaseSection(admin: SupabaseClient, orderId: string) {
  const { data: order, error: oErr } = await admin.from('erp_orders')
    .select('id, order_no, source, memo, consultation_id')
    .eq('id', orderId).maybeSingle()
  if (oErr || !order) return { error: '주문을 찾을 수 없습니다.' }

  const { data: items, error: iErr } = await admin.from('erp_order_items')
    .select('id, line_no, parent_line_no, is_canceled, item_code, item_name, order_kind, purchase_vendor_name, purchase_alias_id, quantity, purchase_price, purchase_shipping, purchase_total, memo')
    .eq('order_id', orderId).order('line_no')
  if (iErr) return { error: iErr.message }

  // 유효 발주서 + 품목 연결
  const { data: pos, error: pErr } = await admin.from('erp_purchase_orders')
    .select('id, po_no, vendor_name, vendor_id, total_amount, send_method, sent_at, send_error, email_to, status, created_at, sender:employees!erp_purchase_orders_sent_by_fkey(name)')
    .eq('order_id', orderId).order('created_at')
  if (pErr) {
    const missing = /relation|erp_purchase_orders|does not exist/i.test(pErr.message)
    return { error: missing ? PO_MIGRATION_HINT : pErr.message }
  }
  const activePos = (pos ?? []).filter(p => p.status === 'active')
  const poItemMap = new Map<string, string>()   // order_item_id → po_id
  if (activePos.length) {
    const { data: poItems } = await admin.from('erp_purchase_order_items')
      .select('po_id, order_item_id').in('po_id', activePos.map(p => p.id))
    for (const pi of poItems ?? []) {
      if (pi.order_item_id) poItemMap.set(pi.order_item_id as string, pi.po_id as string)
    }
  }

  // 매입처 정보 (별칭 → vendors: 이메일·결제방식·자체양식)
  const aliasIds = Array.from(new Set((items ?? []).map(it => it.purchase_alias_id).filter(Boolean))) as string[]
  const vendorInfo = new Map<string, { vendor_id: string | null; email: string | null; payment_term: string | null; uses_custom_po: boolean }>()
  if (aliasIds.length) {
    const { data: aliases } = await admin.from('erp_vendor_aliases')
      .select('id, payment_term, vendor_id, vendors(id, email, uses_custom_po)')
      .in('id', aliasIds)
    for (const a of aliases ?? []) {
      const v = a.vendors as unknown as { id: string; email: string | null; uses_custom_po: boolean } | null
      vendorInfo.set(a.id as string, {
        vendor_id: v?.id ?? null,
        email: v?.email ?? null,
        payment_term: (a.payment_term as string) ?? null,
        uses_custom_po: v?.uses_custom_po ?? false,
      })
    }
  }

  const deliveryNote = await buildDeliveryNote(admin, order)
  return { order, items: items ?? [], pos: pos ?? [], poItemMap, vendorInfo, deliveryNote }
}

// 발주서 표준 엑셀 (자사 양식 실물 수령 전 임시 양식)
export function buildPoExcel(po: {
  po_no: string
  vendor_name: string
  created_at: string
  delivery_note: string | null
  order_no: string | null
  customer: string
  items: { item_code: string | null; item_name: string | null; order_kind: string | null; quantity: number; purchase_price: number; purchase_shipping: number; purchase_total: number; memo: string | null }[]
}): Buffer {
  const total = po.items.reduce((s, it) => s + (it.purchase_total ?? 0), 0)
  const aoa: (string | number | null)[][] = [
    ['발  주  서'],
    [],
    ['발주번호', po.po_no, null, '발주일', po.created_at.slice(0, 10)],
    ['매입처', po.vendor_name, null, '발주사', '다올'],
    ['주문번호', po.order_no ?? '', null, '납품처(주문처)', po.customer],
    [],
    ['NO', '품번', '품명', '구분', '수량', '매입단가', '매입배송비', '합계금액', '비고'],
    ...po.items.map((it, i) => [
      i + 1, it.item_code ?? '', it.item_name ?? '', it.order_kind ?? '',
      it.quantity ?? 0, it.purchase_price ?? 0, it.purchase_shipping ?? 0,
      it.purchase_total ?? 0, it.memo ?? '',
    ]),
    [null, null, null, null, null, null, '합계', total, null],
    [],
    ['배송 참고', po.delivery_note ?? ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 5 }, { wch: 13 }, { wch: 42 }, { wch: 7 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 24 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '발주서')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// 네이버 SMTP 발송 (NAVER_SMTP_USER/PASS, PO_CC_EMAIL 환경변수)
export function smtpReady() {
  return !!process.env.NAVER_SMTP_USER && !!process.env.NAVER_SMTP_PASS
}

export async function sendPoMail(opts: {
  to: string
  subject: string
  body: string
  attachName: string
  attachBuffer: Buffer
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smtpReady()) {
    return { ok: false, error: 'SMTP 환경변수(NAVER_SMTP_USER/NAVER_SMTP_PASS)가 설정되지 않았습니다. Vercel 환경변수 등록 후 사용 가능합니다.' }
  }
  try {
    const nodemailer = (await import('nodemailer')).default
    const transporter = nodemailer.createTransport({
      host: 'smtp.naver.com',
      port: 465,
      secure: true,
      auth: { user: process.env.NAVER_SMTP_USER, pass: process.env.NAVER_SMTP_PASS },
    })
    const from = process.env.NAVER_SMTP_USER!.includes('@')
      ? process.env.NAVER_SMTP_USER!
      : `${process.env.NAVER_SMTP_USER}@naver.com`
    await transporter.sendMail({
      from,
      to: opts.to,
      cc: process.env.PO_CC_EMAIL || undefined,   // 백업 CC — 보낸메일함 미보존 보완
      subject: opts.subject,
      text: opts.body,
      attachments: [{ filename: opts.attachName, content: opts.attachBuffer }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '발송 실패' }
  }
}
