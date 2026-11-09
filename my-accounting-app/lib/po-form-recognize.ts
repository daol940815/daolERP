// 업체 발주서 양식 자동 인식 (516, 2026-11-09) — 서버 전용(exceljs)
// 빈 양식만 보고 머리글 행을 찾고, 열마다 '무슨 값'을 넣을지 추천한다. 추천은 직원이 칸 연결 화면에서 고친다(확정은 사람).
//  - 규칙 = 동의어 목록(시안 검증: 빈 양식 20개 머리글 20/20 · 열 94% 추천)
//  - 추천마다 근거(how · reason)를 남겨 화면에서 '확인 필요'만 골라 보게 한다
import { type FormMapping, type ValueSpec, type RecognizedSheet, type RecognizedCell, type RecognizeResult, type How, toSheetMap } from './po-vendor-form-fields'
export type { RecognizedSheet, RecognizedColumn, RecognizedCell, RecognizeResult, How } from './po-vendor-form-fields'

type Worksheet = import('exceljs').Worksheet
type Cell = import('exceljs').Cell

const T = (v: string): ValueSpec => ({ k: 'tpl', v })
const SKIP: ValueSpec = { k: 'skip' }
const BLANK: ValueSpec = { k: 'blank' }

// ── 머리글 분류 ──────────────────────────────────────────
const SIDE_S = /보내|발송|송화|발신|구매자|주문자|\(지정\)/
const SIDE_R = /받는|받으|수령|수취|배송지/
const PHONE = /전화|연락처|HP|H\.P|휴대폰|핸드폰|핸폰/i

interface Hit { spec: ValueSpec; how: How; reason: string; side?: 'S' | 'R' }

