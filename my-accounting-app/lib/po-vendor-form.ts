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
    vendor_name: po.vendor_name ?? null,     // 품목 목록형 상품명 매칭용(상표 제거 · 확정 동일 상품 범위) — 값 목록에는 노출 안 함
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

// ── 업체 드롭다운(데이터 유효성 '목록') 칸 처리 (2026-11-10 사용자 확정 — 삼진어묵, docs/order-system-track.md) ──────────
// 제품명 칸에 업체 목록 드롭다운이 걸려 있으면 우리 품명을 그 목록 값으로 바꿔 넣는다(업체 품목코드 VLOOKUP이 이 값으로 동작).
// 목록에 없는 값은 절대 넣지 않는다 — 못 찾으면 비우고 확인 목록. 옵션 드롭다운 칸은 비운다. 그 밖의 드롭다운 칸은 목록과 정확히 같은 값만.
type Workbook = import('exceljs').Workbook
export function dropdownListOf(wb: Workbook, ws: Worksheet, addr: string): string[] | null {
  const dv = ws.getCell(addr).dataValidation as { type?: string; formulae?: unknown[] } | undefined
  if (!dv || dv.type !== 'list' || !dv.formulae?.length) return null
  let f = String(dv.formulae[0] ?? '').trim().replace(/^=/, '')
  if (f.length >= 2 && f.startsWith('"') && f.endsWith('"')) return Array.from(new Set(f.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean)))   // 직접 입력 "A,B,C"
  const ind = f.match(/^INDIRECT\(\s*"([^"]+)"\s*\)$/i)
  if (ind) f = ind[1]
  let ranges: string[] = []
  try { ranges = (wb.definedNames.getRanges(f) as { ranges?: string[] } | undefined)?.ranges ?? [] } catch { ranges = [] }
  if (!ranges.length && /\$?[A-Z]{1,3}\$?\d+/.test(f)) ranges = [f]
  const out: string[] = []
  for (const rg of ranges) {
    const m = rg.match(/^(?:'?(.+?)'?!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/)
    if (!m) continue
    const sheet = m[1] ? wb.getWorksheet(m[1]) : ws
    if (!sheet) continue
    const colN = (c: string) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
    const c1 = colN(m[2]), r1 = Number(m[3]), c2 = m[4] ? colN(m[4]) : c1, r2 = m[5] ? Number(m[5]) : r1
    for (let r = r1; r <= Math.min(r2, r1 + 5000); r++) for (let c = c1; c <= c2; c++) {
      const v = cellText(sheet.getCell(r, c).value).trim()
      if (v) out.push(v)
    }
  }
  return out.length ? Array.from(new Set(out)) : null
}

