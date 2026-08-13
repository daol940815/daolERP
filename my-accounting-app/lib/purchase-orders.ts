import type { SupabaseClient } from '@supabase/supabase-js'

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

// ── 발주서 엑셀 (자사 양식 — 2026-08-13 실물 파일 재현) ─────────────
// 양식 원본: 발주서(데이터) 시트 1장. 상단 정보 그리드(발주번호·주문일·출고요청일·
// 공급처·주문처·담당자·총액) + 품목 표(발송인~송장번호 15열, 가로 인쇄).
// 골드색 열(발송인·수령인·주소·배송메모·송장번호)은 배송 관련 수기 보완란 —
// ERP가 아는 값은 미리 채우고 나머지는 비워 보낸다 (송장번호는 매입처 기입).

const COMPANY_NAME = '다올커머스'
const COMPANY_PHONE = '070-7007-4582'   // 발송인·발주자 연락처 (양식 원본 값)

// 양식 색상 (원본에서 추출)
const C = {
  navy: 'FF1F2A44', gold: 'FFC0810A', labelBg: 'FFEEF2F7', totalBg: 'FFFDECC8',
  goldRowBg: 'FFFFF7E6', ink: 'FF111827', label: 'FF334155', totalInk: 'FFB00020',
  white: 'FFFFFFFF',
}
const FONT = '맑은 고딕'

export interface PoExcelData {
  po_no: string
  order_date: string | null        // 주문일
  ship_request: string | null      // 출고요청일 (상담일지 배송요청일)
  vendor_name: string              // 공급처(매입처)
  vendor_phone: string | null      // 공급처 연락처 (매입처 마스터)
  delivery_kind: string | null     // 배송구분 (품목 구분에서 판정)
  customer: string                 // 주문처(거래처)
  customer_manager: string | null  // 주문처 담당자 (고객처 담당자 — 주문의 거래처 담당자)
  customer_phone: string | null    // 주문처 연락처 (고객처 담당자 연락처)
  staff_name: string | null        // 발주 담당자 (발주서 작성자)
  staff_phone: string | null       // 발주자 연락처 (작성자 직원 연락처, 없으면 회사 번호)
  total_amount: number
  delivery_note: string | null     // 배송메모 (첫 품목 행에 기재)
  items: {
    item_code: string | null; item_name: string | null; order_kind: string | null
    quantity: number; purchase_price: number; purchase_shipping: number
    purchase_total: number; memo: string | null
  }[]
}