function classify(h: string, side: 'S' | 'R'): Hit | null {
  const t = h
  if (/송장|운송장|택배사|출고번호|고유코드/.test(t)) return { spec: SKIP, how: 'auto', reason: '업체가 채우는 회신 칸' }
  if (/^공란$|^temps/i.test(t)) return { spec: BLANK, how: 'auto', reason: '공란 열' }
  if (/발주일|요청일|발주요청일|주문일|작성일/.test(t)) return { spec: T('{po_date}'), how: 'auto', reason: '날짜 칸 → 발주일(오늘)' }
  if (/주문번호|발주번호|세부/.test(t)) return { spec: T('{po_no}'), how: 'check', reason: '주문번호 — 업체마다 비움 · 순번 · 발주번호가 다름' }
  if (/상품코드|품목번호|품번|품목코드|제품코드/.test(t)) return { spec: T('{item_code}'), how: 'auto', reason: '품목코드' }
  if (/상품명|품목명|품명|제품명|주문상품/.test(t)) {
    if (/수량/.test(t)) return { spec: T('{item_name} ({qty}개)'), how: 'check', reason: '품명과 수량이 한 칸' }
    return { spec: T('{item_name}'), how: 'auto', reason: '품명' }
  }
  if (/옵션|색상/.test(t)) return { spec: T('{item_memo}'), how: 'check', reason: '옵션 — 우리 품목 비고를 넣음' }
  if (/수량/.test(t)) return { spec: T('{qty}'), how: /내품|송장|박스/.test(t) ? 'check' : 'auto', reason: '수량' }
  if (/부가세|합계|총액|발주총액/.test(t)) return { spec: SKIP, how: 'check', reason: '합계 · 세액 — 보통 수식이거나 업체가 채움' }
  if (/배송비|택배비|운임/.test(t)) return { spec: SKIP, how: 'check', reason: '배송비 — 업체 기준' }
  if (/공급가|단가|판매가|매입가/.test(t)) return { spec: T('{unit_price}'), how: 'check', reason: '단가 — 매입 단가를 넣음' }
  if (/메세지|메시지|메모|요청사항|특기사항/.test(t)) return { spec: T('{r_msg}'), how: 'auto', reason: '배송메시지' }
  if (/비고/.test(t)) return { spec: T('{item_memo}'), how: 'check', reason: '비고 — 우리 품목 비고를 넣음' }
  if (/^업체명$|발주처|접수자|판매처|거래처명?$/.test(t)) return { spec: T('{co_name}'), how: 'check', reason: '다올 칸으로 보임' }

  const hasS = SIDE_S.test(t), hasR = SIDE_R.test(t)
  const s: 'S' | 'R' | null = hasS && !hasR ? 'S' : hasR ? 'R' : null
  const isPhone = PHONE.test(t), isZip = /우편/.test(t), isAddr = /주소/.test(t) || /배송지$/.test(t)
  if (s === 'S') {
    if (isPhone) return { spec: T('{manager_phone}'), how: 'check', reason: '보내는분 연락처 — 고객 담당자 연락처(업체에 따라 다올 대표번호)', side: 'S' }
    if (isZip) return { spec: BLANK, how: 'check', reason: '보내는분 우편번호 — 비움', side: 'S' }
    if (isAddr) return { spec: BLANK, how: 'check', reason: '보내는분 주소 — 비움(업체 고정 주소면 직접 입력)', side: 'S' }
    if (/구매자|주문자/.test(t)) return { spec: T('{co_name}'), how: 'check', reason: '구매자 · 주문자 = 다올커머스', side: 'S' }
    return { spec: T('{sender}'), how: 'auto', reason: '보내는분 = 상담일지 보내는분 명의', side: 'S' }
  }
  if (s === 'R') {
    if (isPhone) return { spec: T('{r_phone}'), how: /2|기타|일반/.test(t) ? 'check' : 'auto', reason: '받는분 연락처', side: 'R' }
    if (isZip) return { spec: T('{r_zip}'), how: 'auto', reason: '받는분 우편번호', side: 'R' }
    if (isAddr) return { spec: T('{r_addr}'), how: 'auto', reason: '받는분 주소', side: 'R' }
    return { spec: T('{r_name}'), how: 'auto', reason: '받는분 이름', side: 'R' }
  }
  // 쪽 표시 없는 연락처 · 우편 · 주소 → 바로 앞 칸의 쪽을 따른다
  if (isPhone) return side === 'S'
    ? { spec: T('{manager_phone}'), how: 'check', reason: '연락처 — 앞 칸이 보내는분이라 보내는분 연락처로 봄' }
    : { spec: T('{r_phone}'), how: 'check', reason: '연락처 — 앞 칸이 받는분이라 받는분 연락처로 봄' }
  if (isZip) return side === 'S' ? { spec: BLANK, how: 'check', reason: '우편번호(보내는분 쪽)' } : { spec: T('{r_zip}'), how: 'check', reason: '우편번호(받는분 쪽)' }
  if (isAddr) return side === 'S' ? { spec: BLANK, how: 'check', reason: '주소(보내는분 쪽)' } : { spec: T('{r_addr}'), how: 'check', reason: '주소(받는분 쪽)' }
  if (/^(성명|이름|고객명)$/.test(t)) return { spec: T('{r_name}'), how: 'check', reason: '이름 — 받는분으로 봄' }
  if (/^(no\.?|번호|순번|연번)$/i.test(t)) return { spec: T('{line_no}'), how: 'auto', reason: '순번' }
  return null
}

// 머리 칸(표 위쪽) 라벨 → 오른쪽 빈 칸에 넣을 값
const LABELS: [RegExp, ValueSpec, string][] = [
  [/^(상호|상호명|업체명|회사명)$/, T('{co_corp}'), '상호'],
  [/^(대표자|대표자명|대표)$/, T('{co_ceo}'), '대표자'],
  [/사업자.*번호|^사업자$/, T('{co_bizno}'), '사업자등록번호'],
  [/^(소재지|사업장주소|주소)$/, T('{co_addr}'), '다올 주소'],
  [/^담당자/, T('{staff_title}'), '다올 담당자'],
  [/이메일|e-?mail/i, T('{co_email}'), '이메일'],
  [/^(fax|팩스)$/i, T('{co_fax}'), '팩스'],
  [/^(tel|전화|전화번호|대표번호)$/i, T('{co_tel}'), '대표번호'],
  [/^(연락처|핸드폰|휴대폰)$/, T('{staff_phone}'), '다올 담당자 연락처'],
  [/^(발주일|발주일자|작성일|주문일)$/, T('{po_date}'), '발주일'],
  [/^(납품처|배송처)$/, T('{customer}'), '주문처'],
]

