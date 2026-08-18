// =====================================================
// sample-stock-import.mjs
// 요아럽 샘플 재고 — 엑셀 원장("상세내역" 시트) → erp_sample_moves 이관
// (docs/sample-stock-track.md 트랙. 실행 전 800_sample_stock.sql 적용 필수)
//
// 사용법:
//   node scripts/sample-stock-import.mjs <엑셀경로>            # 드라이런 (DB 쓰기 없음)
//   node scripts/sample-stock-import.mjs <엑셀경로> --execute  # 사용자 승인 후 실행
//
// 환경: .env.local 의 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//       (서비스 키는 저장소에 없음 — 사용자에게 요청)
//
// 절차 (CLAUDE.md DB 변경 루틴): 드라이런(대조 통계) → 승인 → 실행 → 검증 보고.
// 검증 기준: 품목별 전산재고(입고−출고±조정)가 엑셀 "집계" 시트와 전 품목 일치.
// =====================================================
import { createClient } from '@supabase/supabase-js'
import xlsx from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'

const EXCEL_PATH = process.argv[2]
const EXECUTE = process.argv.includes('--execute')

if (!EXCEL_PATH || !fs.existsSync(EXCEL_PATH)) {
  console.error('엑셀 파일 경로를 지정하세요: node scripts/sample-stock-import.mjs <경로> [--execute]')
  process.exit(1)
}

// ── .env.local 로드 (dotenv 없이 직접 파싱) ─────────────
function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(.env.local)가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── 품명 정규화 (드라이런 확정 규칙 — 트랙 문서 그대로) ──
// 전각 ＆, 괄호·용량(ml) 제거, 앰버/엠버, 클렌저/클렌져, 시트러시유주/유즈,
// '케어' 유무, 어순(디퓨저 향명) 차이 흡수.
function normalizeName(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/＆/g, '&')
  s = s.replace(/\([^)]*\)/g, ' ')          // 괄호 내용 제거
  s = s.replace(/\d+(\.\d+)?\s*ml/gi, ' ')  // 용량 제거
  s = s.replace(/엠버/g, '앰버')
  s = s.replace(/클렌져/g, '클렌저')
  s = s.replace(/유주/g, '유즈')
  s = s.replace(/케어/g, '')                // '케어' 유무 흡수 (바디케어세트/바디세트)
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
// 어순 무시 키: 정규화 후 공백 분리 토큰을 정렬해 결합
function orderFreeKey(raw) {
  return normalizeName(raw).split(' ').filter(Boolean).sort().join('|')
}

// ── 확정 별칭 (엑셀 표기 → 마스터 품명) ─────────────────
// 2026-08-18 사용자 확정: 솝&바디 세트 / 핸드크림 3P 케이스 / 고급쇼핑백(대표 25-01-06-01)
// + 내츄럴 마일드 선크림 1P·3P는 '요아럽 마일드 선크림'과 동일품으로 통합.
const ALIAS_TO_ITEM_CODE = {
  // '고급쇼핑백' 은 마스터 2종 중 품번 25-01-06-01 을 대표로 사용 (사용자 확정)
}
const ALIAS_TO_MASTER_NAME = [
  { test: (n) => n.includes('솝') && n.includes('바디'), master: '바이탈라이징 솝&바디세트' },
  { test: (n) => n.includes('핸드크림') && n.includes('3P') && n.includes('공용') && n.includes('아이보리'),
    master: '핸드크림 3P 공용 종이케이스(아이보리)' },
  { test: (n) => n.includes('내츄럴') && n.includes('마일드') && n.includes('선크림') && n.includes('1P'),
    master: '요아럽 마일드 선크림 1P' },
  { test: (n) => n.includes('내츄럴') && n.includes('마일드') && n.includes('선크림') && n.includes('3P'),
    master: '요아럽 마일드 선크림 3P' },
]
const PREMIUM_BAG_ITEM_CODE = '25-01-06-01' // 고급쇼핑백 대표 품목 (사용자 확정)

