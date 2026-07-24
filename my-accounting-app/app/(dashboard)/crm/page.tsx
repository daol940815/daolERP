'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CrmContactRow, Grade } from '@/types/crm'
import { GRADE_COLORS } from '@/types/crm'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function GradeBadge({ g }: { g: Grade | null }) {
  if (!g) return <span className="text-gray-300">-</span>
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${GRADE_COLORS[g]}`}>{g}</span>
}

const GRADE_FILTERS = [
  { key: 'overall', label: '종합' },
  { key: 'revenue', label: '매출' },
  { key: 'continuity', label: '연속성' },
  { key: 'intimacy', label: '친밀도' },
] as const

export default function CrmListPage() {
  const [rows, setRows] = useState<CrmContactRow[]>([])
  const [counselors, setCounselors] = useState<string[]>([])
  const [refYear, setRefYear] = useState<number>(new Date().getFullYear())
  const [newCount, setNewCount] = useState(0)
  const [churnCount, setChurnCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [counselor, setCounselor] = useState('')
  const [gradeKey, setGradeKey] = useState<'overall' | 'revenue' | 'continuity' | 'intimacy'>('overall')
  const [gradeVal, setGradeVal] = useState('')
  const [sort, setSort] = useState<'revenue' | 'managed' | 'name'>('revenue')
  const [tradedOnly, setTradedOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/crm/contacts')
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setRows(json.data)
      setCounselors(json.counselors ?? [])
      setRefYear(json.ref_year)
      setNewCount(json.new_count ?? 0)
      setChurnCount(json.churn_count ?? 0)
    } else {
      setMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
      setRows([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim()
    let list = rows
    if (q) list = list.filter(r =>
      r.bank_name.includes(q) || (r.branch_name ?? '').includes(q) || r.name.includes(q))
    if (counselor) list = list.filter(r => r.counselor_now === counselor)
    if (gradeVal) {
      list = list.filter(r => {
        const g = gradeKey === 'overall' ? r.overall_grade
          : gradeKey === 'revenue' ? r.revenue_grade
          : gradeKey === 'continuity' ? r.continuity_grade
          : r.intimacy_grade
        return gradeVal === 'none' ? g === null : g === gradeVal
      })
    }
    if (tradedOnly) list = list.filter(r => r.traded_y0)
    const sorted = [...list]
    if (sort === 'revenue') sorted.sort((a, b) => b.total_revenue - a.total_revenue)
    else if (sort === 'managed') sorted.sort((a, b) => (a.last_activity ?? '0000') < (b.last_activity ?? '0000') ? -1 : 1)
    else sorted.sort((a, b) => a.bank_name.localeCompare(b.bank_name) || a.name.localeCompare(b.name))
    return sorted
  }, [rows, search, counselor, gradeKey, gradeVal, sort, tradedOnly])

  const dist = useMemo(() => {
    const d: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const r of filtered) d[r.overall_grade] = (d[r.overall_grade] ?? 0) + 1
    return d
  }, [filtered])

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">고객관리</h1>
          <p className="text-sm mt-1 text-gray-500">
            은행 지점 담당자 개인 단위의 관계 관리 — 매출·연속성·친밀도 등급 (기준연도 {refYear}, 최근 3개년)
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/crm/worklist" className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">워크리스트</Link>
          <Link href="/crm/matching" className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">주문 매칭</Link>
        </div>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex gap-3 flex-wrap mb-4 mt-4">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[200px]">
          <p className="text-xs text-gray-400 mb-1">종합등급 분포 (필터 반영)</p>
          <div className="flex gap-3 text-sm font-bold">
            {(['A', 'B', 'C', 'D'] as Grade[]).map(g => (
              <span key={g} className="flex items-center gap-1">
                <GradeBadge g={g} /><span className="text-gray-700">{dist[g] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">{refYear} 신규</p>
          <p className="text-lg font-bold text-emerald-600">{newCount.toLocaleString()}명</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">{refYear} 이탈</p>
          <p className="text-lg font-bold text-red-600">{churnCount.toLocaleString()}명</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 min-w-[140px]">
          <p className="text-xs text-gray-400 mb-1">표시 고객</p>
          <p className="text-lg font-bold text-gray-900">{filtered.length.toLocaleString()}명</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처·지점·이름 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <select value={counselor} onChange={e => setCounselor(e.target.value)}
          className={`border rounded-lg px-3 py-1.5 text-sm ${counselor ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'}`}>
          <option value="">상담자 전체</option>
          {counselors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={gradeKey} onChange={e => { setGradeKey(e.target.value as typeof gradeKey); setGradeVal('') }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700">
          {GRADE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}등급</option>)}
        </select>
        <select value={gradeVal} onChange={e => setGradeVal(e.target.value)}
          className={`border rounded-lg px-3 py-1.5 text-sm ${gradeVal ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'}`}>
          <option value="">전체</option>
          {['A', 'B', 'C', 'D'].map(g => <option key={g} value={g}>{g}</option>)}
          {gradeKey === 'intimacy' && <option value="none">미입력</option>}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-1">
          <input type="checkbox" checked={tradedOnly} onChange={e => setTradedOnly(e.target.checked)} />
          올해 거래만
        </label>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 ml-auto">
          <option value="revenue">누적매출 큰 순</option>
          <option value="managed">관리 오래된 순</option>
          <option value="name">거래처명 순</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 고객이 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">거래처 / 지점</th>
                <th className="py-2.5 px-3 font-medium">담당자</th>
                <th className="py-2.5 px-3 font-medium">상담자</th>
                <th className="py-2.5 px-3 font-medium text-center">종합</th>
                <th className="py-2.5 px-3 font-medium text-center">매출</th>
                <th className="py-2.5 px-3 font-medium text-center">연속</th>
                <th className="py-2.5 px-3 font-medium text-center">친밀</th>
                <th className="py-2.5 px-3 font-medium text-right">누적매출(3개년)</th>
                <th className="py-2.5 px-3 font-medium text-center">거래</th>
                <th className="py-2.5 px-3 font-medium">최근주문</th>
                <th className="py-2.5 px-3 font-medium">최종관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map(r => (
                <tr key={r.contact_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3">
                    <Link href={`/crm/${r.contact_id}`} className="text-gray-900 hover:underline">
                      {r.bank_name}
                      {r.branch_name && <span className="text-gray-400 text-xs ml-1">{r.branch_name}</span>}
                    </Link>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {r.name}
                    {r.title && <span className="text-gray-400 text-xs ml-1">{r.title}</span>}
                    {r.role === 'branch_manager' && <span className="ml-1 px-1 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-700">지점장</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600">{r.counselor_now ?? '-'}</td>
                  <td className="py-2 px-3 text-center"><GradeBadge g={r.overall_grade} /></td>
                  <td className="py-2 px-3 text-center"><GradeBadge g={r.revenue_grade} /></td>
                  <td className="py-2 px-3 text-center"><GradeBadge g={r.continuity_grade} /></td>
                  <td className="py-2 px-3 text-center"><GradeBadge g={r.intimacy_grade} /></td>
                  <td className="py-2 px-3 text-right font-medium">{won(r.total_revenue)}</td>
                  <td className="py-2 px-3 text-center text-[11px] text-gray-500 whitespace-nowrap">
                    {[r.traded_y2, r.traded_y1, r.traded_y0].map((t, i) => (
                      <span key={i} className={t ? 'text-emerald-600' : 'text-gray-300'}>●</span>
                    ))}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.last_order_date ?? '-'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.last_activity ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <p className="text-xs text-gray-400 px-3 py-2">상위 500명만 표시 — 검색·필터로 좁혀주세요.</p>
          )}
        </div>
      )}
    </div>
  )
}