// 드롭다운 제품명 매칭 — 상품명 → 브랜드(매입처명 · 앞 두 글자) 제거 · 괄호 안 무시 · '세트' 제거 → 구분 토큰(호수 · 특호 · 묶음 · g · 종 · *N …) + 상품명 부분
//  자동 = (목록과 글자 그대로 같음) 또는 (상품명 부분 2글자 이상 · 완전 일치 + 구분 토큰 완전 일치 + 그런 목록 값이 정확히 1개). 그 외는 비우고 확인 목록
interface DropParsed { core: string; tok: string }
function brandWordsOf(vendorName?: string | null): string[] {
  const v = String(vendorName ?? '').normalize('NFKC').toLowerCase().replace(/\(주\)|㈜|주식회사|\s+/g, '')
  return v.length >= 3 ? [v, v.slice(0, 2)] : v.length === 2 ? [v] : []
}
export function parseDropName(raw: string, vendorName?: string | null): DropParsed {
  let t = String(raw ?? '').normalize('NFKC').toLowerCase()
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')                                  // 괄호 · 대괄호 안(냉동 · 6종 · B2B · [삼진어묵]) 무시
  for (const b of brandWordsOf(vendorName)) t = t.split(b).join(' ')
  const tok: string[] = []
  t = t.replace(/(\d+|특)\s*호/g, (_m, n: string) => { tok.push(`${n}호`); return ' ' })
  t = t.replace(/(\d+(?:\.\d+)?)\s*(묶음|kg|g|ml|l|종|팀|입|개|매|롤|m|팩|박스|box)(?![a-z가-힣])/g, (_m, n: string, u: string) => { tok.push(`${Number(n)}${u}`); return ' ' })
  t = t.replace(/[*×]\s*(\d+)/g, (_m, n: string) => { tok.push(`x${n}`); return ' ' })
  t = t.split('세트').join(' ')
  return { core: t.replace(/[^0-9a-z가-힣]/g, ''), tok: tok.sort().join(',') }
}
export type DropMatch = { value: string; exact: boolean; basis: string } | { value: null; reason: string }
export function matchDropdownValue(itemName: string, list: string[], vendorName?: string | null): DropMatch {
  const name = String(itemName ?? '').trim()
  const same = list.filter(v => v.trim() === name)
  if (same.length) return { value: same[0], exact: true, basis: '목록과 같음' }
  const e = parseDropName(name, vendorName)
  if (e.core.length < 2) return { value: null, reason: `브랜드 등을 빼면 상품명이 거의 남지 않아('${e.core}') 자동으로 고르지 않았습니다` }
  const parsed = list.map(v => ({ v, p: parseDropName(v, vendorName) }))
  const hit = parsed.filter(x => x.p.core === e.core && x.p.tok === e.tok)
  if (hit.length === 1) return { value: hit[0].v, exact: false, basis: `상품명 '${e.core}'${e.tok ? ` · 구분 ${e.tok.replace(/,/g, ' · ')}` : ''} 일치` }
  if (hit.length > 1) return { value: null, reason: `목록에 맞는 값이 ${hit.length}개(${hit.map(x => `'${x.v}'`).join(', ')})라 고르지 않았습니다` }
  const best = parsed.map(x => ({ x, s: dice(e.core + e.tok, x.p.core + x.p.tok) })).sort((a, b) => b.s - a.s)[0]
  if (!best || best.s < 0.3) return { value: null, reason: '업체 제품명 목록에 같은 상품이 없습니다' }
  const why = best.x.p.core === e.core ? '호수 · 구분이 달라' : '상품명이 달라'
  return { value: null, reason: `비슷한 값은 '${best.x.v}' — ${why} 자동으로 넣지 않았습니다` }
}