// ── 엑셀 파싱: "상세내역" 시트, 머리글 6행 · 데이터 7행부터 ──
// 컬럼: NO·날짜·품명·매입가·입고·출고·출고처·담당자·매입합계액·출고합계액·비고
function excelDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = xlsx.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim().replace(/\./g, '-').replace(/\s/g, '')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}
function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const wb = xlsx.readFile(EXCEL_PATH, { cellDates: false })
const detailSheet = wb.Sheets['상세내역']
if (!detailSheet) {
  console.error(`"상세내역" 시트가 없습니다. 시트 목록: ${wb.SheetNames.join(', ')}`)
  process.exit(1)
}
const rows = xlsx.utils.sheet_to_json(detailSheet, { header: 1, raw: true, defval: null })
// 7행부터 (0-based index 6). 열 순서: 0 NO / 1 날짜 / 2 품명 / 3 매입가 / 4 입고 /
// 5 출고 / 6 출고처 / 7 담당자 / 8 매입합계액 / 9 출고합계액 / 10 비고
const ledger = []
for (let i = 6; i < rows.length; i++) {
  const r = rows[i]
  if (!r) continue
  const name = r[2] == null ? '' : String(r[2]).trim()
  const date = excelDate(r[1])
  const qtyIn = num(r[4])
  const qtyOut = num(r[5])
  if (!name || !date) continue
  if (!qtyIn && !qtyOut) continue
  ledger.push({
    excel_row: i + 1,
    move_date: date,
    item_name_raw: name,
    unit_cost: num(r[3]),
    qty_in: qtyIn || 0,
    qty_out: qtyOut || 0,
    dest_name: r[6] == null ? null : String(r[6]).trim() || null,
    staff_name: r[7] == null ? null : String(r[7]).trim() || null,
    in_total: num(r[8]),
    out_total: num(r[9]),
    note: r[10] == null ? null : String(r[10]).trim() || null,
  })
}

