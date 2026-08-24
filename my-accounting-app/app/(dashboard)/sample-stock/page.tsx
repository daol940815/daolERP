'use client'

// 샘플 재고 관리 (요아럽 · 사무실 재고)
// - 사무실 입출고 원장(erp_sample_moves)이 원본 — 전산재고는 입고−출고±조정으로 실시간 계산
// - 소진 비용은 사무실 원장 출고 + 요아럽 창고 출고(기존 주문내역 샘플 행, 무수정) 통합
// 시안: docs/mockups/sample-stock.html (2026-08-24 사용자 확정)

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')
const today = () => new Date().toISOString().slice(0, 10)

interface StockRow {
  key: string
  productId: string | null
  name: string
  unlinked: boolean
  purchasePrice: number
  inQty: number
  outQty: number
  adjQty: number
  computedQty: number
  stockValue: number
  lastOutDate: string | null
  takeDate: string | null
  countedQty: number | null
  takeDiff: number | null
}
interface CostRow { d: string; staff: string; linked?: boolean; purpose?: 'sales' | 'gift' | null; cost: number }
interface Employee { id: string; name: string }
interface MoveRow {
  id: string
  move_date: string
  move_type: 'in' | 'out' | 'adjust'
  product_id: string | null
  item_name_raw: string | null
  display_name: string
  quantity: number
  unit_cost: number | null
  total_cost: number | null
  purpose: 'sales' | 'gift' | null
  dest_name: string | null
  staff_name: string | null
  employee_id: string | null
  note: string | null
  source: 'excel' | 'manual'
}

const TYPE_LABEL: Record<string, string> = { in: '입고', out: '출고', adjust: '조정' }

function categoryOf(name: string): string {
  if (name.includes('핸드크림') && !name.includes('케이스')) return '핸드크림'
  if (name.includes('디퓨저') || name.includes('리드스틱')) return '디퓨저'
  if (name.includes('쇼핑백') || name.includes('케이스') || name.includes('포장')) return '부자재'
  if (name.includes('세트')) return '세트'
  return '기타'
}

const chipCls = (on: boolean, tone?: 'warn' | 'danger') =>
  `rounded-full border px-3 py-1 text-xs cursor-pointer whitespace-nowrap transition-colors ${
    on
      ? 'bg-slate-900 text-white border-slate-900'
      : tone === 'warn'
        ? 'bg-white text-amber-700 border-amber-400 hover:bg-amber-50'
        : tone === 'danger'
          ? 'bg-white text-red-700 border-red-400 hover:bg-red-50'
          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
  }`

const badge = (cls: string, label: string) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
)

