// 개별 배송 명단 공용 로직 (707, 2026-11-09 사용자 확정)
//  - 표준 양식 엑셀만 받는다 (헤더 고정 · 자유 매핑 없음). 헤더가 다르면 어느 열이 다른지 안내.
//  - 수령인 행은 상담/주문 품목에 연결(item_name·item_code) — 발주서는 이 이름으로 매칭한다.
//  - 우편번호: 항목만 두고 확인·경고·결합 없음 (주소 앞에 붙이지 않는다).
//  - 매입처 자체 발주서 양식(lib/custom-po.ts)은 자동 채움 대상 아님.
import * as XLSX from 'xlsx'

export const ROSTER_TEMPLATE_HEADERS = ['NO', '수령인', '연락처', '우편번호', '주소', '상세주소', '상품명', '수량', '배송메모'] as const
export const ROSTER_MIGRATION_HINT =
  '707 마이그레이션(배송명단)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
export const isRosterMissing = (msg: string) =>
  /erp_delivery_roster|delivery-rosters|relation .* does not exist|bucket/i.test(msg)
export const ROSTER_BUCKET = 'delivery-rosters'
export const ROSTER_MAX_BYTES = 5 * 1024 * 1024

// 헤더 비교용 정규화 — 공백·괄호 안 설명("(선택)")·마침표 무시
export const normHeader = (v: unknown) =>
  String(v ?? '').replace(/\([^)]*\)/g, '').replace(/[\s.]/g, '').trim()
// 상품명 매칭용 정규화 — 공백·대소문자 무시
export const normName = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toLowerCase()

export interface RosterRowInput {
  id?: string | null
  seq: number
  recipient_name: string | null
  phone: string | null
  zip: string | null
  addr1: string | null
  addr2: string | null
  item_name_raw: string | null
  product_id: string | null
  item_code: string | null
  item_name: string | null       // 연결된 품목 상품명 (null = 미연결)
  quantity: number
  memo: string | null
}

// 연결 후보 — 상담 품목 또는 주문 품목 (부자재·배송비 행 제외는 호출부에서)
export interface RosterItemCandidate {
  product_id: string | null
  item_code: string | null
  item_name: string
  order_kind: string | null
  quantity: number
}

const t = (v: unknown) => {
  const s = String(v ?? '').trim()
  return s || null
}
const toInt = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^\d-]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

// 상품명(또는 품번)으로 품목 연결 — 정확 일치만 (추천은 화면에서, 확정은 사용자)
export function linkItem(raw: string | null, cands: RosterItemCandidate[]) {
  if (!raw) return null
  const key = normName(raw)
  const hit = cands.find(c => normName(c.item_name) === key)
    ?? cands.find(c => c.item_code && normName(c.item_code) === key)
  return hit ?? null
}

// 표준 양식 파싱. 헤더가 다르면 error에 어느 열이 다른지 담아 돌려준다.
export function parseRosterWorkbook(buffer: Buffer, cands: RosterItemCandidate[]):
  { rows: RosterRowInput[]; skipped: number } | { error: string } {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const wsName = wb.SheetNames[0]
  if (!wsName) return { error: '시트가 없는 파일입니다.' }
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
  const headerIdx = grid.findIndex(r => r.some(c => normHeader(c) === '수령인'))
  if (headerIdx < 0) return { error: `표준 양식이 아닙니다 — 첫 행에 ${ROSTER_TEMPLATE_HEADERS.join(' | ')} 헤더가 있어야 합니다. "양식 다운로드"로 받은 파일에 작성해주세요.` }

  const header = grid[headerIdx].map(normHeader)
  const want = ROSTER_TEMPLATE_HEADERS.map(normHeader)
  const bad: string[] = []
  want.forEach((w, i) => { if (header[i] !== w) bad.push(`${i + 1}번째 열: "${ROSTER_TEMPLATE_HEADERS[i]}" 자리에 "${grid[headerIdx][i] ?? ''}"`) })
  if (bad.length) return { error: `표준 양식과 열이 다릅니다 — ${bad.join(', ')}. 열 순서와 이름을 양식 그대로 맞춰주세요.` }

  const rows: RosterRowInput[] = []
  let skipped = 0
  let seq = 0
  for (const r of grid.slice(headerIdx + 1)) {
    const [, name, phone, zip, addr1, addr2, item, qty, memo] = r
    const empty = [name, phone, addr1, addr2, item].every(v => !t(v))
    if (empty) continue
    if (!t(name) && !t(addr1)) { skipped++; continue }     // 수령인도 주소도 없는 줄은 버림
    const raw = t(item)
    const hit = linkItem(raw, cands)
    seq += 1
    rows.push({
      seq, recipient_name: t(name), phone: t(phone), zip: t(zip), addr1: t(addr1), addr2: t(addr2),
      item_name_raw: raw,
      product_id: hit?.product_id ?? null, item_code: hit?.item_code ?? null, item_name: hit?.item_name ?? null,
      quantity: toInt(qty) || 1,
      memo: t(memo),
    })
  }
  if (!rows.length) return { error: '명단 행이 없습니다. 헤더 아래에 수령인 행을 적어주세요.' }
  return { rows, skipped }
}