// ── 칸 도우미 ────────────────────────────────────────────
const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const textOf = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map(t => t.text).join('')
  if (typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object))) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') return ''
  return String(v)
}
const isFormula = (c: Cell) => { const v = c.value as unknown; return !!v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object)) }
const isSlave = (c: Cell) => c.isMerged && c.master && c.master.address !== c.address
const clean = (s: string) => s.replace(/\s+/g, '').replace(/^[★*※]+/, '').replace(/[:：]$/, '')
const hasBorder = (c: Cell) => { const b = c.border; return !!b && !!(b.top || b.bottom || b.left || b.right) }
const isYellow = (c: Cell) => {
  const f = c.fill as { type?: string; fgColor?: { argb?: string } } | undefined
  const a = f?.type === 'pattern' ? (f.fgColor?.argb ?? '') : ''
  return /FFFF00$|FFFF99$|FFFFCC$/i.test(a)
}

function headerCells(ws: Worksheet, r: number) {
  const out: { col: number; text: string; cell: Cell }[] = []
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
    if (isSlave(cell) || isFormula(cell)) return
    const raw = textOf(cell.value).trim()
    if (!raw || raw.length > 40) return
    out.push({ col, text: raw, cell })
  })
  return out
}

function recognizeSheet(ws: Worksheet): RecognizedSheet {
  const state = (ws.state ?? 'visible') as RecognizedSheet['state']
  const base: RecognizedSheet = { name: ws.name, state, header_row: null, start_row: null, end_row: null, insert_before: null, example_rows: 0, mode: null, columns: [], cells: [], notes: [] }
  // 1) 머리글 행 — 앞 15행 중 인식되는 칸이 가장 많은 행(3칸 이상)
  let best: { r: number; hits: number } | null = null
  const lastScan = Math.min(ws.rowCount, 15)
  for (let r = 1; r <= lastScan; r++) {
    const hits = headerCells(ws, r).filter(h => classify(clean(h.text), 'R')).length
    if (hits >= 3 && (!best || hits > best.hits)) best = { r, hits }
  }
  if (!best) { base.notes.push('머리글 행을 찾지 못했습니다 — 칸을 직접 지정하세요.'); base.mode = 'cells-only'; return base }
  const hr = best.r
  base.header_row = hr

  // 위 행의 묶음 머리(받는분 / 보내는분)가 있으면 아래 칸 해석에 쓴다
  const groupAbove = new Map<number, string>()
  if (hr > 1) for (const h of headerCells(ws, hr - 1)) {
    const m = h.cell.isMerged ? ws.getCell(h.cell.address) : h.cell
    const span = (ws as unknown as { _merges: Record<string, { top: number; left: number; right: number }> })._merges?.[m.address]
    const from = span ? span.left : h.col, to = span ? span.right : h.col
    for (let c = from; c <= to; c++) groupAbove.set(c, clean(h.text))
  }

  // 2) 열 → 값 추천
  let side: 'S' | 'R' = 'R'
  const heads = headerCells(ws, hr)
  for (const h of heads) {
    const t = clean(h.text)
    const g = groupAbove.get(h.col) ?? ''
    const hit = classify((SIDE_S.test(g) || SIDE_R.test(g)) && !SIDE_S.test(t) && !SIDE_R.test(t) ? g + t : t, side)
    const required = /^[★*]/.test(h.text.trim()) || isYellow(h.cell)
    if (hit?.side) side = hit.side
    base.columns.push(hit
      ? { col: colLetter(h.col), header: h.text.trim(), spec: hit.spec, how: hit.how, reason: hit.reason, required }
      : { col: colLetter(h.col), header: h.text.trim(), spec: SKIP, how: 'none', reason: '모르는 머리글 — 직접 고르세요', required })
  }

  // 3) 시작 행 — 머리글 바로 아래. 둘째 머리글 줄(인식되는 칸 3개 이상)이면 한 줄 더 내려간다
  let start = hr + 1
  if (headerCells(ws, start).filter(h => classify(clean(h.text), 'R')).length >= 3) { start += 1; base.notes.push(`머리글이 두 줄입니다(${hr}~${hr + 1}행).`) }
  base.start_row = start

  // 4) 품목 목록 인쇄형(catalog) — 품명 열에 5행 이상 이름이 이미 있고 수량 열이 비어 있음
  const nameCol = base.columns.find(c => c.spec.k === 'tpl' && c.spec.v === '{item_name}')
  const qtyCol = base.columns.find(c => c.spec.k === 'tpl' && c.spec.v === '{qty}')
  // 시작 행부터 이어진 품명 행(병합 칸 제외) — 그 구간에 수량이 하나도 없으면 인쇄형
  const filled = (addr: string) => { const c = ws.getCell(addr); return !isSlave(c) && !!textOf(c.value).trim() }
  if (nameCol && qtyCol) {
    let last = start - 1, qtys = 0
    for (let r = start; r <= Math.min(ws.rowCount, start + 300); r++) {
      if (!filled(`${nameCol.col}${r}`)) break
      last = r
      if (filled(`${qtyCol.col}${r}`)) qtys++
    }
    const n = last - start + 1
    if (n >= 5 && qtys === 0) {
      base.mode = 'catalog'
      base.end_row = last
      base.notes.push(`품목이 인쇄된 양식입니다(${start}~${last}행, ${n}개) — 같은 품명 행에 수량만 넣습니다. 목록에 없는 품목은 경고.`)
      base.cells = headerBlockCells(ws, hr)
      return base
    }
  }
  base.mode = 'rows'

  // 5) 예시 행 — 시작 행부터 값이 적힌 행(인식된 열 2칸 이상)
  const valued = base.columns.filter(c => c.spec.k === 'tpl')
  let ex = 0
  for (let r = start; r <= Math.min(ws.rowCount, start + 30); r++) {
    const n = valued.filter(c => { const cell = ws.getCell(`${c.col}${r}`); return !isFormula(cell) && textOf(cell.value).trim() }).length
    if (n >= 2) ex = r - start + 1; else break
  }
  base.example_rows = ex
  if (ex) base.notes.push(`예시 행 ${ex}개가 있습니다(${start}~${start + ex - 1}행) — 지우고 채웁니다.`)

  // 6) 양식 값 유지 · 수식 열 — 모르는 열 중 시작 행에 값이 미리 적혀 있으면 유지, 수식이면 그대로
  for (const c of base.columns) {
    const cell = ws.getCell(`${c.col}${start}`)
    if (isFormula(cell)) { c.spec = SKIP; c.how = 'auto'; c.reason = '수식 칸 — 그대로 둠'; continue }
    if (c.how === 'none' && !ex && textOf(cell.value).trim()) { c.spec = { k: 'keep' }; c.how = 'check'; c.reason = '양식에 미리 적힌 값 — 모든 행에 반복' }
  }

  // 7) 준비된 행(테두리)과 꼬리 영역(안내 줄 · 합계)
  const probe = (valued[0]?.col) ?? base.columns[0]?.col ?? 'A'
  let end = start
  for (let r = start; r <= Math.min(ws.rowCount, start + 500); r++) {
    const cell = ws.getCell(`${probe}${r}`)
    if (hasBorder(cell) || isFormula(cell)) end = r; else break
  }
  let tail: number | null = null
  for (let r = end + 1; r <= Math.min(ws.rowCount, end + 40); r++) {
    let has = false
    ws.getRow(r).eachCell({ includeEmpty: false }, cell => { if (textOf(cell.value).trim() || isFormula(cell)) has = true })
    if (has) { tail = r; break }
  }
  if (end > start + 1) base.end_row = end
  if (tail) {
    base.insert_before = tail
    if (!base.end_row) base.end_row = Math.max(start, tail - 1)
    base.notes.push(`${tail}행부터 안내 · 합계 영역 — 행이 모자라면 그 앞에 끼워 넣습니다.`)
  }

  // 8) 머리 칸(표 위쪽 라벨 → 값)
  base.cells = headerBlockCells(ws, hr)
  return base
}