export default function SampleStockPage() {
  const [loading, setLoading] = useState(true)
  const [migrationOk, setMigrationOk] = useState(true)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [stock, setStock] = useState<StockRow[]>([])
  const [costOffice, setCostOffice] = useState<CostRow[]>([])
  const [costWarehouse, setCostWarehouse] = useState<CostRow[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [movesLoading, setMovesLoading] = useState(true)

  const [tab, setTab] = useState<'stock' | 'cost' | 'ledger'>('stock')

  // 재고 탭 필터
  const [stockSearch, setStockSearch] = useState('')
  const [stockChip, setStockChip] = useState<string>('all') // all | 카테고리 | diff | negative

  // 비용 탭 필터
  const [costYear, setCostYear] = useState<number>(new Date().getFullYear())
  const [costSource, setCostSource] = useState<'all' | 'office' | 'warehouse'>('all')
  const [costPurpose, setCostPurpose] = useState<'all' | 'sales' | 'gift' | 'none'>('all')

  // 원장 탭 필터
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerChip, setLedgerChip] = useState<string>('all') // all | in | out | adjust | gift | unlinked | manual
  const [ledgerMonth, setLedgerMonth] = useState<string | null>(null) // 드릴다운용 YYYY-MM
  const [ledgerPage, setLedgerPage] = useState(1)
  const PAGE = 50

  const [modal, setModal] = useState<'in' | 'out' | 'take' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    const res = await fetch('/api/sample-stock')
    const json = await res.json()
    if (json.migration800 === false) { setMigrationOk(false); setErrMsg(json.error); setLoading(false); return }
    if (json.error) { setErrMsg(json.error); setLoading(false); return }
    setStock(json.stock)
    setCostOffice(json.costOffice)
    setCostWarehouse(json.costWarehouse)
    setEmployees(json.employees)
    setLoading(false)
  }, [])

  const loadMoves = useCallback(async () => {
    setMovesLoading(true)
    const res = await fetch('/api/sample-stock/moves')
    const json = await res.json()
    if (!json.error) setMoves(json.moves)
    setMovesLoading(false)
  }, [])

  useEffect(() => { loadSummary(); loadMoves() }, [loadSummary, loadMoves])

  const reload = useCallback(() => { loadSummary(); loadMoves() }, [loadSummary, loadMoves])

  // ── KPI ──────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totalIn = stock.reduce((s, r) => s + r.inQty, 0)
    const totalOut = stock.reduce((s, r) => s + r.outQty, 0)
    const totalQty = stock.reduce((s, r) => s + r.computedQty, 0)
    const totalValue = stock.reduce((s, r) => s + r.stockValue, 0)
    const ym = new Date().toISOString().slice(0, 7)
    const monthOffice = costOffice.filter((c) => c.d.startsWith(ym)).reduce((s, c) => s + c.cost, 0)
    const monthWh = costWarehouse.filter((c) => c.d.startsWith(ym)).reduce((s, c) => s + c.cost, 0)
    const diffItems = stock.filter((r) => r.takeDiff != null && r.takeDiff !== 0).length
    const lastTake = stock.reduce<string | null>((a, r) => (r.takeDate && (!a || r.takeDate > a) ? r.takeDate : a), null)
    return { items: stock.length, totalIn, totalOut, totalQty, totalValue, monthOffice, monthWh, diffItems, lastTake }
  }, [stock, costOffice, costWarehouse])

  // ── 재고 탭 ──────────────────────────────────────────
  const stockFiltered = useMemo(() => {
    return stock.filter((r) => {
      if (stockSearch && !r.name.toLowerCase().includes(stockSearch.toLowerCase())) return false
      if (stockChip === 'all') return true
      if (stockChip === 'diff') return r.takeDiff != null && r.takeDiff !== 0
      if (stockChip === 'negative') return r.computedQty < 0
      return categoryOf(r.name) === stockChip
    })
  }, [stock, stockSearch, stockChip])

  // ── 비용 탭 ──────────────────────────────────────────
  const costYears = useMemo(() => {
    const ys = new Set<number>()
    for (const c of [...costOffice, ...costWarehouse]) if (c.d) ys.add(Number(c.d.slice(0, 4)))
    return Array.from(ys).sort()
  }, [costOffice, costWarehouse])

  const costMatrix = useMemo(() => {
    // 용도 칩은 사무실 원장에만 적용 — 창고 행은 용도 없음(영업 간주):
    // 영업샘플 필터에는 포함, 선물증정·미지정 필터에는 제외한다.
    const rows: { staff: string; source: 'office' | 'warehouse'; month: number; cost: number }[] = []
    for (const c of costOffice) {
      if (!c.d.startsWith(String(costYear))) continue
      if (costPurpose === 'sales' && c.purpose !== 'sales') continue
      if (costPurpose === 'gift' && c.purpose !== 'gift') continue
      if (costPurpose === 'none' && c.purpose != null) continue
      rows.push({ staff: c.staff, source: 'office', month: Number(c.d.slice(5, 7)), cost: c.cost })
    }
    if (costPurpose === 'all' || costPurpose === 'sales') {
      for (const c of costWarehouse) {
        if (!c.d.startsWith(String(costYear))) continue
        rows.push({ staff: c.staff, source: 'warehouse', month: Number(c.d.slice(5, 7)), cost: c.cost })
      }
    }
    const filtered = rows.filter((r) => costSource === 'all' || r.source === costSource)
    const byStaff = new Map<string, number[]>()
    for (const r of filtered) {
      let arr = byStaff.get(r.staff)
      if (!arr) { arr = Array(13).fill(0); byStaff.set(r.staff, arr) }
      arr[r.month - 1] += r.cost
      arr[12] += r.cost
    }
    const staffRows = Array.from(byStaff.entries()).sort((a, b) => b[1][12] - a[1][12])
    const totals = Array(13).fill(0)
    for (const [, arr] of staffRows) for (let i = 0; i < 13; i++) totals[i] += arr[i]
    return { staffRows, totals }
  }, [costOffice, costWarehouse, costYear, costSource, costPurpose])

  // ── 원장 탭 ──────────────────────────────────────────
  const ledgerFiltered = useMemo(() => {
    const q = ledgerSearch.toLowerCase()
    return moves.filter((m) => {
      if (ledgerMonth && !m.move_date.startsWith(ledgerMonth)) return false
      if (q && ![m.display_name, m.item_name_raw, m.dest_name, m.staff_name, m.note]
        .some((v) => v && v.toLowerCase().includes(q))) return false
      if (ledgerChip === 'all') return true
      if (ledgerChip === 'gift') return m.purpose === 'gift'
      if (ledgerChip === 'unlinked') return !!m.staff_name && !m.employee_id
      if (ledgerChip === 'manual') return m.source === 'manual'
      return m.move_type === ledgerChip
    })
  }, [moves, ledgerSearch, ledgerChip, ledgerMonth])

  const ledgerPageRows = ledgerFiltered.slice((ledgerPage - 1) * PAGE, ledgerPage * PAGE)
  const ledgerPages = Math.max(1, Math.ceil(ledgerFiltered.length / PAGE))

  // 드릴다운: 재고 행 → 해당 품목 원장 / 비용 셀 → 담당자·월 원장
  const drillToItem = (name: string) => {
    setLedgerSearch(name); setLedgerChip('all'); setLedgerMonth(null); setLedgerPage(1); setTab('ledger')
  }
  const drillToStaffMonth = (staff: string, month: number) => {
    setLedgerSearch(staff === '미지정' ? '' : staff)
    setLedgerChip('out')
    setLedgerMonth(`${costYear}-${String(month).padStart(2, '0')}`)
    setLedgerPage(1)
    setTab('ledger')
  }

  if (loading) return <div className="p-8 text-sm text-slate-500">불러오는 중...</div>
  if (!migrationOk || errMsg) {
    return <div className="p-8"><div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{errMsg}</div></div>
  }

  const tabCls = (on: boolean) =>
    `rounded-t-lg px-4 py-2 text-[13.5px] font-semibold cursor-pointer ${on ? 'bg-white text-slate-900 border border-b-0 border-slate-200' : 'bg-slate-200 text-slate-500'}`

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            샘플 재고 관리 <span className="text-[13px] font-medium text-slate-500">요아럽 · 사무실 재고</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            사무실 입출고 원장 기준 전산재고와 창고·사무실 통합 소진 비용. 재고는 입고 누계 − 출고 누계로 자동 계산됩니다.
          </p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setModal('take')} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">실사 입력</button>
          <button onClick={() => setModal('in')} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">입고 입력</button>
          <button onClick={() => setModal('out')} className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-slate-800">출고 입력</button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">{msg}</div>}

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <button onClick={() => { setTab('stock'); setStockChip('all') }} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-slate-400">
          <div className="text-xs text-slate-500">재고 품목</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{kpi.items}<span className="text-[13px] font-medium">종</span></div>
          <div className="mt-0.5 text-[11.5px] text-slate-400">재고 관리 대상 품목</div>
        </button>
        <button onClick={() => setTab('stock')} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-slate-400">
          <div className="text-xs text-slate-500">전산재고 수량</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{won(kpi.totalQty)}<span className="text-[13px] font-medium">개</span></div>
          <div className="mt-0.5 text-[11.5px] text-slate-400">입고 {won(kpi.totalIn)} − 출고 {won(kpi.totalOut)}</div>
        </button>
        <button onClick={() => setTab('stock')} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-slate-400">
          <div className="text-xs text-slate-500">재고 금액 (매입가)</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{won(kpi.totalValue)}<span className="text-[13px] font-medium">원</span></div>
          <div className="mt-0.5 text-[11.5px] text-slate-400">전산재고 × 매입가</div>
        </button>
        <button onClick={() => setTab('cost')} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-slate-400">
          <div className="text-xs text-slate-500">당월 소진 비용 (통합)</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{won(kpi.monthOffice + kpi.monthWh)}<span className="text-[13px] font-medium">원</span></div>
          <div className="mt-0.5 text-[11.5px] text-slate-400">사무실 {won(kpi.monthOffice)} + 창고 {won(kpi.monthWh)}</div>
        </button>
        <button onClick={() => { setTab('stock'); setStockChip('diff') }} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-slate-400">
          <div className="text-xs text-slate-500">실사 오차</div>
          <div className={`mt-1 text-xl font-bold ${kpi.diffItems ? 'text-amber-700' : 'text-slate-900'}`}>{kpi.diffItems}<span className="text-[13px] font-medium">품목</span></div>
          <div className="mt-0.5 text-[11.5px] text-slate-400">{kpi.lastTake ? `최근 실사 ${kpi.lastTake}` : '실사 기록 없음'}</div>
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1">
        <div className={tabCls(tab === 'stock')} onClick={() => setTab('stock')}>재고 현황</div>
        <div className={tabCls(tab === 'cost')} onClick={() => setTab('cost')}>소진 비용 집계</div>
        <div className={tabCls(tab === 'ledger')} onClick={() => setTab('ledger')}>입출고 원장</div>
      </div>

      <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-4">
        {/* ── 탭 1: 재고 현황 ── */}
        {tab === 'stock' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="품명 검색..."
                className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] outline-none focus:border-slate-500"
              />
              {['all', '세트', '핸드크림', '디퓨저', '부자재', '기타'].map((c) => (
                <button key={c} className={chipCls(stockChip === c)} onClick={() => setStockChip(c)}>
                  {c === 'all' ? '전체' : c}
                </button>
              ))}
              <button className={chipCls(stockChip === 'diff', 'warn')} onClick={() => setStockChip('diff')}>오차 있음</button>
              <button className={chipCls(stockChip === 'negative', 'danger')} onClick={() => setStockChip('negative')}>재고 음수</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold whitespace-nowrap">품명</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">매입가</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">입고 누계</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">출고 누계</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">조정</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">전산재고</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">실재고 (최근 실사)</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">오차</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">재고 금액</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">최근 출고</th>
                  </tr>
                </thead>
                <tbody>
                  {stockFiltered.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-2.5 py-2 whitespace-nowrap">
                        <button className="font-semibold text-slate-800 hover:underline" onClick={() => drillToItem(r.name)}>{r.name}</button>
                        {r.unlinked && <span className="ml-1.5">{badge('bg-red-50 text-red-700', '품목 미연결')}</span>}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">{won(r.purchasePrice)}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">{won(r.inQty)}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">{won(r.outQty)}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums text-slate-400">{r.adjQty ? (r.adjQty > 0 ? `+${r.adjQty}` : r.adjQty) : '-'}</td>
                      <td className={`border-b border-slate-100 px-2.5 py-2 text-right font-bold tabular-nums ${r.computedQty < 0 ? 'text-red-600' : ''}`}>{won(r.computedQty)}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums text-slate-500">
                        {r.countedQty != null ? `${won(r.countedQty)} (${r.takeDate?.slice(5)})` : '-'}
                      </td>
                      <td className={`border-b border-slate-100 px-2.5 py-2 text-right tabular-nums ${r.takeDiff ? 'font-bold text-red-600' : 'text-slate-400'}`}>
                        {r.takeDiff != null ? (r.takeDiff > 0 ? `+${r.takeDiff}` : r.takeDiff) : '-'}
                      </td>
                      <td className={`border-b border-slate-100 px-2.5 py-2 text-right tabular-nums ${r.stockValue < 0 ? 'text-red-600' : ''}`}>{won(r.stockValue)}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right text-slate-400">{r.lastOutDate?.slice(5) ?? '-'}</td>
                    </tr>
                  ))}
                  {!stockFiltered.length && (
                    <tr><td colSpan={10} className="px-2.5 py-8 text-center text-slate-400">조건에 맞는 품목이 없습니다.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td className="border-t-2 border-slate-200 px-2.5 py-2">합계 ({stockFiltered.length}품목)</td>
                    <td className="border-t-2 border-slate-200"></td>
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(stockFiltered.reduce((s, r) => s + r.inQty, 0))}</td>
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(stockFiltered.reduce((s, r) => s + r.outQty, 0))}</td>
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(stockFiltered.reduce((s, r) => s + r.adjQty, 0))}</td>
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(stockFiltered.reduce((s, r) => s + r.computedQty, 0))}</td>
                    <td className="border-t-2 border-slate-200"></td>
                    <td className="border-t-2 border-slate-200"></td>
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(stockFiltered.reduce((s, r) => s + r.stockValue, 0))}</td>
                    <td className="border-t-2 border-slate-200"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
              · 전산재고는 저장값이 아니라 원장 합계에서 실시간 계산 — 품명을 클릭하면 해당 품목 원장으로 드릴다운.<br />
              · 오차가 있으면 실사 기록을 고치지 말고 &quot;조정&quot; 원장 행을 추가해 해소 (원본 무수정).<br />
              · 품목 미연결은 품목 마스터 미등록 품명 — 실무자가 품목 관리에서 등록하면 소급 연결 예정. 미연결 품목은 실사 대상에서 제외됩니다.
            </p>
          </>
        )}

        {/* ── 탭 2: 소진 비용 집계 ── */}
        {tab === 'cost' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">기간</span>
              {costYears.map((y) => (
                <button key={y} className={chipCls(costYear === y)} onClick={() => setCostYear(y)}>{y}</button>
              ))}
              <span className="ml-2 text-xs text-slate-400">출처</span>
              <button className={chipCls(costSource === 'all')} onClick={() => setCostSource('all')}>통합</button>
              <button className={chipCls(costSource === 'office')} onClick={() => setCostSource('office')}>사무실</button>
              <button className={chipCls(costSource === 'warehouse')} onClick={() => setCostSource('warehouse')}>요아럽 창고</button>
              <span className="ml-2 text-xs text-slate-400">용도</span>
              <button className={chipCls(costPurpose === 'all')} onClick={() => setCostPurpose('all')}>전체</button>
              <button className={chipCls(costPurpose === 'sales')} onClick={() => setCostPurpose('sales')}>영업샘플</button>
              <button className={chipCls(costPurpose === 'gift')} onClick={() => setCostPurpose('gift')}>선물증정</button>
              <button className={chipCls(costPurpose === 'none')} onClick={() => setCostPurpose('none')}>용도 미지정</button>
            </div>
            <p className="mb-2.5 text-sm font-bold text-slate-800">담당자별 월별 소진 비용 (매입가 기준, {costYear}년)</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">담당자</th>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th key={i} className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">{i + 1}월</th>
                    ))}
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">연간 계</th>
                  </tr>
                </thead>
                <tbody>
                  {costMatrix.staffRows.map(([staff, arr]) => (
                    <tr key={staff} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-2.5 py-2 font-semibold whitespace-nowrap">{staff}</td>
                      {arr.slice(0, 12).map((v, i) => (
                        <td key={i} className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">
                          {v ? (
                            <button className="hover:underline" onClick={() => drillToStaffMonth(staff, i + 1)}>{won(v)}</button>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right font-bold tabular-nums">{won(arr[12])}</td>
                    </tr>
                  ))}
                  {!costMatrix.staffRows.length && (
                    <tr><td colSpan={14} className="px-2.5 py-8 text-center text-slate-400">해당 조건의 소진 내역이 없습니다.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td className="border-t-2 border-slate-200 px-2.5 py-2">월 계</td>
                    {costMatrix.totals.slice(0, 12).map((v, i) => (
                      <td key={i} className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{v ? won(v) : '-'}</td>
                    ))}
                    <td className="border-t-2 border-slate-200 px-2.5 py-2 text-right tabular-nums">{won(costMatrix.totals[12])}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
              · 통합 = 사무실 원장 출고 + 기존 ERP 주문내역 샘플 행(요아럽 창고, 기록된 매입합계액 사용).<br />
              · 담당자는 직원 마스터 연결 시 마스터 이름, 미연결(퇴사자 등)은 원본 표기 그대로 집계.<br />
              · 셀 클릭 시 해당 담당자·월의 사무실 출고 원장으로 드릴다운 (창고 행은 주문내역 화면에서 확인).<br />
              · 용도 칩은 사무실 원장에만 적용 — 창고 행은 용도 없음(영업으로 간주): 영업샘플 칩에 포함, 선물증정·미지정 칩에서 제외. 이관분 과거 출고는 용도 미지정.
            </p>
          </>
        )}

        {/* ── 탭 3: 입출고 원장 ── */}
        {tab === 'ledger' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={ledgerSearch}
                onChange={(e) => { setLedgerSearch(e.target.value); setLedgerPage(1) }}
                placeholder="품명 · 출고처 · 담당자 검색..."
                className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] outline-none focus:border-slate-500"
              />
              {[['all', '전체'], ['in', '입고'], ['out', '출고'], ['adjust', '실사 조정'], ['gift', '선물증정만'], ['unlinked', '직원 미연결'], ['manual', '직접 입력분']].map(([k, label]) => (
                <button key={k} className={chipCls(ledgerChip === k)} onClick={() => { setLedgerChip(k); setLedgerPage(1) }}>{label}</button>
              ))}
              {ledgerMonth && (
                <button className={chipCls(true)} onClick={() => { setLedgerMonth(null); setLedgerPage(1) }}>
                  {ledgerMonth} ×
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">날짜</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">구분</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">품명</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">수량</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">매입가</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">합계액</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">용도</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">출고처</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">담당자</th>
                    <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {movesLoading && (
                    <tr><td colSpan={10} className="px-2.5 py-8 text-center text-slate-400">원장 불러오는 중...</td></tr>
                  )}
                  {!movesLoading && ledgerPageRows.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-2.5 py-2 whitespace-nowrap">{m.move_date}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2">
                        {m.move_type === 'in' && badge('bg-emerald-50 text-emerald-700', '입고')}
                        {m.move_type === 'out' && badge('bg-blue-50 text-blue-700', '출고')}
                        {m.move_type === 'adjust' && badge('bg-yellow-50 text-yellow-700', '조정')}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 font-semibold whitespace-nowrap">
                        {m.display_name}
                        {!m.product_id && <span className="ml-1.5">{badge('bg-red-50 text-red-700', '미연결')}</span>}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">
                        {m.move_type === 'adjust' && m.quantity > 0 ? `+${m.quantity}` : won(m.quantity)}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums text-slate-500">{m.unit_cost != null ? won(m.unit_cost) : '-'}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 text-right tabular-nums">{m.total_cost != null ? won(m.total_cost) : '-'}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2">
                        {m.purpose === 'sales' && badge('bg-slate-100 text-slate-600', '영업샘플')}
                        {m.purpose === 'gift' && badge('bg-pink-50 text-pink-700', '선물증정')}
                        {!m.purpose && m.move_type === 'out' && <span className="text-slate-300">미지정</span>}
                        {!m.purpose && m.move_type !== 'out' && <span className="text-slate-300">-</span>}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 max-w-[220px] truncate" title={m.dest_name ?? ''}>{m.dest_name ?? <span className="text-slate-300">-</span>}</td>
                      <td className="border-b border-slate-100 px-2.5 py-2 whitespace-nowrap">
                        {m.staff_name ?? <span className="text-slate-300">-</span>}
                        {m.staff_name && !m.employee_id && <span className="ml-1">{badge('bg-red-50 text-red-700', '미연결')}</span>}
                      </td>
                      <td className="border-b border-slate-100 px-2.5 py-2 max-w-[180px] truncate text-slate-500" title={m.note ?? ''}>{m.note ?? ''}</td>
                    </tr>
                  ))}
                  {!movesLoading && !ledgerPageRows.length && (
                    <tr><td colSpan={10} className="px-2.5 py-8 text-center text-slate-400">조건에 맞는 원장 행이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-slate-500">
              <span>총 {won(ledgerFiltered.length)}행 · 이관분은 원본 표기 그대로 보존 (source=excel)</span>
              <span className="flex items-center gap-2">
                <button disabled={ledgerPage <= 1} onClick={() => setLedgerPage((p) => p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">이전</button>
                {ledgerPage} / {ledgerPages}
                <button disabled={ledgerPage >= ledgerPages} onClick={() => setLedgerPage((p) => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">다음</button>
              </span>
            </div>
          </>
        )}
      </div>

      {(modal === 'in' || modal === 'out') && (
        <MoveModal
          initialType={modal}
          stock={stock}
          employees={employees}
          onClose={() => setModal(null)}
          onSaved={(text) => { setModal(null); setMsg(text); reload() }}
        />
      )}
      {modal === 'take' && (
        <StocktakeModal
          stock={stock}
          employees={employees}
          onClose={() => setModal(null)}
          onSaved={(text) => { setModal(null); setMsg(text); reload() }}
        />
      )}
    </div>
  )
}

// ── 입고/출고/조정 입력 모달 ─────────────────────────────
function MoveModal({ initialType, stock, employees, onClose, onSaved }: {
  initialType: 'in' | 'out'
  stock: StockRow[]
  employees: Employee[]
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const [moveType, setMoveType] = useState<'in' | 'out' | 'adjust'>(initialType)
  const [itemKey, setItemKey] = useState('')
  const [newName, setNewName] = useState('')
  const [date, setDate] = useState(today())
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [purpose, setPurpose] = useState<'sales' | 'gift'>('sales')
  const [dest, setDest] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [staffName, setStaffName] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const selected = stock.find((s) => s.key === itemKey)

  const save = async () => {
    setErr(null)
    if (!itemKey && !newName.trim()) { setErr('품목을 선택하거나 새 품명을 입력하세요.'); return }
    setSaving(true)
    const employee = employees.find((e) => e.id === employeeId)
    const res = await fetch('/api/sample-stock/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        move_type: moveType,
        move_date: date,
        product_id: selected?.productId ?? null,
        item_name_raw: selected ? selected.name : newName,
        quantity: Number(qty),
        unit_cost: unitCost === '' ? (selected && selected.purchasePrice ? selected.purchasePrice : '') : Number(unitCost),
        purpose: moveType === 'out' ? purpose : null,
        dest_name: moveType === 'adjust' ? '실사 조정' : dest,
        staff_name: staffName || employee?.name || '',
        employee_id: employeeId || null,
        note,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (json.error) { setErr(json.error); return }
    onSaved(`${TYPE_LABEL[moveType]} 1건이 원장에 기록되었습니다.`)
  }

  const label = 'block text-xs font-semibold text-slate-500 mb-1'
  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-slate-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{TYPE_LABEL[moveType]} 입력</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="space-y-3">
          <div>
            <span className={label}>구분</span>
            <div className="flex gap-1.5">
              {(['in', 'out', 'adjust'] as const).map((t) => (
                <button key={t} className={chipCls(moveType === t)} onClick={() => setMoveType(t)}>{TYPE_LABEL[t]}</button>
              ))}
            </div>
            {moveType === 'adjust' && (
              <p className="mt-1 text-[11.5px] text-slate-400">조정은 실사 오차 해소용 — 수량에 부호를 포함해 입력 (+ 재고 증가 / − 재고 감소)</p>
            )}
          </div>
          <div>
            <span className={label}>품목</span>
            <select className={input} value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
              <option value="">품목 선택 (또는 아래 새 품명 입력)</option>
              {stock.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}{s.unlinked ? ' [미연결]' : ''} — 재고 {s.computedQty}
                </option>
              ))}
            </select>
            {!itemKey && (
              <input className={`${input} mt-1.5`} placeholder="목록에 없으면 새 품명 직접 입력 (원본 표기로 저장)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>날짜</span>
              <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <span className={label}>수량{moveType === 'adjust' ? ' (부호 포함)' : ''}</span>
              <input type="number" className={input} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={moveType === 'adjust' ? '예: -2 또는 3' : '예: 5'} />
            </div>
          </div>
          {moveType !== 'adjust' && (
            <div>
              <span className={label}>매입가 (단가 스냅샷 — 비우면 품목 마스터 매입가)</span>
              <input type="number" className={input} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={selected?.purchasePrice ? `기본 ${won(selected.purchasePrice)}원` : '단가 입력'} />
            </div>
          )}
          {moveType === 'out' && (
            <>
              <div>
                <span className={label}>용도</span>
                <div className="flex gap-1.5">
                  <button className={chipCls(purpose === 'sales')} onClick={() => setPurpose('sales')}>영업샘플</button>
                  <button className={chipCls(purpose === 'gift')} onClick={() => setPurpose('gift')}>선물증정</button>
                </div>
              </div>
              <div>
                <span className={label}>출고처 (자유 입력)</span>
                <input className={input} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="예: 한림대의료원지부 (김형철 지부장)" />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>담당 직원</span>
              <select className={input} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">선택 안 함</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <span className={label}>담당자 표기 (직원 외 — 예: 사장님)</span>
              <input className={input} value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="비우면 선택 직원 이름" />
            </div>
          </div>
          <div>
            <span className={label}>비고</span>
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-[13px] text-slate-600">취소</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
              {saving ? '저장 중...' : '원장에 기록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 실사 입력 모달 ───────────────────────────────────────
function StocktakeModal({ stock, employees, onClose, onSaved }: {
  stock: StockRow[]
  employees: Employee[]
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const linkedStock = stock.filter((s) => s.productId)
  const [date, setDate] = useState(today())
  const [employeeId, setEmployeeId] = useState('')
  const [staffName, setStaffName] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setErr(null)
    const entries = linkedStock
      .filter((s) => counts[s.productId!] !== undefined && counts[s.productId!] !== '')
      .map((s) => ({ product_id: s.productId!, counted_qty: Number(counts[s.productId!]) }))
    if (!entries.length) { setErr('실사 수량이 입력된 품목이 없습니다.'); return }
    setSaving(true)
    const employee = employees.find((e) => e.id === employeeId)
    const res = await fetch('/api/sample-stock/stocktakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ take_date: date, entries, employee_id: employeeId || null, staff_name: staffName || employee?.name || '' }),
    })
    const json = await res.json()
    setSaving(false)
    if (json.error) { setErr(json.error); return }
    const diffCount = (json.diffs ?? []).length
    onSaved(`실사 ${json.saved}품목 기록 완료${diffCount ? ` — 오차 ${diffCount}품목 (조정 행으로 해소하세요)` : ' — 오차 없음'}`)
  }

  const input = 'rounded-lg border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-slate-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">실사 입력</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-500">실사 날짜</span>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-500">실사 직원</span>
            <select className={input} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">선택 안 함</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-500">실사자 표기</span>
            <input className={input} value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="비우면 선택 직원 이름" />
          </div>
        </div>
        <p className="mb-2 text-[11.5px] text-slate-400">
          실재고를 입력한 품목만 저장됩니다. 전산재고는 저장 시점 원장 기준으로 스냅샷됩니다. 미연결 품목은 마스터 등록 후 실사 가능합니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="border-b border-slate-200 px-2.5 py-2 text-left font-semibold">품명</th>
                <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">전산재고</th>
                <th className="border-b border-slate-200 px-2.5 py-2 text-right font-semibold">실재고 입력</th>
              </tr>
            </thead>
            <tbody>
              {linkedStock.map((s) => (
                <tr key={s.key}>
                  <td className="border-b border-slate-100 px-2.5 py-1.5">{s.name}</td>
                  <td className="border-b border-slate-100 px-2.5 py-1.5 text-right tabular-nums">{won(s.computedQty)}</td>
                  <td className="border-b border-slate-100 px-2.5 py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-[13px] outline-none focus:border-slate-500"
                      value={counts[s.productId!] ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [s.productId!]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-[13px] text-slate-600">취소</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            {saving ? '저장 중...' : '실사 기록'}
          </button>
        </div>
      </div>
    </div>
  )
}