// 요약 — 화면 KPI·확인할 것 (우편번호는 세지 않는다)
export function rosterSummary(rows: RosterRowInput[], cands: RosterItemCandidate[]) {
  const recipients = new Set(rows.map(r => normName(r.recipient_name) || `#${r.seq}`)).size
  const unlinked = rows.filter(r => !r.item_name).length
  const noPhone = rows.filter(r => !r.phone).length
  const byItem = new Map<string, number>()
  for (const r of rows) if (r.item_name) byItem.set(r.item_name, (byItem.get(r.item_name) ?? 0) + r.quantity)
  const qtyCheck = cands.map(c => ({
    item_name: c.item_name,
    item_qty: c.quantity,
    roster_qty: byItem.get(c.item_name) ?? 0,
  })).filter(x => x.roster_qty > 0 || x.item_qty > 0)
  const mismatch = qtyCheck.filter(x => x.roster_qty > 0 && x.roster_qty !== x.item_qty)
  return {
    row_count: rows.length,
    recipient_count: recipients,
    roster_qty: rows.reduce((s, r) => s + r.quantity, 0),
    unlinked, no_phone: noPhone,
    qty_check: qtyCheck, mismatch_count: mismatch.length,
  }
}

// 발주서 배송명단용 — 주소는 addr1 + 상세만 (우편번호 결합 금지)
export const rosterAddr = (r: { addr1: string | null; addr2: string | null }) =>
  [r.addr1, r.addr2].filter(Boolean).join(' ')

// 표준 양식 엑셀 (양식 다운로드)
export async function buildRosterTemplate(): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('배송명단')
  ws.addRow([...ROSTER_TEMPLATE_HEADERS])
  ws.getRow(1).font = { name: '맑은 고딕', size: 10, bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
  ws.addRow([1, '홍길동 과장님', '010-0000-0000', '', '경기 고양시 일산서구 ○○로 1', '2층 총무과', '상품명을 상담 품목과 같게', 1, ''])
  ws.getRow(2).font = { name: '맑은 고딕', size: 10, color: { argb: 'FF94A3B8' } }
  const widths = [6, 16, 16, 10, 40, 20, 28, 8, 24]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

// 명단 엑셀 다운로드 (현재 행 — 표준 양식과 같은 열)
export async function buildRosterExcel(rows: RosterRowInput[]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('배송명단')
  ws.addRow([...ROSTER_TEMPLATE_HEADERS])
  ws.getRow(1).font = { name: '맑은 고딕', size: 10, bold: true }
  for (const r of rows) {
    ws.addRow([r.seq, r.recipient_name ?? '', r.phone ?? '', r.zip ?? '', r.addr1 ?? '', r.addr2 ?? '',
      r.item_name ?? r.item_name_raw ?? '', r.quantity, r.memo ?? ''])
  }
  const widths = [6, 16, 16, 10, 40, 20, 28, 8, 24]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  return Buffer.from(await wb.xlsx.writeBuffer())
}
