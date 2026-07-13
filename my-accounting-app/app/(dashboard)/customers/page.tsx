'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { VendorSalesListRow } from '@/types/vendor-sales'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

export default function CustomersListPage() {
  const [rows, setRows] = useState<VendorSalesListRow[]>([])
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [staff, setStaff] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (staff) p.set('staff', staff)
    const res = await fetch(`/api/customers/list-summary?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setRows(json.data)
      if (Array.isArray(json.staff_names)) setStaffNames(json.staff_names)
    } else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setRows([]) }
    setLoading(false)
  }, [staff])

  useEffect(() => { load() }, [load])

  const q = search.trim()
  const filtered = q ? rows.filter(r => r.name.includes(q)) : rows

  const totalOutstanding = filtered.reduce((s, r) => s + r.outstanding_amount, 0)
  const totalCumSales    = filtered.reduce((s, r) => s + r.cum_sales, 0)
  const totalMonthSales  = filtered.reduce((s, r) => s + r.month_sales, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">매출처 관리</h1>
          <p className="text-sm mt-1 text-gray-500">매출처별 미수금(ERP 기준)과 누적·당월 매출 현황을 확인합니다.</p>
        </div>
        <button onClick={() => { const a = document.createElement('a'); a.href = '/api/customers/export'; a.click() }}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      <div className="flex items-center gap-2 mb-4 mt-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="매출처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <select
          value={staff}
          onChange={e => setStaff(e.target.value)}
          className={`border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 ${staff ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'}`}
        >
          <option value="">담당직원 전체</option>
          {staffNames.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Link href="/erp-aliases?type=customer" className="text-xs text-slate-500 hover:text-slate-700 ml-auto">
          연결 키워드 관리 →
        </Link>
      </div>

      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">미수금 합계</p>
          <p className={`text-lg font-bold ${totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(totalOutstanding)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">누적매출 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalCumSales)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">당월매출 합계</p>
          <p className="text-lg font-bold text-gray-900">{won(totalMonthSales)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">매출처</th>
                <th className="py-2.5 px-3 font-medium">담당직원</th>
                <th className="py-2.5 px-3 font-medium text-right">미수금</th>
                <th className="py-2.5 px-3 font-medium text-right">누적매출</th>
                <th className="py-2.5 px-3 font-medium text-right">당월매출</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.vendor_id ?? r.alias_ids[0]} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 min-w-0">
                    {r.linked && r.vendor_id ? (
                      <Link href={`/vendors/${r.vendor_id}`} className="text-gray-900 hover:underline truncate max-w-[200px] inline-block">
                        {r.name}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500 truncate max-w-[160px]">{r.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 shrink-0">거래처 연결 필요</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-600">
                    <p className="truncate max-w-[140px]">{r.staff_names.length ? r.staff_names.join(', ') : '-'}</p>
                  </td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.outstanding_amount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {won(r.outstanding_amount)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.cum_sales)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.month_sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
