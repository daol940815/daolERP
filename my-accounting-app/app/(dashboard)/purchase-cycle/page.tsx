'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type CycleStatus = '완료' | '계산서 대기' | '지급 대기' | '금액 차이' | '과다 지급' | '경비성'
type Severity = '정상 대기' | '주의' | '확인 필요'

interface ExceptionRow {
  vendor_id: string
  vendor_name: string
  month: string
  status: CycleStatus
  severity: Severity
  erp_amount: number
  invoice_supply: number
  paid_amount: number
  gap: number
  detail: string
  cause: string | null
}
interface Summary { 완료: number; '계산서 대기': number; '지급 대기': number; '금액 차이': number; '과다 지급': number; 경비성: number }

const STATUS_BADGE: Record<string, string> = {
  '계산서 대기': 'bg-amber-100 text-amber-800',
  '지급 대기': 'bg-blue-100 text-blue-800',
  '금액 차이': 'bg-rose-100 text-rose-800',
  '과다 지급': 'bg-purple-100 text-purple-800',
}
const SEV_BADGE: Record<Severity, string> = {
  '확인 필요': 'bg-red-600 text-white',
  '주의': 'bg-orange-400 text-white',
  '정상 대기': 'bg-gray-200 text-gray-600',
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// 매입 사이클 — 예외 관리 (설계 v3 §4: 정상보다 예외를 먼저)
// 상태는 저장되지 않고 조회 시 계산된다. 이 화면이 매입 담당자의 To-Do 리스트.
export default function PurchaseCyclePage() {
  const now = new Date()
  const [monthFrom, setMonthFrom] = useState(() => monthStr(new Date(now.getFullYear() - 1, now.getMonth(), 1)))
  const [monthTo, setMonthTo] = useState(() => monthStr(now))
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [minSeverity, setMinSeverity] = useState<'전체' | '주의 이상' | '확인 필요만'>('주의 이상')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/purchase-cycle?from=${monthFrom}&to=${monthTo}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? '조회 실패'); setRows([]); setSummary(null) }
    else { setRows(json.exceptions ?? []); setSummary(json.summary ?? null) }
    setLoading(false)
  }, [monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (minSeverity === '주의 이상' && r.severity === '정상 대기') return false
    if (minSeverity === '확인 필요만' && r.severity !== '확인 필요') return false
    if (search.trim() && !r.vendor_name.includes(search.trim())) return false
    return true
  }), [rows, statusFilter, minSeverity, search])

  const chip = (label: string, count: number, active: boolean, onClick: () => void, cls: string) => (
    <button key={label} onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${active ? 'ring-2 ring-slate-900 ' : ''}${cls}`}>
      {label} <b>{count.toLocaleString()}</b>
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">매입 사이클 — 예외 관리</h1>
        <p className="text-sm mt-1 text-gray-500">
          ERP 주문 → 세금계산서 → 지급 흐름에서 확인이 필요한 건을 먼저 보여줍니다.
          상태는 저장되지 않고 조회 시점에 계산됩니다 (거래처 × 월 단위).
        </p>
      </div>

      {error && <div className="mb-3 mt-2 px-4 py-2.5 bg-red-600 text-white text-sm rounded-lg">{error}</div>}

      {/* 기간 + 필터 */}
      <div className="flex items-center gap-2 my-3 flex-wrap">
        <input type="month" value={monthFrom} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={minSeverity} onChange={e => setMinSeverity(e.target.value as typeof minSeverity)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option>주의 이상</option>
          <option>확인 필요만</option>
          <option>전체</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44" />
      </div>

      {/* 유형 칩 (클릭 = 필터) */}
      {summary && (
        <div className="flex flex-wrap gap-2 mb-4">
          {chip('계산서 대기', summary['계산서 대기'], statusFilter === '계산서 대기',
            () => setStatusFilter(f => f === '계산서 대기' ? '' : '계산서 대기'), 'bg-amber-50 border-amber-200 text-amber-800')}
          {chip('지급 대기', summary['지급 대기'], statusFilter === '지급 대기',
            () => setStatusFilter(f => f === '지급 대기' ? '' : '지급 대기'), 'bg-blue-50 border-blue-200 text-blue-800')}
          {chip('금액 차이', summary['금액 차이'], statusFilter === '금액 차이',
            () => setStatusFilter(f => f === '금액 차이' ? '' : '금액 차이'), 'bg-rose-50 border-rose-200 text-rose-800')}
          {chip('과다 지급', summary['과다 지급'], statusFilter === '과다 지급',
            () => setStatusFilter(f => f === '과다 지급' ? '' : '과다 지급'), 'bg-purple-50 border-purple-200 text-purple-800')}
          <span className="px-3 py-1.5 rounded-lg text-sm border bg-green-50 border-green-200 text-green-700">
            완료 {summary['완료'].toLocaleString()} · 경비성 {summary['경비성'].toLocaleString()} (정상)
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">상태 계산 중...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-green-200 bg-green-50 rounded-xl">
          <p className="text-green-700 font-medium">표시할 예외가 없습니다</p>
          <p className="text-xs text-green-600 mt-1">필터를 &lsquo;전체&rsquo;로 바꾸면 정상 대기 건까지 볼 수 있습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-24">유형</th>
                <th className="px-3 py-2 text-left w-20">심각도</th>
                <th className="px-3 py-2 text-left">거래처</th>
                <th className="px-3 py-2 text-left w-20">월</th>
                <th className="px-3 py-2 text-left">내용 (무엇을 · 얼마나)</th>
                <th className="px-3 py-2 text-left">추정 원인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100'}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SEV_BADGE[r.severity]}`}>{r.severity}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">{r.vendor_name}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.month}</td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{r.detail}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{r.cause ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        판정 기준(조정 가능): 금액차이 허용 ±10% · 지급완료 95% · 과다지급 105% ·
        경과 0~1개월 정상대기 / 2개월 주의 / 3개월↑ 확인필요. 지급은 계산서 결제연결 + 미지급금(2001) 확정 출금 기준.
      </p>
    </div>
  )
}