function headerBlockCells(ws: Worksheet, hr: number): RecognizedCell[] {
  const out: RecognizedCell[] = []
  for (let r = 1; r < hr; r++) {
    const row = ws.getRow(r)
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (isSlave(cell) || isFormula(cell)) return
      const label = clean(textOf(cell.value))
      if (!label || label.length > 12) return
      const hit = LABELS.find(([re]) => re.test(label))
      if (!hit) return
      // 값 칸 = 라벨 아래(자기 열에서 시작하는 빈 칸) → 없으면 라벨 오른쪽 빈 칸. 둘 다 테두리 있는 빈 칸만
      const merges = (ws as unknown as { _merges: Record<string, { right: number; bottom: number }> })._merges ?? {}
      const span = merges[cell.address]
      const masterOf = (c: Cell) => (isSlave(c) ? c.master : c)
      const right = masterOf(ws.getCell(r, (span ? span.right : col) + 1))
      const belowRaw = ws.getCell((span ? span.bottom : r) + 1, col)
      const below = masterOf(belowRaw)
      const usable = (c: Cell) => !isFormula(c) && !textOf(c.value).trim() && hasBorder(c)
      // 아래 칸이 왼쪽에서 이어진 병합(다른 라벨의 값 칸)이 아니면 아래가 우선 — 라벨 줄 + 값 줄 배치(두일지엘 담당자 · 이메일 · 연락처)
      const belowOwn = usable(below) && Number(below.col) === col
      const tgt = belowOwn ? below : usable(right) ? right : null
      if (!tgt) return    // 이미 값이 있으면(업체 정보 · 수식) 건드리지 않는다
      out.push({ addr: tgt.address, label: textOf(cell.value).trim(), spec: hit[1], how: 'check', reason: `'${textOf(cell.value).trim()}' 오른쪽 빈 칸 → ${hit[2]}` })
    })
  }
  // 같은 칸이 두 번 잡히면 처음 것만
  return out.filter((c, i) => out.findIndex(x => x.addr === c.addr) === i)
}

export async function recognizeForm(file: ArrayBuffer | Buffer): Promise<RecognizeResult> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(file as ArrayBuffer)
  const sheets = wb.worksheets.map(recognizeSheet)
  const visible = sheets.filter(s => s.state === 'visible')
  // 채울 시트 = 머리글이 잡힌 보이는 시트 중 인식 칸이 가장 많은 것
  const target = [...visible].filter(s => s.header_row).sort((a, b) =>
    b.columns.filter(c => c.how !== 'none').length - a.columns.filter(c => c.how !== 'none').length)[0] ?? null
  const notes: string[] = []
  if (!target) notes.push('품목 표를 찾지 못했습니다 — 시트와 칸을 직접 지정하세요.')
  if (wb.worksheets.length > 1) notes.push(`시트 ${wb.worksheets.length}개 — 채우는 시트 외에는 그대로 둡니다.`)
  const mapping: FormMapping = { version: 1, sheets: [] }
  if (target) mapping.sheets.push(toSheetMap(target))
  return { sheets, target: target?.name ?? null, mapping, notes }
}
