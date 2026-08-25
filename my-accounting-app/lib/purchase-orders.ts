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
  // 판매가 발주 매입처(요아럽 — vendors.po_use_sale_price)의 스냅샷 원천
  sale_price: number | null
  shipping_fee: number | null
  line_total: number | null
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
    .select('id, line_no, parent_line_no, is_canceled, item_code, item_name, order_kind, purchase_vendor_name, purchase_alias_id, quantity, purchase_price, purchase_shipping, purchase_total, sale_price, shipping_fee, line_total, memo')
    .eq('order_id', orderId).order('line_no')
  if (iErr) return { error: iErr.message }

  // 유효 발주서 + 품목 연결
  const { data: pos, error: pErr } = await admin.from('erp_purchase_orders')
    .select('id, po_no, vendor_name, vendor_id, purchase_alias_id, total_amount, send_method, sent_at, send_error, email_to, status, created_at, sender:employees!erp_purchase_orders_sent_by_fkey(name)')
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

  // 매입처 정보 (별칭 → vendors: 이메일·결제방식·자체양식·판매가 발주)
  // 발주서에 담긴 매입처(기발주분 배지용)도 포함해 조회한다
  const aliasIds = Array.from(new Set([
    ...(items ?? []).map(it => it.purchase_alias_id),
    ...(pos ?? []).map(p => p.purchase_alias_id as string | null),
  ].filter(Boolean))) as string[]
  const vendorInfo = new Map<string, { vendor_id: string | null; email: string | null; payment_term: string | null; uses_custom_po: boolean; po_use_sale_price: boolean }>()
  if (aliasIds.length) {
    // po_use_sale_price는 509 — 미적용 환경이면 해당 컬럼 없이 재조회
    let aliases = await admin.from('erp_vendor_aliases')
      .select('id, payment_term, vendor_id, vendors(id, email, uses_custom_po, po_use_sale_price)' as string)
      .in('id', aliasIds)
    if (aliases.error && /po_use_sale_price/i.test(aliases.error.message)) {
      aliases = await admin.from('erp_vendor_aliases')
        .select('id, payment_term, vendor_id, vendors(id, email, uses_custom_po)' as string)
        .in('id', aliasIds)
    }
    for (const a of (aliases.data ?? []) as unknown as Record<string, unknown>[]) {
      const v = a.vendors as { id: string; email: string | null; uses_custom_po: boolean; po_use_sale_price?: boolean } | null
      vendorInfo.set(a.id as string, {
        vendor_id: v?.id ?? null,
        email: v?.email ?? null,
        payment_term: (a.payment_term as string) ?? null,
        uses_custom_po: v?.uses_custom_po ?? false,
        po_use_sale_price: v?.po_use_sale_price ?? false,
      })
    }
  }

  const deliveryNote = await buildDeliveryNote(admin, order)
  return { order, items: items ?? [], pos: pos ?? [], poItemMap, vendorInfo, deliveryNote }
}

// ── 발주서 엑셀 (다올커머스 발주서 — 2026-08-24 영업지원팀 개정 양식) ─────
// 시트 2장: '발주서'(명세 — 발주번호 헤더·품목 6열·택배비 행·합계) +
// '배송명단'(수령인별 배송 리스트 — 아는 값 프리필, 주소 등은 수기 보완).
// 셀 값·순서·색 정의는 lib/po-form.ts 공용 (화면 미리보기와 항상 동일해야 함)
import {
  COMPANY_NAME, PO_COLORS, PO_HEADERS, ROSTER_HEADERS,
  poFormInfo, poFormItemRows, poRosterRows, type PoExcelData,
} from './po-form'
export type { PoExcelData } from './po-form'

const FONT = '맑은 고딕'
const argb = (hex: string) => `FF${hex}`

