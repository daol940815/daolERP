// 업체 발주서 양식 엔진 (516, 2026-11-09 사용자 확정 — 계획 https://claude.ai/artifact/TR7A4WSjHo4qWybgCQ9tYC)
// 업체가 쓰는 원본 엑셀을 그대로 열어 값만 채운다. 서식 · 병합 · 수식 · 드롭다운 · 숨김 시트 · 그림 · 메모는 손대지 않는다.
//  - 칸 연결(mapping)은 화면에서 자동 인식 → 직원 수정으로 만든다 (lib/po-form-recognize.ts)
//  - 값은 문구 틀 하나로 표현: '{item_name} ({qty}개)' · '{co_tel}' · '다올커머스' (틀만 있으면 고정 문구)
//  - 행 = 품목 1개(비용 품목 · 선결제 제외). 개별 배송 명단(707)이 있으면 수령인 1명당 1행, 지점 · 샘플은 주문 배송지
//  - 행이 모자라면 마지막 행 서식 · 수식을 복사해 늘리고, 꼬리 영역(안내 줄 · 합계)이 있으면 그 앞에 끼워 넣는다
// 서버 전용 (exceljs) — 클라이언트는 FIELD 목록 · 타입만 lib/po-vendor-form-fields.ts에서 가져간다.
import type { PoExcelData } from './po-form'
import { shipForItem, rosterRowsForItem } from './po-form'
import { rosterAddr } from './delivery-roster'
import { FIELD_KEYS, type FormMapping, type SheetMap, type ValueSpec, COMPANY_INFO } from './po-vendor-form-fields'

type Cell = import('exceljs').Cell
type Worksheet = import('exceljs').Worksheet