function fillRowsSheet(ws: Worksheet, sm: SheetMap, ctx: FormContext, warn: (m: string) => void, wb?: Workbook) {
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
  // 드롭다운 칸 (첫 품목 행 기준) — 없으면 기존과 똑같이 put
  const vendorName = (ctx.order.vendor_name as string | null) ?? null
  const drop = new Map<string, { list: string[]; kind: 'name' | 'option' | 'other'; head: string }>()
  if (wb) for (const [col, spec] of Object.entries(sm.columns)) {
    if (spec.k !== 'tpl' && spec.k !== 'keep') continue
    const list = dropdownListOf(wb, ws, `${col}${start}`)
    if (!list) continue
    const head = sm.header_row ? cellText(ws.getCell(`${col}${sm.header_row}`).value).trim() : ''
    drop.set(col, { list, head, kind: spec.k === 'tpl' && /\{item_name\}/.test(spec.v) ? 'name' : /옵션/.test(head) ? 'option' : 'other' })
  }
  const nameMatch = new Map<string, DropMatch>()
  lines.forEach((ln, i) => {
    const vars = { ...ctx.order, ...ln }
    for (const [col, spec] of Object.entries(sm.columns)) {
      const d = drop.get(col)
      if (!d) { put(ws, `${col}${start + i}`, spec, vars, keepVals[col]); continue }
      const cell = ws.getCell(`${col}${start + i}`)
      if (formulaOf(cell)) continue
      if (d.kind === 'option') { cell.value = null; continue }              // 옵션 드롭다운은 비움 (2026-11-10 사용자 결정)
      if (d.kind === 'name') {
        const item = String(ln.item_name ?? '')
        let m = nameMatch.get(item)
        if (!m) {
          m = matchDropdownValue(item, d.list, vendorName)
          nameMatch.set(item, m)
          if (m.value === null) warn(`'${item}' — ${col}열(${d.head || '제품명'}) ${m.reason}. 업체 목록에서 골라 넣어 주세요.`)
          else if (!m.exact) warn(`제품명 변환: '${item}' → 업체 목록 '${m.value}' (${m.basis}) — 맞는지 확인해 주세요.`)
        }
        cell.value = m.value
        continue
      }
      const v = spec.k === 'keep' ? keepVals[col] : renderTpl((spec as { v: string }).v, vars)   // 그 밖의 드롭다운 칸: 목록과 같은 값만
      const text = cellText(v).trim()
      if (!text) { cell.value = null; continue }
      if (d.list.includes(text)) { cell.value = text; continue }
      cell.value = null
      warn(`${col}열(${d.head || '드롭다운'}) 값 '${text}'이 업체 목록에 없어 비워 두었습니다.`)
    }
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

// ── 품목 목록형 상품명 매칭 (2026-11-10 사용자 확정 — docs/order-system-track.md) ──────────────
// 우리 품목명에는 업체 제품코드가 없어 상품명으로만 맞춘다. 확실한 것만 수량을 넣고 나머지는 비워 확인 목록에 남긴다.
//  상품명 → ① 정리(전각 · 대소문자 · 동의어 · 매입처 상표 제거) ② 보조 표기(괄호 · 대괄호 · 끝의 _XX — 무시)
//          ③ 규격(숫자+단위: 매 · 롤 · 입 · m · 겹 …) ④ 구분어(캡 · 리필 …) ⑤ 핵심명(나머지, 공백 · 특수문자 제거)
//  자동 입력 = 아래를 모두 만족하는 양식 행이 정확히 1개일 때만:
//    규격 완전 일치 · 구분어 충돌 없음 · 핵심명 같음 또는 포함(짧은 쪽 3자 이상 · 긴 쪽의 70% 이상) 또는 확정 동일 상품
//  규격이 없는 상품명은 자동 판단하지 않는다. 유사도는 확인 목록의 '비슷한 품목' 안내에만 쓴다(자동 입력 근거 아님).
const NAME_SYNONYMS: [string, string][] = [['키친타월', '키친타올'], ['캡형', '캡'], ['미터', 'm'], ['개입', '입'], ['ea', '개']]   // '소프트'≠'소프티'(사용자 확정 전까지 동의어 아님)
const PKG_WORDS = ['캡', '리필', '휴대용', '미니', '점보', '대용량']
const SPEC_UNITS = '매입|매|롤|입|m|겹|bag|팩|개|box|박스|kg|g|ml|l'
// 사용자 확인 동일 상품 — 이름이 달라도 같은 상품(핵심명만 같게 본다. 규격 · 구분어 · 후보 1개 조건은 그대로). 매입처별로만 적용
const CONFIRMED_SAME: { vendor: RegExp; a: string; b: string; note: string }[] = [
  { vendor: /깨끗한나라/, a: '벚꽃로맨틱', b: '허브가든벚꽃프리미엄', note: '2026-11-10 사용자 확인: 벚꽃 로맨틱 27m 30롤 = 허브가든 벚꽃 프리미엄 27m 30롤' },
]
interface ParsedName { raw: string; core: string; spec: string; pkg: string }
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function parseProductName(raw: string, vendorName?: string | null): ParsedName {
  let t = String(raw ?? '').normalize('NFKC').toLowerCase()
  for (const [a, b] of NAME_SYNONYMS) t = t.split(a).join(b)
  const brand = String(vendorName ?? '').normalize('NFKC').toLowerCase().replace(/\(주\)|㈜|주식회사|\s+/g, '')
  if (brand.length >= 2) t = t.split(brand).join(' ')
  t = t.replace(/\([^)]*\)|\[[^\]]*\]|_[0-9a-z가-힣]+\s*$/g, ' ')                       // 보조 표기 — 무시
  const spec: string[] = []
  t = t.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${SPEC_UNITS})(?![a-z가-힣])`, 'g'), (_m, n: string, u: string) => { spec.push(`${Number(n)}${u}`); return ' ' })
  const pkg: string[] = []
  for (const w of PKG_WORDS) {
    const re = new RegExp(`(^|[^가-힣])${escRe(w)}(?![가-힣])`, 'g')
    if (re.test(t)) { pkg.push(w); t = t.replace(new RegExp(`(^|[^가-힣])${escRe(w)}(?![가-힣])`, 'g'), '$1 ') }
  }
  return { raw, core: t.replace(/[^0-9a-z가-힣]/g, ''), spec: spec.sort().join(','), pkg: pkg.sort().join(',') }
}
function coreRelation(a: string, b: string, vendorName?: string | null): string | null {
  if (!a || !b) return null
  if (a === b) return '핵심명 같음'
  const [sh, lo] = a.length <= b.length ? [a, b] : [b, a]
  if (sh.length >= 3 && lo.includes(sh) && sh.length / lo.length >= 0.7) return '핵심명 포함'
  if (CONFIRMED_SAME.some(c => c.vendor.test(String(vendorName ?? '')) && ((c.a === a && c.b === b) || (c.a === b && c.b === a)))) return '확정 동일 상품'
  return null
}
const bigrams = (x: string) => { const o: string[] = []; for (let i = 0; i < x.length - 1; i++) o.push(x.slice(i, i + 2)); return o }
function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b)
  if (!A.length || !B.length) return 0
  const m = new Map<string, number>(); A.forEach(x => m.set(x, (m.get(x) ?? 0) + 1))
  let n = 0; B.forEach(x => { const c = m.get(x); if (c) { n++; m.set(x, c - 1) } })
  return (2 * n) / (A.length + B.length)
}
export type CatalogMatch = { row: number; basis: string; exact: boolean } | { row: null; reason: string }
export function matchCatalogRow(itemName: string, rows: { row: number; name: string }[], vendorName?: string | null): CatalogMatch {
  const exact = rows.filter(r => norm(r.name) === norm(itemName))      // 기존 방식(공백 · 대소문자만 무시) 완전 일치가 1개면 그대로
  if (exact.length === 1) return { row: exact[0].row, basis: '이름 일치', exact: true }
  const e = parseProductName(itemName, vendorName)
  const parsed = rows.map(r => ({ ...r, p: parseProductName(r.name, vendorName) }))
  if (!e.spec) return { row: null, reason: '상품명에 규격(매 · 롤 · 입 · m 등)이 없어 자동으로 판단하지 않았습니다' }
  const pass = parsed
    .filter(r => r.p.spec === e.spec && (!e.pkg || e.pkg === r.p.pkg) && (!r.p.pkg || !e.pkg || e.pkg === r.p.pkg))
    .map(r => ({ r, rel: coreRelation(e.core, r.p.core, vendorName) }))
    .filter(x => x.rel)
  if (pass.length === 1) return { row: pass[0].r.row, basis: `규격 같음(${e.spec.replace(/,/g, ' · ')}) · ${pass[0].rel}`, exact: false }
  if (pass.length > 1) return { row: null, reason: `조건이 맞는 행이 ${pass.length}개(${pass.map(x => `'${x.r.name}'`).join(', ')})라 고르지 않았습니다` }
  const best = parsed.map(r => ({ r, s: dice(e.core + e.spec, r.p.core + r.p.spec) })).sort((x, y) => y.s - x.s)[0]
  if (!best || best.s < 0.3) return { row: null, reason: '업체 양식 품목 목록에 같은 상품이 없습니다' }
  const why = best.r.p.spec !== e.spec ? '규격(매 · 롤 · 입 등)이 달라' : (e.pkg && e.pkg !== best.r.p.pkg) ? '구분(캡 · 리필 등)이 달라' : '상품명이 달라'
  return { row: null, reason: `비슷한 품목은 '${best.r.name}' — ${why} 자동으로 넣지 않았습니다` }
}

function fillCatalogSheet(ws: Worksheet, sm: SheetMap, ctx: FormContext, warn: (m: string) => void) {
  const cat = sm.catalog!
  const vendorName = (ctx.order.vendor_name as string | null) ?? null
  const catalogRows: { row: number; name: string }[] = []
  for (let r = cat.start_row; r <= cat.end_row; r++) {
    const name = cellText(ws.getCell(`${cat.name_col}${r}`).value).trim()
    if (name) catalogRows.push({ row: r, name })
  }
  // BOX 환산 (2026-11-09 사용자 확정, 깨끗한나라): 발주서 수량(BOX) = ERP 수량 ÷ 입수.
  // 입수 열: 설정값 → 설정이 없던 옛 칸 연결은 머리글 '입수' 열을 찾아 씀. 빈 값('')으로 저장하면 환산하지 않음
  let packCol = cat.pack_col
  if (packCol === undefined && sm.header_row) {
    ws.getRow(sm.header_row).eachCell({ includeEmpty: false }, (cell, col) => {
      if (!packCol && /입수/.test(cellText(cell.value))) packCol = cell.address.replace(/\d+$/, '') || String(col)
    })
  }
  const erpQty = new Map<number, number>()      // 같은 품목이 여러 행(수령인별)이면 ERP 수량을 합친 뒤 환산
  const namesByRow = new Map<number, Set<string>>()
  const decided = new Map<string, CatalogMatch>()
  for (const ln of ctx.lines) {
    const itemName = String(ln.item_name ?? '')
    let m = decided.get(itemName)
    if (!m) {
      m = matchCatalogRow(itemName, catalogRows, vendorName)
      decided.set(itemName, m)
      if (m.row === null) warn(`'${itemName}' — ${m.reason}. 수량을 직접 넣어 주세요.`)
      else if (!m.exact) warn(`자동 연결: '${itemName}' → 양식 '${catalogRows.find(c => c.row === m!.row)?.name}' (${m.basis}) — 맞는지 확인해 주세요.`)
    }
    if (m.row === null) continue
    erpQty.set(m.row, (erpQty.get(m.row) ?? 0) + Number(ln.qty ?? 0))
    namesByRow.set(m.row, (namesByRow.get(m.row) ?? new Set()).add(itemName))
  }
  namesByRow.forEach((names, r) => {
    if (names.size > 1) warn(`서로 다른 품목 ${Array.from(names).map(n => `'${n}'`).join(', ')}이 양식 같은 행('${catalogRows.find(c => c.row === r)?.name}')에 합쳐졌습니다 — 확인해 주세요.`)
  })
  erpQty.forEach((qty, r) => {
    const name = cellText(ws.getCell(`${cat.name_col}${r}`).value).trim()
    const cell = ws.getCell(`${cat.qty_col}${r}`)
    const cur = Number(cellText(cell.value) || 0)
    if (!packCol) { cell.value = cur + qty; return }
    const pack = Number(cellText(ws.getCell(`${packCol}${r}`).value).replace(/[^\d.]/g, ''))
    if (!(pack > 0)) {
      cell.value = cur + qty
      warn(`'${name}' — 입수가 비어 있어 ERP 수량 ${qty}을 그대로 넣었습니다. BOX 수량을 확인해 주세요.`)
      return
    }
    const box = Math.round((qty / pack) * 100) / 100
    cell.value = cur + box
    if (qty % pack !== 0) warn(`'${name}' — ERP 수량 ${qty} ÷ 입수 ${pack} = ${box}BOX로 나누어떨어지지 않습니다. 수량을 확인해 주세요.`)
  })
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
    if (sm.mode === 'rows') fillRowsSheet(ws, sm, ctx, warn, wb)
    else if (sm.mode === 'catalog' && sm.catalog) fillCatalogSheet(ws, sm, ctx, warn)
  }
  for (const sheet of wb.worksheets) compactDataValidations(sheet)
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), warnings }
}