export async function buildPoExcel(po: PoExcelData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const thin = { style: 'thin' as const }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const fill = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(hex) } })
  // 줄바꿈 미사용 기준 (사용자 확정 2026-08-25) — 대신 열 너비를 내용에 맞춰 확보
  const center = { horizontal: 'center' as const, vertical: 'middle' as const }
  // 날짜 칸은 원본과 동일하게 날짜 값 + mm-dd-yy 서식 (파싱 불가한 자유 표기는 문자열 유지)
  const asDate = (s: string | null) => {
    if (!s) return ''
    const d = new Date(`${s}T00:00:00+09:00`)
    return Number.isNaN(d.getTime()) ? s : d
  }

  // ── 시트1: 발주서 (명세) ────────────────────────────
  const ws = wb.addWorksheet('발주서', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  // 열 폭 — 원본 기준 + F~H는 전화번호·날짜가 줄바꿈 없이 들어가게 확대
  // (사용자 확정 2026-08-25: 줄바꿈 미사용 기준으로 폭 조정)
  ws.columns = [
    { width: 5.62 }, { width: 12.62 }, { width: 19.5 }, { width: 4.75 },
    { width: 12.62 }, { width: 13.5 }, { width: 13.5 }, { width: 13.5 },
  ]

  // 제목 (원본: 검정 17pt 굵게, 행 높이 63.75)
  ws.mergeCells('A1:H1')
  ws.getRow(1).height = 63.75
  const title = ws.getCell('A1')
  title.value = `${COMPANY_NAME} 발주서`
  title.font = { name: FONT, size: 17, bold: true, color: { argb: argb(PO_COLORS.title) } }
  title.alignment = center

  // 헤더 정보 (2~4행): [A:B 라벨, C:D 값] + [E 라벨, F 값] + [G 라벨, H 값]
  // 발주번호가 맨 위, 출고요청일 라벨은 노란 배경·파란 글씨 (사용자 확정)
  const info = poFormInfo(po)
  const infoRanges: [string, string][] = [
    ['A2:B2', 'C2:D2'], ['E2', 'F2'], ['G2', 'H2'],
    ['A3:B3', 'C3:D3'], ['E3', 'F3'], ['G3', 'H3'],
    ['A4:B4', 'C4:D4'], ['E4', 'F4'], ['G4', 'H4'],
  ]
  infoRanges.forEach(([labelRange, valueRange], i) => {
    const cell = info[i]
    if (labelRange.includes(':')) ws.mergeCells(labelRange)
    if (valueRange.includes(':')) ws.mergeCells(valueRange)
    const lc = ws.getCell(labelRange.split(':')[0])
    lc.value = cell.label
    lc.font = {
      name: FONT, size: 10, bold: true,
      color: { argb: argb(cell.accent ? PO_COLORS.accentInk : PO_COLORS.label) },
    }
    lc.fill = fill(cell.accent ? PO_COLORS.accentBg : PO_COLORS.labelBg)
    lc.alignment = center
    const vc = ws.getCell(valueRange.split(':')[0])
    const isDate = cell.label === '주문일' || cell.label === '출고요청일'
    vc.value = isDate ? asDate(cell.value as string | null) : (cell.value ?? '')
    if (isDate && vc.value instanceof Date) vc.numFmt = 'mm-dd-yy'
    vc.font = { name: FONT, size: 10, bold: !!cell.bold, color: { argb: argb(PO_COLORS.ink) } }
    vc.alignment = center
  })
  for (let r = 2; r <= 4; r++) ws.getRow(r).height = 30

  // 품목 표 헤더 (5행, 원본: 남색 배경·흰 글씨): NO | 제품명(B:C) | 수량 | 단가 | 금액 | 비고(G:H)
  ws.getRow(5).height = 30
  ws.mergeCells('B5:C5')
  ws.mergeCells('G5:H5')
  const headerCells = ['A5', 'B5', 'D5', 'E5', 'F5', 'G5']
  PO_HEADERS.forEach((label, i) => {
    const cell = ws.getCell(headerCells[i])
    cell.value = label
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: argb(PO_COLORS.itemHeadInk) } }
    cell.fill = fill(PO_COLORS.itemHeadBg)
    cell.alignment = center
  })

  // 품목 행 — 원본은 6~15행 고정 10행 (빈 행도 서식 유지), 초과 시 확장.
  // 수량 빨간 글씨, 비고 파란 글씨, 금액은 원본과 같은 수식(=단가×수량 — 값이
  // 다르면(할인 등) 값으로 기재), 택배비는 별도 행(poFormItemRows에서 분리)
  const rows = poFormItemRows(po)
  const itemRowCount = Math.max(rows.length, 10)
  for (let i = 0; i < itemRowCount; i++) {
    const r = 6 + i
    ws.getRow(r).height = 30
    ws.mergeCells(`B${r}:C${r}`)
    ws.mergeCells(`G${r}:H${r}`)
    const values = rows[i]
    const cells = [`A${r}`, `B${r}`, `D${r}`, `E${r}`, `F${r}`, `G${r}`]
    cells.forEach((addr, ci) => {
      const cell = ws.getCell(addr)
      const v = values ? values[ci] : ''
      if (ci === 4 && values) {
        // 금액 = 단가×수량 수식 (원본 방식) — 어긋나면 값으로
        const qty = Number(values[2]) || 0
        const price = Number(values[3]) || 0
        cell.value = qty * price === Number(v)
          ? ({ formula: `E${r}*D${r}`, result: Number(v) } as import('exceljs').CellFormulaValue)
          : Number(v)
      } else {
        cell.value = v
      }
      cell.font = {
        name: FONT, size: 10,
        color: { argb: argb(ci === 2 ? PO_COLORS.qtyInk : ci === 5 ? PO_COLORS.noteInk : PO_COLORS.ink) },
      }
      cell.alignment = center
      if (ci === 3 || ci === 4) cell.numFmt = '#,##0'
    })
  }

  // 합계 행: A:F 라벨 + G:H 값 (연주황 배경·붉은 굵은 글씨, 금액 열 SUM 수식)
  const totalRow = 6 + itemRowCount
  ws.getRow(totalRow).height = 30
  ws.mergeCells(`A${totalRow}:F${totalRow}`)
  ws.mergeCells(`G${totalRow}:H${totalRow}`)
  const tl = ws.getCell(`A${totalRow}`)
  tl.value = '합계금액(vat포함)'
  tl.font = { name: FONT, size: 10, bold: true, color: { argb: argb(PO_COLORS.label) } }
  tl.fill = fill(PO_COLORS.labelBg)
  tl.alignment = center
  const tv = ws.getCell(`G${totalRow}`)
  tv.value = { formula: `SUM(F6:F${totalRow - 1})`, result: po.total_amount } as import('exceljs').CellFormulaValue
  tv.font = { name: FONT, size: 10, bold: true, color: { argb: argb(PO_COLORS.totalInk) } }
  tv.fill = fill(PO_COLORS.totalBg)
  tv.alignment = center
  tv.numFmt = '#,##0'

  // 표 전체 테두리 (제목 포함 — 원본과 동일)
  for (let r = 1; r <= totalRow; r++) {
    for (let c = 1; c <= 8; c++) ws.getCell(r, c).border = box
  }

  // ── 시트2: 배송명단 ─────────────────────────────────
  const ws2 = wb.addWorksheet('배송명단', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws2.columns = [
    { width: 4.62 }, { width: 20.62 }, { width: 15.62 }, { width: 14 }, { width: 50.62 },
    { width: 15.62 }, { width: 40.62 }, { width: 10.62 }, { width: 30.62 },
  ]
  ROSTER_HEADERS.forEach((label, i) => {
    const cell = ws2.getCell(1, i + 1)
    cell.value = label
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: argb(PO_COLORS.label) } }
    cell.fill = fill(PO_COLORS.labelBg)
    cell.alignment = center
  })
  poRosterRows(po).forEach((values, i) => {
    const r = 2 + i
    values.forEach((v, ci) => {
      const cell = ws2.getCell(r, ci + 1)
      cell.value = v
      cell.font = { name: FONT, size: 10, color: { argb: argb(PO_COLORS.ink) } }
      // 주소만 좌측 정렬 (원본과 동일), 나머지 가운데 — 줄바꿈 미사용
      cell.alignment = ci === 4
        ? { horizontal: 'left', vertical: 'middle' }
        : center
    })
  })
  const rosterLast = 1 + poRosterRows(po).length
  for (let r = 1; r <= rosterLast; r++) {
    for (let c = 1; c <= 9; c++) ws2.getCell(r, c).border = box
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// 네이버 SMTP 발송 (NAVER_SMTP_USER/PASS, PO_CC_EMAIL 환경변수)
export function smtpReady() {
  return !!process.env.NAVER_SMTP_USER?.trim() && !!process.env.NAVER_SMTP_PASS?.trim()
}

// 네이버 SMTP 인증 계정은 "아이디만" 받는다 (id@naver.com을 넣으면 535 인증 실패).
// 환경변수에 전체 주소를 넣어도 동작하도록 도메인을 떼고, 앞뒤 공백도 정리한다.
// 발신 주소(from)는 반대로 항상 전체 주소여야 한다.
function naverAccount() {
  const raw = (process.env.NAVER_SMTP_USER ?? '').trim()
  const id = raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw
  return { id, from: `${id}@naver.com`, pass: (process.env.NAVER_SMTP_PASS ?? '').trim() }
}

export async function sendPoMail(opts: {
  to: string
  subject: string
  body: string
  attachments: { filename: string; content: Buffer }[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smtpReady()) {
    return { ok: false, error: 'SMTP 환경변수(NAVER_SMTP_USER/NAVER_SMTP_PASS)가 설정되지 않았습니다. Vercel 환경변수 등록 후 사용 가능합니다.' }
  }
  const { id, from, pass } = naverAccount()
  try {
    const nodemailer = (await import('nodemailer')).default
    const transporter = nodemailer.createTransport({
      host: 'smtp.naver.com',
      port: 465,
      secure: true,
      auth: { user: id, pass },
    })
    await transporter.sendMail({
      from,
      to: opts.to,
      cc: process.env.PO_CC_EMAIL || undefined,   // 백업 CC — 보낸메일함 미보존 보완
      subject: opts.subject,
      text: opts.body,
      attachments: opts.attachments,
    })
    return { ok: true }
  } catch (e) {
    const raw = e instanceof Error ? e.message : '발송 실패'
    // 네이버 인증 거부(535)는 설정 문제라 원인 안내를 덧붙인다
    if (/535|Invalid login|not accepted/i.test(raw)) {
      return {
        ok: false,
        error: `네이버 로그인 거부 (${id} 계정). 확인: (1) 네이버 메일 환경설정 > POP3/IMAP 설정에서 "IMAP/SMTP 사용함" (2) 2단계 인증 사용 중이면 로그인 비밀번호가 아닌 "애플리케이션 비밀번호" (3) NAVER_SMTP_USER는 아이디만`,
      }
    }
    return { ok: false, error: raw }
  }
}