// ── 값 문맥 ──────────────────────────────────────────────
export interface FormContext {
  order: Record<string, string | number | Date | null>
  lines: Record<string, string | number | null>[]
}
export interface FormExtra {
  sender_name: string | null        // 상담일지 발송 정보 '보내는분 명의'
  staff_title: string | null        // 발주 담당 직급
  manager_plain: string | null      // 고객 담당자 이름(존칭 없이)
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
const dateOf = (s: string | null | undefined) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`) : null)

// 발주서 데이터 → 칸에 넣을 값들. 행은 품목(비용 · 선결제 제외) × 수령인
export function buildFormContext(po: PoExcelData, extra: FormExtra): { ctx: FormContext; warnings: string[] } {
  const warnings: string[] = []
  const order: FormContext['order'] = {
    po_no: po.po_no,
    po_date: dateOf(today()),
    order_date: dateOf(po.order_date),
    ship_request: po.ship_request ?? null,
    customer: po.customer,
    customer_bank: po.customer_bank ?? null,
    customer_branch: po.customer_branch ?? null,
    manager: po.customer_manager ?? null,
    manager_plain: extra.manager_plain ?? ((po.customer_manager ?? '').replace(/\s*님$/, '').trim() || null),
    manager_phone: po.customer_phone ?? null,
    sender: extra.sender_name ?? null,
    staff: po.staff_name ?? null,
    staff_title: [po.staff_name, extra.staff_title].filter(Boolean).join(' ') || null,
    staff_phone: po.staff_phone ?? null,
    delivery_note: po.delivery_note ?? null,
    total: po.total_amount ?? 0,
    ...COMPANY_INFO,
  }
  const lines: FormContext['lines'] = []
  let blankRecipients = 0
  for (const it of po.items) {
    if (it.role === 'fee') continue   // 비용 품목(배송비 · 퀵비)은 업체 발주 행이 아님
    const base = {
      item_name: it.item_name ?? '', item_code: it.item_code ?? '', order_kind: it.order_kind ?? '',
      unit_price: it.purchase_price ?? 0, ship_fee: it.purchase_shipping ?? 0, item_memo: it.memo ?? '',
    }
    const roster = rosterRowsForItem(po, it)
    if (roster.length) {
      for (const r of roster) {
        lines.push({
          ...base, qty: r.quantity ?? 0, amount: (r.quantity ?? 0) * (it.purchase_price ?? 0),
          r_name: r.recipient_name ?? '', r_phone: r.phone ?? '', r_zip: r.zip ?? '', r_addr: rosterAddr(r), r_msg: r.memo ?? '',
        })
      }
      continue
    }
    const sh = shipForItem(po, it.order_kind)
    if (!sh || !sh.name) blankRecipients += 1
    lines.push({
      ...base, qty: it.quantity ?? 0, amount: it.purchase_total ?? 0,
      r_name: sh?.name ?? '', r_phone: sh?.phone ?? '', r_zip: sh?.zip ?? '', r_addr: sh?.addr ?? '', r_msg: po.delivery_note ?? '',
    })
  }
  lines.forEach((l, i) => { l.line_no = i + 1; l.r_name_hon = l.r_name ? `${String(l.r_name).replace(/\s*님$/, '')} 님` : '' })
  // 주문 배송지(머리 칸용) — 주문 배송지(513) → 없으면 첫 수령인. 상세주소 → 이름 → 연락처 순 줄바꿈 묶음 (2026-11-09 사용자 확정, 깨끗한나라 배송메모)
  const sh = po.ship && (po.ship.ship_addr1 || po.ship.ship_name)
    ? { name: po.ship.ship_name ?? '', phone: po.ship.ship_phone ?? '', addr: [po.ship.ship_addr1, po.ship.ship_addr2].filter(Boolean).join(' ') }
    : (() => { const l = lines.find(x => x.r_name || x.r_addr); return l ? { name: String(l.r_name ?? ''), phone: String(l.r_phone ?? ''), addr: String(l.r_addr ?? '') } : null })()
  order.ship_name = sh?.name || null
  order.ship_phone = sh?.phone || null
  order.ship_addr = sh?.addr || null
  order.ship_memo = sh ? [sh.addr, sh.name, sh.phone].filter(Boolean).join('\n') || null : null
  const recipients = new Set(lines.filter(l => l.r_name || l.r_addr).map(l => `${l.r_name}|${l.r_addr}`))
  order.ship_multi = !(po.ship && (po.ship.ship_addr1 || po.ship.ship_name)) && recipients.size > 1 ? 1 : null
  if (!lines.length) warnings.push('발주할 품목이 없습니다(비용 품목만 있음).')
  if (blankRecipients) warnings.push(`수령인이 비어 있는 행 ${blankRecipients}개 — 받은 파일에 직접 채우거나 개별 배송 명단을 올려 주세요.`)
  return { ctx: { order, lines }, warnings }
}

// 문구 틀 → 값. '{qty}'처럼 틀 하나뿐이면 숫자 · 날짜 그대로
export function renderTpl(tpl: string, vars: Record<string, unknown>): string | number | Date | null {
  const one = tpl.match(/^\{([a-z_0-9]+)\}$/)
  if (one) {
    const v = vars[one[1]]
    return v === undefined || v === '' ? null : (v as string | number | Date | null)
  }
  const out = tpl.replace(/\{([a-z_0-9]+)\}/g, (raw, k: string) => {
    if (!FIELD_KEYS.has(k)) return raw
    const v = vars[k]
    if (v == null) return ''
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v)
  })
  return out === '' ? null : out
}

// ── 행 끼워 넣기 (병합 · 수식 범위 · 인쇄영역 보정) — 시안 엔진 검증분 ──────────
function shiftRefs(f: string, at: number, count: number): string {
  return f.replace(/(^|[^A-Za-z0-9_!$'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (_m, pre, d1, c, d2, r) => {
    const n = Number(r); return pre + d1 + c + d2 + (n >= at ? n + count : n)
  })
}
const extendRanges = (f: string, at: number, count: number) =>
  f.replace(/(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)/g, (m, c1, r1, c2, r2) =>
    (Number(r1) < at && Number(r2) === at - 1) ? `${c1}${r1}:${c2}${Number(r2) + count}` : m)
const clone = <T,>(v: T): T => (v ? JSON.parse(JSON.stringify(v)) : v)
const formulaOf = (c: Cell): string | null => {
  const v = c.value as unknown
  if (v && typeof v === 'object' && 'formula' in (v as object)) return (v as { formula: string }).formula
  if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) return c.formula ?? null
  return null
}

export function insertRowsBefore(ws: Worksheet, at: number, count: number, styleRowNo: number) {
  if (count <= 0) return
  const last = ws.rowCount, maxCol = Math.max(ws.columnCount, 1)
  const merges = Object.values((ws as unknown as { _merges: Record<string, { top: number; left: number; bottom: number; right: number }> })._merges ?? {})
    .map(rg => ({ top: rg.top, left: rg.left, bottom: rg.bottom, right: rg.right }))
  const moved: typeof merges = []
  for (const m of merges) {
    if (m.top >= at) { ws.unMergeCells(m.top, m.left, m.bottom, m.right); moved.push({ ...m, top: m.top + count, bottom: m.bottom + count }) }
  }
  for (let r = last; r >= at; r--) {
    const src = ws.getRow(r), dst = ws.getRow(r + count)
    dst.height = src.height
    for (let c = 1; c <= maxCol; c++) {
      const s = src.getCell(c), d = dst.getCell(c)
      d.style = clone(s.style)
      const f = formulaOf(s)
      d.value = f ? { formula: extendRanges(shiftRefs(f, at, count), at + count, 0) } as never : s.value
      s.value = null
    }
  }
  const base = ws.getRow(styleRowNo)
  for (let i = 0; i < count; i++) {
    const r = at + i, row = ws.getRow(r)
    row.height = base.height
    for (let c = 1; c <= maxCol; c++) {
      const b = base.getCell(c), d = row.getCell(c)
      d.style = clone(b.style)
      const f = formulaOf(b)
      d.value = f ? { formula: f.replace(new RegExp(`([A-Z]{1,3})${styleRowNo}(?!\\d)`, 'g'), `$1${r}`) } as never : null
    }
  }
  for (let r = 1; r <= last + count; r++) {
    if (r >= at && r < at + count) continue
    ws.getRow(r).eachCell({ includeEmpty: false }, cell => {
      const f = formulaOf(cell)
      if (!f) return
      cell.value = { formula: extendRanges(r < at ? shiftRefs(f, at, count) : f, at, count) } as never
    })
  }
  for (const m of moved) ws.mergeCells(m.top, m.left, m.bottom, m.right)
  const pa = ws.pageSetup?.printArea
  if (pa) ws.pageSetup.printArea = pa.replace(/(\$?[A-Z]+\$?)(\d+)/g, (_m, c, r) => c + (Number(r) >= at ? Number(r) + count : r))
}

// ── 채우기 ──────────────────────────────────────────────
const cellText = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object' && v && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map(t => t.text).join('')
  if (typeof v === 'object' && v && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '')
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

function put(ws: Worksheet, addr: string, spec: ValueSpec | undefined, vars: Record<string, unknown>, keepValue?: unknown) {
  if (!spec || spec.k === 'skip') return
  const cell = ws.getCell(addr)
  if (formulaOf(cell)) return                       // 원본 수식 칸은 건드리지 않는다
  if (spec.k === 'blank') { cell.value = null; return }
  if (spec.k === 'keep') { if (keepValue !== undefined) cell.value = keepValue as never; return }
  const v = renderTpl(spec.v, vars)
  cell.value = v as never
  // 일반 서식 칸에 날짜 → 숫자로 보이지 않게. exceljs는 같은 서식을 칸끼리 공유하므로 복사본에 바꿔야 옆 칸(숫자)까지 날짜가 되지 않는다
  if (v instanceof Date && !/[ymd]/i.test(cell.numFmt ?? '')) cell.style = { ...clone(cell.style), numFmt: 'yyyy-mm-dd' }
}

function fillRowsSheet(ws: Worksheet, sm: SheetMap, ctx: FormContext, warn: (m: string) => void) {
  const start = sm.start_row
  const lines = ctx.lines
  // 양식 값 유지 칸: 시작 행에 미리 적힌 값을 모든 행에 반복
  const keepVals: Record<string, unknown> = {}
  for (const [col, spec] of Object.entries(sm.columns)) if (spec.k === 'keep') keepVals[col] = ws.getCell(`${col}${start}`).value
  // 예시 행 지우기: 준비 영역의 수식 아닌 값 비우기 (꼬리 영역 · 머리 칸 제외)
  const end = sm.end_row ?? Math.max(start, (sm.insert_before ?? ws.rowCount + 1) - 1)
  if (sm.clear_examples) {
    for (let r = start; r <= Math.min(end, start + 50); r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, cell => { if (!formulaOf(cell)) cell.value = null })
    }
  }
  const cap = sm.end_row ? sm.end_row - start + 1 : Infinity
  if (lines.length > cap) {
    const extra = lines.length - cap
    if (sm.insert_before) insertRowsBefore(ws, sm.insert_before, extra, sm.end_row!)
    else {
      const baseNo = sm.end_row!, base = ws.getRow(baseNo)
      for (let i = 1; i <= extra; i++) {
        const row = ws.getRow(baseNo + i)
        row.height = base.height
        base.eachCell({ includeEmpty: true }, (b, c) => {
          const d = row.getCell(c); d.style = clone(b.style)
          const f = formulaOf(b)
          if (f) d.value = { formula: f.replace(new RegExp(`([A-Z]{1,3})${baseNo}(?!\\d)`, 'g'), `$1${baseNo + i}`) } as never
        })
      }
    }
    warn(`양식에 준비된 ${cap}행보다 ${extra}행 많아 서식을 복사해 늘렸습니다.`)
  } else if (sm.insert_before && sm.end_row == null && start + lines.length > sm.insert_before) {
    insertRowsBefore(ws, sm.insert_before, start + lines.length - sm.insert_before, sm.insert_before - 1)
  }
  // 행 서식 통일 — 고정 규칙 (2026-11-09 사용자 확정: "행마다 서식이 서로 다를 경우, 가장 처음 상품명이 입력된 행의 서식을 기준으로 통일"):
  // 채우는 모든 행을 첫 품목 행(= 처음 상품명이 들어가는 행)의 서식(정렬 · 글꼴 · 테두리 · 채움 · 표시 형식)과 높이로 맞춘다.
  // 값 · 수식 · 드롭다운 · 조건부 서식은 그대로. 끄기 · 기준 행 변경은 두지 않는다(옛 unify_style · style_row 값은 무시).
  // 값을 넣기 전에 해야 날짜 칸 표시 형식 보정(put)이 살아 있다.
  if (lines.length > 1) {
    const baseNo = start
    const base = ws.getRow(baseNo)
    const maxCol = Math.max(ws.columnCount, 1)
    for (let i = 0; i < lines.length; i++) {
      const r = start + i
      if (r === baseNo) continue
      const row = ws.getRow(r)
      row.height = base.height
      for (let c = 1; c <= maxCol; c++) row.getCell(c).style = clone(base.getCell(c).style)
    }
  }
  lines.forEach((ln, i) => {
    const vars = { ...ctx.order, ...ln }
    for (const [col, spec] of Object.entries(sm.columns)) put(ws, `${col}${start + i}`, spec, vars, keepVals[col])
  })
  if (sm.required?.length) {
    for (const col of sm.required) {
      const empty = lines.map((_, i) => start + i).filter(r => cellText(ws.getCell(`${col}${r}`).value) === '' && !formulaOf(ws.getCell(`${col}${r}`)))
      if (!empty.length) continue
      const head = sm.header_row ? cellText(ws.getCell(`${col}${sm.header_row}`).value).trim() : ''
      warn(`${col}열${head ? `(${head})` : ''} 필수 칸이 ${empty.length === lines.length ? '모든 행' : `${empty.length}개 행(${empty.slice(0, 3).join(' · ')}${empty.length > 3 ? ' …' : ''}행)`}에서 비어 있습니다.`)
    }
  }
}

function fillCatalogSheet(ws: Worksheet, sm: SheetMap, ctx: FormContext, warn: (m: string) => void) {
  const cat = sm.catalog!
  const rowOf = new Map<string, number>()
  for (let r = cat.start_row; r <= cat.end_row; r++) rowOf.set(norm(cellText(ws.getCell(`${cat.name_col}${r}`).value)), r)
  for (const ln of ctx.lines) {
    const r = rowOf.get(norm(ln.item_name))
    if (!r) { warn(`'${ln.item_name}' — 업체 양식 품목 목록에 같은 이름이 없어 수량을 넣지 못했습니다(직접 입력).`); continue }
    const cur = Number(cellText(ws.getCell(`${cat.qty_col}${r}`).value) || 0)
    ws.getCell(`${cat.qty_col}${r}`).value = cur + Number(ln.qty ?? 0)
  }
}

// 조건부 서식 보정 (2026-11-09 — 제주담은귤 '중복 값' 규칙에서 엑셀 복구 경고 발생)
// exceljs는 읽은 규칙 중 9종(expression · cellIs · top10 · aboveAverage · dataBar · colorScale · iconSet · containsText · timePeriod)만 쓸 수 있고,
// 나머지(중복 값 · 고유 값 · ~로 시작 등)는 규칙을 버리고 빈 <conditionalFormatting>만 남겨 엑셀이 '읽을 수 없는 내용'으로 복구한다.
// → 같은 뜻의 수식 규칙(expression)으로 바꿔 색은 유지하고, 바꿀 수 없는 규칙만 뺀다. 규칙이 하나도 안 남은 서식은 지운다.
const CF_WRITABLE = new Set(['expression', 'cellIs', 'top10', 'aboveAverage', 'dataBar', 'colorScale', 'iconSet', 'containsText', 'timePeriod'])
type CfRule = { type: string; formulae?: string[]; priority?: number; style?: unknown; [k: string]: unknown }
type Cf = { ref: string; rules: CfRule[] }
export function sanitizeConditionalFormats(ws: Worksheet): number {
  const list = (ws as unknown as { conditionalFormattings?: Cf[] }).conditionalFormattings
  if (!Array.isArray(list) || !list.length) return 0
  let changed = 0
  const abs = (a: string) => a.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, '$$$2$$$4')
  for (const cf of list) {
    const areas = String(cf.ref ?? '').split(/\s+/).filter(Boolean)
    const topLeft = (areas[0] ?? 'A1').split(':')[0].replace(/\$/g, '')
    const count = areas.map(a => `COUNTIF(${abs(a)},${topLeft})`).join('+')
    cf.rules = (cf.rules ?? []).flatMap((r): CfRule[] => {
      if (CF_WRITABLE.has(r.type)) return [r]
      changed++
      const keep = { priority: r.priority, style: r.style }
      if (r.type === 'duplicateValues' && count) return [{ ...keep, type: 'expression', formulae: [`(${count})>1`] }]
      if (r.type === 'uniqueValues' && count) return [{ ...keep, type: 'expression', formulae: [`(${count})=1`] }]
      if (r.formulae?.length) return [{ ...keep, type: 'expression', formulae: [r.formulae[0]] }]   // ~로 시작 · 빈 칸 등은 엑셀이 수식을 함께 저장
      return []
    })
  }
  const kept = list.filter(cf => cf.rules.length)
  changed += list.length - kept.length
  list.splice(0, list.length, ...kept)
  return changed
}

// 드롭다운(데이터 유효성) 범위 정리 (2026-11-09) — exceljs는 읽을 때 범위를 칸 하나하나로 펼치고, 쓸 때 주소를 글자 순으로 정렬해
// 다시 묶는다('N10'이 'N7'보다 앞) → N7:N65515 와 N10:N65515 처럼 겹치는 범위가 생겨 엑셀이 복구 경고를 낸다(삼진어묵).
// 쓰기 전에 열마다 같은 규칙이 이어지는 행을 직접 범위로 묶어 넣는다(범위 주소는 exceljs가 그대로 쓴다).
export function compactDataValidations(ws: Worksheet): void {
  const holder = (ws as unknown as { dataValidations?: { model: Record<string, unknown> } }).dataValidations
  const model = holder?.model
  if (!model) return
  const keys = Object.keys(model)
  if (!keys.length) return
  const colNum = (c: string) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  type Cell1 = { col: string; row: number; sig: string; dv: unknown }
  const cells: Cell1[] = []
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const m = k.match(/^([A-Z]{1,3})(\d+)$/)
    if (!m) { out[k] = model[k]; continue }          // 이미 범위인 것은 그대로
    cells.push({ col: m[1], row: Number(m[2]), sig: JSON.stringify(model[k]), dv: model[k] })
  }
  cells.sort((a, b) => colNum(a.col) - colNum(b.col) || a.row - b.row)
  for (let i = 0; i < cells.length;) {
    let j = i
    while (j + 1 < cells.length && cells[j + 1].col === cells[i].col && cells[j + 1].row === cells[j].row + 1 && cells[j + 1].sig === cells[i].sig) j++
    const a = cells[i], b = cells[j]
    out[a.row === b.row ? `${a.col}${a.row}` : `${a.col}${a.row}:${b.col}${b.row}`] = a.dv
    i = j + 1
  }
  holder!.model = out
}

export interface FillResult { buffer: Buffer; warnings: string[] }

export async function fillVendorForm(template: ArrayBuffer | Buffer, mapping: FormMapping, ctx: FormContext, baseWarnings: string[] = []): Promise<FillResult> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(template as ArrayBuffer)
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true }   // 열 때 수식 다시 계산
  const warnings = [...baseWarnings]
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m) }
  for (const sheet of wb.worksheets) sanitizeConditionalFormats(sheet)   // 손대지 않는 시트도 다시 쓰이므로 전부
  if (!ctx.order.sender) warn('보내는분 명의가 없습니다(상담일지 발송 정보) — 보내는분 칸을 비워 두었습니다.')
  const usesShip = mapping.sheets.some(sm => Object.values(sm.cells ?? {}).some(v => v.k === 'tpl' && /\{ship_/.test(v.v)))
  if (usesShip && !ctx.order.ship_memo) warn('배송지가 없습니다(주문 배송지 · 수령인 모두 비어 있음) — 배송지 칸을 비워 두었습니다.')
  if (usesShip && ctx.order.ship_multi) warn('받는분이 여러 명입니다 — 배송지 칸에는 첫 번째 받는분만 넣었습니다. 나머지는 직접 적어 주세요.')

  for (const sm of mapping.sheets) {
    const ws = wb.getWorksheet(sm.name)
    if (!ws) { warn(`양식에 '${sm.name}' 시트가 없습니다 — 양식을 다시 확인하세요.`); continue }
    for (const [addr, spec] of Object.entries(sm.cells ?? {})) put(ws, addr, spec, ctx.order)
    if (sm.mode === 'rows') fillRowsSheet(ws, sm, ctx, warn)
    else if (sm.mode === 'catalog' && sm.catalog) fillCatalogSheet(ws, sm, ctx, warn)
  }
  for (const sheet of wb.worksheets) compactDataValidations(sheet)
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), warnings }
}
