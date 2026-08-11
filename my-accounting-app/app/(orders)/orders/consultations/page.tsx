'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// 상담일지 목록 — 기본 본인 작성분, manager/admin은 전체 보기 전환 가능.
// 행 클릭 = 상세(수정), 진행중 상담은 목록에서 바로 주문 전환.

interface Row {
  id: string
  consult_date: string
  consult_type: string
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null
  status: string
  writer: string | null
  item_summary: string | null
  item_total: number
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const TYPE_BADGE: Record<string, string> = {
  '주문': 'bg-blue-100 text-blue-700', '문의': 'bg-gray-100 text-gray-600',
  '요청': 'bg-amber-100 text-amber-800', '결제': 'bg-violet-100 text-violet-700',
  '기타': 'bg-gray-100 text-gray-500',
}
const STATUS_BADGE: Record<string, string> = {
  '진행중': 'bg-amber-100 text-amber-800',
  '주문전환': 'bg-emerald-100 text-emerald-700',
  '종결': 'bg-gray-100 text-gray-500',
}
const chip = (on: boolean) =>
  `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
    on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
  }`

export default function ConsultationsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [role, setRole] = useState('sales')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (status !== 'all') p.set('status', status)
    if (type !== 'all') p.set('type', type)
    if (all) p.set('all', '1')
    p.set('page', String(page))
    const res = await fetch(`/api/orders-portal/consultations?${p}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else {
      setRows(json.rows); setRole(json.role ?? 'sales')
      setTotalPages(json.total_pages ?? 1); setTotal(json.total ?? 0)
    }
    setLoading(false)
  }, [q, status, type, all, page])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, status, type, all])

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">상담일지</h1>
        <span className="text-xs text-gray-400">상담 기록 → 주문 확정 시 주문서로 전환 (이중 입력 제거)</span>
        <Link href="/orders/consultations/new"
          className="ml-auto px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 상담 기록</Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 mt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()) }}
            placeholder="검색 — 업체 · 지점 · 담당자 · 상품명 · 메모 (띄어쓰기로 다중 조건, Enter)"
            className="flex-1 min-w-[260px] border border-gray-300 rounded-lg px-3.5 py-2 text-sm" />
          {q && <button onClick={() => { setQ(''); setQInput('') }} className="text-xs text-gray-400">해제 ✕</button>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {(['all', '진행중', '주문전환', '종결'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{s === 'all' ? '전체' : s}</button>
          ))}
          <span className="w-2" />
          {(['all', '주문', '문의', '요청', '결제', '기타'] as const).map(t => (
            <button key={t} onClick={() => setType(t)} className={chip(type === t)}>{t === 'all' ? '구분 전체' : t}</button>
          ))}
          <span className="flex-1" />
          {role !== 'sales' && (
            <button onClick={() => setAll(v => !v)} className={chip(all)}>{all ? '전체 직원 보기 중' : '내 것만 보기 중'}</button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg whitespace-pre-line">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">상담일</th>
                <th className="py-2 px-3 text-left font-medium">구분</th>
                <th className="py-2 px-3 text-left font-medium">업체(은행)</th>
                <th className="py-2 px-3 text-left font-medium">부서(지점)</th>
                <th className="py-2 px-3 text-left font-medium">담당자</th>
                {all && <th className="py-2 px-3 text-left font-medium">작성자</th>}
                <th className="py-2 px-3 text-left font-medium">품목 요약</th>
                <th className="py-2 px-3 text-right font-medium">예상 합계</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={() => router.push(`/orders/consultations/${r.id}`)}
                  className="border-b border-gray-50 cursor-pointer hover:bg-blue-50/40">
                  <td className="py-2 px-3 tabular-nums text-xs font-semibold">{r.consult_date}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${TYPE_BADGE[r.consult_type] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.consult_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-semibold">{r.bank_name ?? '-'}</td>
                  <td className="py-2 px-3">{r.branch_name ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3">{r.manager_name ?? '-'}</td>
                  {all && <td className="py-2 px-3 text-xs">{r.writer ?? '-'}</td>}
                  <td className="py-2 px-3 text-xs">{r.item_summary ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.item_total ? won(r.item_total) : <span className="text-gray-300">-</span>}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {r.status === '진행중' && (
                      <button onClick={e => { e.stopPropagation(); router.push(`/orders/new?consult=${r.id}`) }}
                        className="text-xs text-blue-700 hover:underline">주문서로 전환</button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={all ? 10 : 9} className="text-center py-12 text-gray-400 text-sm">
                  상담 기록이 없습니다. 상단의 상담 기록 버튼으로 시작하세요.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
        <div className="flex items-center px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100">
          <span>{won(total)}건</span>
          <span className="ml-auto flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">이전</button>
            <span className="tabular-nums">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">다음</button>
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        저장 시 담당자가 마스터 인물이면 영업일지에 상담 활동이 자동 기재됩니다 · 주문 전환된 상담은 수정 잠금(이력 보존)
      </p>
    </div>
  )
}