export async function buildPoExcel(po: PoExcelData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('발주서(데이터)', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = [
    { width: 5 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 13 },
    { width: 8 }, { width: 22 }, { width: 18 }, { width: 9 }, { width: 5 },
    { width: 8 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 15 },
  ]

  const thin = { style: 'thin' as const }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const fill = (rgb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: rgb } })

  // 제목
  ws.mergeCells('A1:O1')
  ws.getRow(1).height = 42
  const title = ws.getCell('A1')
  title.value = `${COMPANY_NAME} 발주서`
  title.font = { name: FONT, size: 20, bold: true, color: { argb: C.navy } }
  title.alignment = { horizontal: 'center', vertical: 'middle' }

  // 정보 그리드 (2~5행): [라벨 병합, 값 병합, 값] × 3열 구성
  const info: [string, string, string, string | number | null][] = [
    ['A2:B2', 'C2:E2', '발주번호', po.po_no],
    ['F2:G2', 'H2:J2', '주문일', po.order_date],
    ['K2:L2', 'M2:O2', '출고요청일', po.ship_request],
    ['A3:B3', 'C3:E3', '공급처(매입처)', po.vendor_name],
    ['F3:G3', 'H3:J3', '공급처 연락처', po.vendor_phone],
    ['K3:L3', 'M3:O3', '배송구분', po.delivery_kind],
    ['A4:B4', 'C4:E4', '주문처(거래처)', po.customer],
    ['F4:G4', 'H4:J4', '주문처 담당자', po.customer_manager],
    ['K4:L4', 'M4:O4', '주문처 연락처', po.customer_phone],
    ['A5:B5', 'C5:E5', '발주 담당자', po.staff_name],
    ['F5:G5', 'H5:J5', '발주자 연락처', po.staff_phone || COMPANY_PHONE],
    ['K5:L5', 'M5:O5', '총 합계금액 (VAT 포함)', po.total_amount],
  ]
  for (let r = 2; r <= 5; r++) ws.getRow(r).height = r === 5 ? 26 : 24
  for (const [labelRange, valueRange, label, value] of info) {
    ws.mergeCells(labelRange)
    ws.mergeCells(valueRange)
    const lc = ws.getCell(labelRange.split(':')[0])
    lc.value = label
    lc.font = { name: FONT, size: 10, bold: true, color: { argb: C.label } }
    lc.fill = fill(C.labelBg)
    lc.alignment = { horizontal: 'center', vertical: 'middle' }
    const vc = ws.getCell(valueRange.split(':')[0])
    vc.value = value ?? ''
    vc.font = { name: FONT, size: 10, color: { argb: C.ink } }
    vc.alignment = { horizontal: 'left', vertical: 'middle' }
    // 발주번호·배송구분은 원본과 같이 굵게
    if (label === '발주번호' || label === '배송구분') vc.font = { ...vc.font, bold: true }
  }
  // 총액 칸은 강조 (원본: 진한 글씨·연주황 배경·"원" 표기, 품목 합계 수식)
  const totalCell = ws.getCell('M5')
  totalCell.font = { name: FONT, size: 12, bold: true, color: { argb: C.totalInk } }
  totalCell.fill = fill(C.totalBg)
  totalCell.alignment = { horizontal: 'right', vertical: 'middle' }
  totalCell.numFmt = '#,##0 "원"'
  if (po.items.length) {
    totalCell.value = {
      formula: `SUM(L7:L${6 + po.items.length})`,
      result: po.total_amount,
    } as import('exceljs').CellFormulaValue
  }

  // 품목 표 헤더 (6행) — 남색: 발주 내용 / 골드: 배송 수기 보완란
  const headers: [string, 'navy' | 'gold'][] = [
    ['NO', 'navy'], ['발송인', 'gold'], ['발송인 연락처', 'gold'], ['수령인', 'gold'],
    ['수령인 연락처', 'gold'], ['우편번호', 'gold'], ['배송지 주소', 'gold'],
    ['제품명', 'navy'], ['규격/옵션', 'navy'], ['수량', 'navy'], ['단가', 'navy'],
    ['합계', 'navy'], ['비고', 'navy'], ['배송메모', 'gold'], ['송장번호', 'gold'],
  ]
  ws.getRow(6).height = 30
  headers.forEach(([label, tone], i) => {
    const cell = ws.getCell(6, i + 1)
    cell.value = label
    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: C.white } }
    cell.fill = fill(tone === 'navy' ? C.navy : C.gold)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  // 품목 행 — 골드 열(B~G, N, O)은 연한 골드 배경으로 수기란 표시
  const GOLD_COLS = new Set([2, 3, 4, 5, 6, 7, 14, 15])
  po.items.forEach((it, i) => {
    const r = 7 + i
    ws.getRow(r).height = 30
    // 합계(purchase_total)에는 매입배송비가 포함 — 단가×수량과 다르면 비고에 명시
    const noteParts: string[] = []
    if (it.memo) noteParts.push(it.memo)
    if ((it.purchase_shipping ?? 0) > 0) noteParts.push(`배송비 ${it.purchase_shipping.toLocaleString('ko-KR')}원 포함`)
    const values: (string | number | null)[] = [
      i + 1,
      COMPANY_NAME, COMPANY_PHONE,
      po.customer_manager ?? '', po.customer_phone ?? '',
      '', '',                                    // 우편번호·배송지 주소 — 수기 기입
      it.item_name ?? '', it.item_code ?? '',
      it.quantity ?? 0, it.purchase_price ?? 0, it.purchase_total ?? 0,
      noteParts.join(' · '),                     // 비고 (품목 메모·배송비 포함 표기)
      i === 0 ? po.delivery_note ?? '' : '',     // 배송메모 — 주문의 배송 참고를 첫 행에
      '',                                        // 송장번호 — 매입처 기입
    ]
    values.forEach((v, ci) => {
      const cell = ws.getCell(r, ci + 1)
      cell.value = v
      cell.font = { name: FONT, size: 9.5, color: { argb: C.ink } }
      const right = ci >= 9 && ci <= 11
      cell.alignment = {
        horizontal: ci === 0 || ci === 5 ? 'center' : right ? 'right' : 'left',
        vertical: 'middle', wrapText: true,
      }
      if (right) cell.numFmt = '#,##0'
      if (GOLD_COLS.has(ci + 1)) cell.fill = fill(C.goldRowBg)
    })
  })

  // 표 전체 테두리 (정보 그리드 + 품목 표)
  const lastRow = 6 + Math.max(po.items.length, 1)
  for (let r = 2; r <= lastRow; r++) {
    for (let c = 1; c <= 15; c++) ws.getCell(r, c).border = box
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
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
