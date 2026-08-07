'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// 주문 현황 — 기존 업로드 주문과 직접 입력 주문을 함께 보여준다.
// 행 클릭 시 상세로 이동, 신규 입력은 /orders/new (2단계).

interface Row {
  id: string
  order_no: string | null
  order_date: string
  customer: string
  staff_name: string | null
  total_amount: number
  outstanding_amount: number
  source: string
}

const won = (n: number) => n.toLocaleString('ko-KR')

export default function OrdersHomePage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (mineOnly) p.set('mine', '1')
    if (search.trim()) p.set('q', search.trim())
    const res = await fetch(`/api/orders-portal?${p}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else setRows(json.rows)
    setLoading(false)
  }, [mineOnly, search])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">주문 현황</h1>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> 내 주문만
        </label>
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
          placeholder="주문처 · 주문번호 검색 후 Enter"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64" />
        <Link href="/orders/new"
          className="ml-auto px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 주문 추가</Link>
      </div>

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl mt-4 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">주문번호</th>
                <th className="py-2 px-3 text-left font-medium">주문일</th>
                <th className="py-2 px-3 text-left font-medium">주문처</th>
                <th className="py-2 px-3 text-left font-medium">자사 담당</th>
                <th className="py-2 px-3 text-right font-medium">주문금액</th>
                <th className="py-2 px-3 text-right font-medium">미수</th>
                <th className="py-2 px-3 text-left font-medium">출처</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={() => router.push(`/orders/${r.id}`)}
                  className="border-b border-gray-50 cursor-pointer hover:bg-blue-50/40">
                  <td className="py-2 px-3 text-xs text-gray-500 tabular-nums">{r.order_no ?? '-'}</td>
                  <td className="py-2 px-3 tabular-nums text-xs">{r.order_date}</td>
                  <td className="py-2 px-3 font-semibold">{r.customer}</td>
                  <td className="py-2 px-3">{r.staff_name ?? '-'}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{won(r.total_amount)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${r.outstanding_amount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {won(r.outstanding_amount)}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${r.source === 'direct' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.source === 'direct' ? '직접입력' : '업로드'}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="text-center py-12 text-gray-400 text-sm">주문이 없습니다.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">최근 200건 표시 · 기존 ERP 업로드분과 직접 입력분이 함께 보입니다</p>
    </div>
  )
}