async function main() {
  console.log(`상세내역 실데이터: ${ledger.length}행`)
  const inRows = ledger.filter((l) => l.qty_in > 0)
  const outRows = ledger.filter((l) => l.qty_out > 0)
  console.log(`  입고 ${inRows.length}행 · ${inRows.reduce((s, l) => s + l.qty_in, 0)}개 / 매입액 합 ${inRows.reduce((s, l) => s + (l.in_total || 0), 0).toLocaleString()}원`)
  console.log(`  출고 ${outRows.length}행 · ${outRows.reduce((s, l) => s + l.qty_out, 0)}개 / 매입비 합 ${outRows.reduce((s, l) => s + (l.out_total || 0), 0).toLocaleString()}원`)
  console.log(`  기간 ${ledger.reduce((a, l) => (l.move_date < a ? l.move_date : a), '9999')} ~ ${ledger.reduce((a, l) => (l.move_date > a ? l.move_date : a), '0000')}`)
  console.log('  (드라이런 기준치: 2,087행 / 입고 239행·7,170개·33,406,200원 / 출고 1,848행·5,942개·29,963,250원)')

  // ── 품목 마스터 매칭 ──────────────────────────────────
  const { data: products, error: pErr } = await sb
    .from('erp_products')
    .select('id, item_code, item_name, purchase_price')
    .limit(2000)
  if (pErr) throw pErr
  console.log(`\n품목 마스터: ${products.length}종 로드`)

  const byNorm = new Map()
  const byOrderFree = new Map()
  for (const p of products) {
    byNorm.set(normalizeName(p.item_name), p)
    byOrderFree.set(orderFreeKey(p.item_name), p)
  }
  const premiumBag = products.find((p) => p.item_code === PREMIUM_BAG_ITEM_CODE)

  function matchProduct(rawName) {
    // 1) 고급쇼핑백 → 대표 품목 고정
    if (normalizeName(rawName) === '고급쇼핑백') return premiumBag || null
    // 2) 확정 별칭
    for (const a of ALIAS_TO_MASTER_NAME) {
      if (a.test(rawName)) {
        const hit = byNorm.get(normalizeName(a.master)) || byOrderFree.get(orderFreeKey(a.master))
        if (hit) return hit
      }
    }
    // 3) 정규화 일치 → 4) 어순 무시 일치
    return byNorm.get(normalizeName(rawName)) || byOrderFree.get(orderFreeKey(rawName)) || null
  }

  const unmatched = new Map()
  let matchedRows = 0
  for (const l of ledger) {
    const p = matchProduct(l.item_name_raw)
    l.product = p
    if (p) matchedRows++
    else unmatched.set(l.item_name_raw, (unmatched.get(l.item_name_raw) || 0) + 1)
  }
  console.log(`품명 매칭: ${matchedRows}/${ledger.length}행 (${((matchedRows / ledger.length) * 100).toFixed(1)}%)`)
  if (unmatched.size) {
    console.log('미매칭 품명 (등록·별칭 확인 필요):')
    for (const [n, c] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) console.log(`  - ${n} (${c}행)`)
  }

  // ── 담당자 → 직원 마스터 매칭 ─────────────────────────
  const { data: employees, error: eErr } = await sb.from('employees').select('id, name').limit(500)
  if (eErr) throw eErr
  const empByName = new Map(employees.map((e) => [e.name.trim(), e]))
  const staffStats = new Map()
  for (const l of ledger) {
    if (!l.staff_name) continue
    l.employee = empByName.get(l.staff_name) || null
    const k = l.staff_name
    const s = staffStats.get(k) || { rows: 0, linked: !!l.employee }
    s.rows++
    staffStats.set(k, s)
  }
  const linkedNames = [...staffStats.entries()].filter(([, s]) => s.linked)
  const unlinkedNames = [...staffStats.entries()].filter(([, s]) => !s.linked)
  console.log(`\n담당자 ${staffStats.size}종: 직원 연결 ${linkedNames.length}명 / 미연결 ${unlinkedNames.length}명 (원본 표기 보존)`)
  for (const [n, s] of unlinkedNames) console.log(`  - 미연결: ${n} (${s.rows}행)`)

  // ── 품목별 전산재고 (검증용) ──────────────────────────
  const stockByProduct = new Map()
  for (const l of ledger) {
    const key = l.product ? l.product.item_name : `[미매칭] ${l.item_name_raw}`
    const s = stockByProduct.get(key) || { in: 0, out: 0 }
    s.in += l.qty_in
    s.out += l.qty_out
    stockByProduct.set(key, s)
  }
  console.log('\n품목별 전산재고 (입고−출고) — 엑셀 "집계" 시트와 대조할 것:')
  for (const [name, s] of [...stockByProduct.entries()].sort()) {
    console.log(`  ${name}: 입고 ${s.in} − 출고 ${s.out} = ${s.in - s.out}`)
  }

  if (!EXECUTE) {
    console.log('\n[드라이런 종료] DB에 쓰지 않았습니다. 결과 승인 후 --execute로 실행하세요.')
    return
  }

  // ── 실행: erp_sample_moves 적재 ───────────────────────
  if (unmatched.size) {
    console.log('\n[주의] 미매칭 품명이 남아 있습니다. product_id NULL(원본 표기만)로 적재합니다.')
  }
  const { count: existing } = await sb
    .from('erp_sample_moves')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'excel')
  if (existing && existing > 0) {
    console.error(`이미 source=excel 행이 ${existing}건 존재합니다. 중복 적재 방지를 위해 중단합니다.`)
    process.exit(1)
  }

  const payload = ledger.map((l) => ({
    move_date: l.move_date,
    move_type: l.qty_in > 0 ? 'in' : 'out',
    product_id: l.product?.id ?? null,
    item_name_raw: l.item_name_raw,
    quantity: l.qty_in > 0 ? l.qty_in : l.qty_out,
    unit_cost: l.unit_cost,
    total_cost: l.qty_in > 0 ? l.in_total : l.out_total,
    purpose: null, // 과거 이관분은 용도 미지정 (사용자 결정 대기)
    dest_name: l.qty_out > 0 ? l.dest_name : l.dest_name, // 입고 행도 원본 보존
    staff_name: l.staff_name,
    employee_id: l.employee?.id ?? null,
    contact_id: null,
    note: l.note,
    source: 'excel',
  }))
  // 입고·출고가 한 행에 같이 있는 경우는 없다고 파악됨 — 있으면 중단
  const both = ledger.filter((l) => l.qty_in > 0 && l.qty_out > 0)
  if (both.length) {
    console.error(`입고·출고가 동시에 기재된 행 ${both.length}건 — 처리 규칙 확인 필요. 중단합니다.`)
    for (const b of both.slice(0, 5)) console.error(`  엑셀 ${b.excel_row}행: ${b.item_name_raw}`)
    process.exit(1)
  }

  console.log(`\n적재 시작: ${payload.length}행 (500행 청크)`)
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500)
    const { error } = await sb.from('erp_sample_moves').insert(chunk)
    if (error) {
      console.error(`청크 ${i}~${i + chunk.length} 적재 실패:`, error.message)
      process.exit(1)
    }
    console.log(`  ${Math.min(i + 500, payload.length)}/${payload.length}`)
  }

  // is_sample_stock 플래그: 원장에 등장한 품목 전부 지정
  const productIds = [...new Set(ledger.filter((l) => l.product).map((l) => l.product.id))]
  for (let i = 0; i < productIds.length; i += 100) {
    const { error } = await sb
      .from('erp_products')
      .update({ is_sample_stock: true })
      .in('id', productIds.slice(i, i + 100))
    if (error) {
      console.error('is_sample_stock 플래그 갱신 실패:', error.message)
      process.exit(1)
    }
  }
  console.log(`is_sample_stock 플래그 지정: ${productIds.length}종`)

  // ── 검증: 건수 대사 ───────────────────────────────────
  const { count: loaded } = await sb
    .from('erp_sample_moves')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'excel')
  console.log(`\n[검증] 적재 건수: ${loaded} (기대 ${payload.length}) ${loaded === payload.length ? '— 일치' : '— 불일치!'}`)
  console.log('품목별 전산재고는 위 드라이런 표와 엑셀 집계 시트를 대조해 검증 보고를 남길 것.')
}

main().catch((e) => {
  console.error('오류:', e)
  process.exit(1)
})
